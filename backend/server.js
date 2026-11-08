require('dotenv').config();
const express=require('express');
const Database=require('better-sqlite3');
const crypto=require('crypto');
const app=express(); app.use(express.json({limit:'16kb'})); app.use(express.urlencoded({extended:false}));
const db=new Database('pisotab.sqlite');
const API_KEY=process.env.API_KEY||'dev-only-change-me';
const PORT=Number(process.env.PORT||3000);
const DEVELOPER='Jabin Cajes';
const now=()=>Date.now(), id=()=>crypto.randomUUID();
db.exec(`
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token TEXT NOT NULL,online_at INTEGER,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,ends_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL,device_id TEXT NOT NULL,pulses INTEGER NOT NULL,pesos INTEGER NOT NULL,minutes INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);
const defaults={pulse_1:'1',pulse_5:'5',pulse_10:'10',pulse_20:'20',minutes_1:'5',minutes_5:'25',minutes_10:'50',minutes_20:'100'};
for(const [k,v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run(k,v);
const setting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting=(k,v)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
function hashPass(p,salt=crypto.randomBytes(16).toString('hex')) {
 return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');
}
function passOK(p,stored) {
 if(!stored) return false; const [salt,h]=stored.split(':');
 const a=Buffer.from(crypto.scryptSync(p,salt,64).toString('hex'),'hex'), b=Buffer.from(h,'hex');
 return a.length===b.length && crypto.timingSafeEqual(a,b);
}
if(!setting('admin_hash')) setSetting('admin_hash',hashPass(process.env.ADMIN_KEY||'ChangeMe123!'));
const adminOK=p=>passOK(String(p||''),setting('admin_hash'));
const authAdmin=(req,res,next)=>{if(!adminOK(req.query.key||req.body.currentPassword||req.header('X-Admin-Key')))return res.status(401).send('Admin password incorrect');next();};
const authApi=(req,res,next)=>{if(req.header('X-API-Key')!==API_KEY)return res.status(401).json({error:'unauthorized'});next();};
const device=db.prepare('SELECT * FROM devices WHERE id=?');
const activeSession=db.prepare('SELECT * FROM sessions WHERE device_id=? AND ends_at>?');
for(let i=1;i<=6;i++){const did=`TAB-${String(i).padStart(2,'0')}`;if(!device.get(did))db.prepare('INSERT INTO devices VALUES(?,?,?,?,?)').run(did,`Tablet ${i}`,crypto.randomBytes(24).toString('hex'),null,now());}

app.get('/',(req,res)=>res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>PisoTab</title>
<h2>PisoTab Central Coin Station</h2><p>Choose the tablet and tap "Insert coins" on that tablet. The coin station credits the tablet with the active payment request.</p>
<p>Only one payment request can be active at a time.</p><div id="list"></div><script>
async function load(){let d=await (await fetch('/api/devices')).json();document.getElementById('list').innerHTML=d.devices.map(x=>'<p>'+x.name+' — '+(x.busy?'In use / payment pending':'Available')+'</p>').join('')}load();setInterval(load,4000)
</script>`));

app.get('/api/devices',(req,res)=>{const ds=db.prepare('SELECT id,name,online_at FROM devices ORDER BY created_at').all();res.json({devices:ds.map(d=>({id:d.id,name:d.name,busy:!!activeSession.get(d.id,now())||!!db.prepare("SELECT id FROM reservations WHERE device_id=? AND status='pending' AND expires_at>?").get(d.id,now()),online:!!d.online_at&&now()-d.online_at<60000}))});});

// Tablet initiates its own payment request. A single central slot accepts one pending request at a time.
app.post('/api/device/request-payment',(req,res)=>{
 const {deviceId,token}=req.body||{}; const d=device.get(String(deviceId||''));
 if(!d||d.token!==token)return res.status(401).json({error:'unauthorized'});
 if(!activeSession.get(d.id,now())) { /* first-time session is allowed */ }
 const pending=db.prepare("SELECT * FROM reservations WHERE status='pending' AND expires_at>? LIMIT 1").get(now());
 if(pending)return res.status(409).json({error:'Coin slot is currently assigned to another tablet. Please wait.'});
 const rid=id(),t=now();
 db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?)').run(rid,d.id,'pending',t+120000,t);
 res.json({ok:true,reservationId:rid,message:'Payment request active. Insert coins at the central coin station within 2 minutes.'});
});

// ESP32 reports one completed pulse train. Exact pulses per coin must be calibrated.
app.post('/api/coin',authApi,(req,res)=>{
 const pulses=Number(req.body.pulses);
 if(!Number.isInteger(pulses)||pulses<1||pulses>1000)return res.status(400).json({error:'Invalid pulses'});
 const peso=[1,5,10,20].find(v=>Number(setting('pulse_'+v))===pulses);
 if(!peso)return res.status(422).json({error:'Unmapped pulse count. Configure actual pulse counts in Admin.'});
 const r=db.prepare("SELECT * FROM reservations WHERE status='pending' AND expires_at>? ORDER BY created_at LIMIT 1").get(now());
 if(!r)return res.status(409).json({error:'No tablet has requested payment. Tap Insert coins on the tablet first.'});
 const minutes=Number(setting('minutes_'+peso)); if(!Number.isInteger(minutes)||minutes<1)return res.status(500).json({error:'Invalid time setting'});
 const t=now(),sid=id(),pid=id(),existing=activeSession.get(r.device_id,t),endsAt=Math.max(existing?existing.ends_at:0,t)+minutes*60000;
 db.transaction(()=>{
  db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?)').run(pid,r.id,r.device_id,pulses,peso,minutes,t);
  if(existing)db.prepare('UPDATE sessions SET ends_at=? WHERE id=?').run(endsAt,existing.id);
  else db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sid,r.device_id,endsAt,t);
  db.prepare("UPDATE reservations SET status='paid' WHERE id=?").run(r.id);
 })();
 res.json({ok:true,deviceId:r.device_id,pesos:peso,minutes,endsAt});
});

app.post('/api/device/heartbeat',(req,res)=>{
 const {deviceId,token}=req.body||{},d=device.get(String(deviceId||''));
 if(!d||d.token!==token)return res.status(401).json({error:'unauthorized'});
 db.prepare('UPDATE devices SET online_at=? WHERE id=?').run(now(),d.id);
 const s=activeSession.get(d.id,now());
 const pending=db.prepare("SELECT id,expires_at FROM reservations WHERE device_id=? AND status='pending' AND expires_at>?").get(d.id,now());
 res.json({active:!!s,endsAt:s?s.ends_at:0,paymentPending:!!pending,paymentExpiresAt:pending?pending.expires_at:0,serverTime:now()});
});

app.get('/admin',authAdmin,(req,res)=>{
 const key=encodeURIComponent(req.query.key||'');
 const ds=db.prepare('SELECT id,name,online_at FROM devices ORDER BY created_at').all();
 const sales=db.prepare('SELECT COALESCE(SUM(pesos),0) pesos,COUNT(*) transactions FROM payments').get();
 const rows=[1,5,10,20].map(v=>`<tr><td>₱${v}</td><td><input name="pulse_${v}" type="number" min="1" max="1000" value="${setting('pulse_'+v)}"></td><td><input name="minutes_${v}" type="number" min="1" max="10080" value="${setting('minutes_'+v)}"></td></tr>`).join('');
 res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>PisoTab Admin</title>
 <h2>PisoTab Admin</h2><b>Developer: ${DEVELOPER}</b><p>Sales ₱${sales.pesos} | Transactions ${sales.transactions}</p>
 <h3>Coin / time settings</h3><p>Pulse values below are placeholders until verified using your Allan acceptor.</p>
 <form method="post" action="/admin/settings?key=${key}"><table border="1" cellpadding="8"><tr><th>Coin</th><th>Pulse count</th><th>Minutes</th></tr>${rows}</table><button>Save coin/time settings</button></form>
 <h3>Devices</h3><ul>${ds.map(d=>`<li>${d.id} — ${d.name} — ${d.online_at&&now()-d.online_at<60000?'Online':'Offline'}</li>`).join('')}</ul>
 <form method="post" action="/admin/add?key=${key}"><h3>Add tablet</h3><input name="name" placeholder="Tablet name" required><button>Add</button></form>
 <h3>Change admin password</h3><form method="post" action="/admin/password"><input type="hidden" name="currentPassword" value=""><label>Current password <input name="oldPassword" type="password" required></label><br><label>New password <input name="newPassword" type="password" minlength="10" required></label><br><button>Change password</button></form>
 <p>Default first-run password: ChangeMe123! Change it immediately. Keep the admin page behind a trusted network/VPN and HTTPS.</p>`);
});
app.post('/admin/settings',authAdmin,(req,res)=>{for(const v of [1,5,10,20]){const p=Number(req.body['pulse_'+v]),m=Number(req.body['minutes_'+v]);if(!Number.isInteger(p)||p<1||p>1000||!Number.isInteger(m)||m<1||m>10080)return res.status(400).send('Invalid setting');}
 const ps=[1,5,10,20].map(v=>Number(req.body['pulse_'+v]));if(new Set(ps).size!==4)return res.status(400).send('Pulse counts must be unique.');
 for(const v of [1,5,10,20]){setSetting('pulse_'+v,req.body['pulse_'+v]);setSetting('minutes_'+v,req.body['minutes_'+v]);}
 res.redirect('/admin?key='+encodeURIComponent(req.query.key));});
app.post('/admin/password',(req,res)=>{const {oldPassword,newPassword}=req.body;if(!adminOK(oldPassword))return res.status(401).send('Current password incorrect');if(typeof newPassword!=='string'||newPassword.length<10)return res.status(400).send('Use at least 10 characters');setSetting('admin_hash',hashPass(newPassword));res.send('Password changed. Return to the admin page and sign in with the new password.');});
app.post('/admin/add',authAdmin,(req,res)=>{const did='TAB-'+crypto.randomBytes(4).toString('hex').toUpperCase(),token=crypto.randomBytes(24).toString('hex');db.prepare('INSERT INTO devices VALUES(?,?,?,?,?)').run(did,String(req.body.name||did),token,null,now());res.type('text').send(`Added ${did}\\nDevice token: ${token}\\nKeep this token secret; configure the matching Android app.`);});
app.get('/admin/report',authAdmin,(req,res)=>res.json({rows:db.prepare('SELECT device_id,SUM(pesos) pesos,SUM(minutes) minutes,COUNT(*) transactions FROM payments GROUP BY device_id').all()}));
app.listen(PORT,()=>console.log(`PisoTab by ${DEVELOPER} listening on ${PORT}`));

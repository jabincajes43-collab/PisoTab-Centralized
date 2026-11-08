# PisoTab Centralized Starter — Developer: Jabin Cajes

This is a **starter source project**, not a ready-to-flash production system.
It supports one central coin acceptor, customer tablet selection, ₱1 = 5 minutes,
and multiple Android tablets registered dynamically. Admin can edit the time credit for ₱1, ₱5, ₱10 and ₱20.

## Important hardware assumptions
- ESP32 DevKit / ESP32-WROOM-32.
- Coin acceptor provides a pulse output. Exact model and pulse mapping are unknown.
- Do NOT connect a 12V coin acceptor output directly to an ESP32 GPIO.
- Use an optocoupler / isolated level interface. Confirm the acceptor's output type
  (open collector, NPN, or 12V pulse) and polarity before wiring.
- ESP32 GPIO27 is the isolated pulse input in the example.
- ESP32 connects to the backend over Wi-Fi. The backend URL and API key are configurable.

## Payment flow
1. Customer opens the customer page on the central station.
2. Customer selects an available tablet and reserves it.
3. The backend opens a short payment window for that reservation.
4. Coin pulses arrive at the ESP32 and are reported to the backend.
5. Backend credits the selected tablet at 5 minutes per peso.
6. Tablet app polls the backend and starts / renews its kiosk session.
7. On expiry, the app returns to its configured restricted screen.

## What is included
- `firmware/pisotab_esp32.ino` – pulse counter + Wi-Fi + HTTP reporting.
- `backend/server.js` – Express + SQLite API and basic customer/admin pages.
- `android/` – Kotlin Android source for a polling kiosk client.
- `wiring.md` – safe wiring notes.

## Run backend
Requires Node.js 18+.

```bash
cd backend
npm install
cp .env.example .env
# Set a long random API_KEY and set ADMIN_KEY.
npm start
```

Open `http://YOUR_SERVER_IP:3000` from the customer station.
Admin page: `http://YOUR_SERVER_IP:3000/admin?key=YOUR_ADMIN_KEY`

The first launch creates six sample devices: TAB-01 ... TAB-06.
Add more from the admin page. Device capacity is limited by your Wi-Fi, server,
and tablet hardware, not by a hard-coded six-device limit.

## Configure ESP32
Install ArduinoJson library (Benoit Blanchon) in Arduino IDE.
Edit Wi-Fi SSID/password, backend URL, and API key in the sketch.
Set the coin pulse mapping only after testing your exact acceptor.
The default mapping is 1 pulse = ₱1. Do not assume this is correct for your unit.

## Build Android source
Open `android/` in Android Studio, allow Gradle sync, then build the APK.
Change `BASE_URL` in `MainActivity.kt` to your backend URL.
For real kiosk lockdown, provision the tablet as Android Device Owner and use
Android Lock Task Mode. This sample app only requests lock-task mode; it does
not silently bypass Android security or configure Device Owner for you.

## Before live use
- Identify the coin acceptor output and calibrate pulses per denomination.
- Use HTTPS for internet-facing deployments; do not expose the sample HTTP API
  directly to the public internet.
- Replace demo API keys, add TLS, rate limits, backups, admin authentication,
  and device-specific credentials.
- Test with a dummy load and a single tablet before connecting customers.
- Provide a physical service switch / emergency stop for the coin station.

## Developer identity
Developer label shown in the admin page: **Jabin Cajes**.

## Coin denomination calibration
The acceptor is already configured for ₱1, ₱5, ₱10 and ₱20. The backend
includes editable pulse-count-to-denomination settings. Enter the actual pulse
count produced by each coin in the Admin settings page after testing each coin.
Do not guess these pulse counts: some acceptors emit a pulse train per coin,
and some are configured differently.

Admin can also set the number of minutes credited for each denomination.

## Automatic tablet-to-coin-slot assignment
The customer taps **INSERT COINS / ADD TIME** on the tablet they are using.
That tablet creates the one active payment request at the server. The single
central coin acceptor credits the tablet associated with that request. If
another tablet already owns the coin slot, later requests wait until the first
request is paid or expires. This is necessary because a single coin acceptor
cannot physically identify which tablet is in front of it.

## Admin password
First-run default password is `ChangeMe123!`. Change it immediately in the
Admin page. Use a long unique password. The sample admin authentication is a
starter implementation; put the admin site behind HTTPS and a VPN/private
network before internet exposure.

## Android kiosk mode
The app has an "Insert coins / Add time" action and session polling. True
kiosk lockdown requires provisioning each tablet as Android Device Owner and
allowlisting this app for Lock Task Mode. The app cannot self-grant Device Owner.

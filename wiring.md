# Wiring plan (verify your exact hardware first)

## ESP32 DevKit
| Signal | ESP32 | Notes |
|---|---:|---|
| Coin pulse | GPIO27 | Through optocoupler / isolated interface only |
| Interface ground | GND | Only on ESP32 low-voltage side |
| Power | 5V/VIN or USB | Use a regulated supply suitable for the board |

## Coin acceptor side
The acceptor may require 12V DC. Its pulse output may be 12V, open-collector,
or another electrical format. The exact model is unknown, so **there is no safe
universal direct wiring diagram**.

Use a correctly rated optocoupler interface:
- Acceptor supply +12V -> acceptor +V
- Acceptor supply 0V -> acceptor GND
- Acceptor pulse output -> optocoupler input circuit designed for that output type
- Optocoupler transistor output -> ESP32 GPIO27 and ESP32-side GND, with a
  suitable pull-up to 3.3V (internal pull-up is enabled in the example)

Do not connect acceptor +12V to GPIO27. Do not assume grounds should be joined
across the isolation barrier. Have the interface checked against the acceptor
label/manual before powering it.

## Network
- ESP32 -> Wi-Fi router -> backend server
- Android tablets -> same router / internet -> backend server

## No relay is required for the basic Android session timer.
The Android app controls its own kiosk screen. If you later need to switch
physical power to tablets, design a separately fused and appropriately rated
power distribution system.

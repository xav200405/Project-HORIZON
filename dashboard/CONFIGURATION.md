# TP-ARC RMS Configuration Guide

This guide explains how to configure the Remote Monitoring System (RMS) for this UAV and for future UAVs that keep the same flight-controller telemetry contract.

The RMS is intentionally not tied to one airframe name. As long as the controller sends compatible serial telemetry, the same RMS can monitor another UAV by changing configuration values such as serial port, baud rate, database path, and account setup.

## Compatibility Contract

A future UAV is compatible with this RMS when:

- It sends line-delimited serial telemetry over USB/UART.
- The telemetry baud rate is known and configured in `TPARC_SERIAL_BAUD`.
- Each telemetry packet is either JSON or the older `TEL:key=value` format.
- The packet contains the same core aircraft values, or compatible aliases listed below.
- The RC inputs and motor outputs keep the same semantic meaning.

The RMS does not currently require GPS. Without GPS, the Operations route view is a relative telemetry trace instead of a true map.

## Required Serial Settings

Default:

```text
115200 baud
```

Recommended controller behavior:

- Print one complete telemetry packet per line.
- End each packet with newline.
- Avoid mixing partial debug text into telemetry JSON lines.
- For smooth live display, send packets at `10 Hz` to `15 Hz`.

Telemetry interval examples:

| Firmware interval | RMS update rate |
| --- | --- |
| `100 ms` | about `10 Hz` |
| `67 ms` | about `15 Hz` |
| `500 ms` | about `2 Hz` |

## Environment Configuration

Set these on the Raspberry Pi before starting the RMS, or pass them inline.

| Variable | Example | Description |
| --- | --- | --- |
| `TPARC_SERIAL_PORT` | `<serial-port>` | Serial device connected to the flight controller. Auto-detected when unset. |
| `TPARC_SERIAL_BAUD` | `115200` | Serial baud rate. |
| `TPARC_PORT` | `5000` | HTTP port for the single-file launcher. |
| `TPARC_HOST` | `0.0.0.0` | Listen address for the single-file launcher. |
| `TPARC_DB` | `<database-path>` | SQLite telemetry/account/audit database. |
| `TPARC_SECRET_KEY` | long random string | Persistent Flask session key. Recommended for deployment. |
| `TPARC_SESSION_MINUTES` | `30` | Login session lifetime. |
| `TPARC_RMS_KILL_ENABLED` | `0` or `1` | Enables the RMS kill endpoint only when the aircraft is commissioned for it. |
| `TPARC_OPEN_BROWSER` | `0` or `1` | Opens browser on single-file launcher startup. |
| `TPARC_AUTO_INSTALL` | `0` or `1` | Lets the single-file launcher install missing packages. |

Example for a second UAV:

```bash
TPARC_SERIAL_PORT=<serial-port> \
TPARC_DB=<database-path> \
TPARC_PORT=5001 \
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py
```

## Telemetry Packet Formats

### Preferred JSON Format

The current RMS prefers one JSON object per line:

```json
{"ms":12345,"state":"READY","armed":0,"mode":"BENCH","ch1":1500,"ch2":1500,"ch3":1000,"ch4":1500,"ch5":1000,"ch6":1000,"roll":0.0,"pitch":0.0,"heading":90.0,"gyroR":0.0,"gyroP":0.0,"gyroY":0.0,"m1":1000,"m2":1000,"m3":1000,"m4":1000}
```

The RMS preserves unknown fields and shows them on the Live Telemetry page. That means future firmware can add fields without breaking the dashboard.

### Legacy TEL Format

The RMS also supports:

```text
TEL:FW=FC-0.8.0,REV=2026-06-17.8,R=0.00,P=0.00,Y=90.00,M1=1000,M2=1000,M3=1000,M4=1000,THR=0.000,RR=0.000,RP=0.000,RY=0.000,ARM=0,FS=0
```

Events and command responses are also parsed:

```text
EVT:ARMED
ACK:PID
ERR:RMS_KILL_DISABLED
```

## Core Field Mapping

These are the fields the RMS understands best. Future UAV firmware should keep these names or emit compatible aliases.

| RMS field | JSON source | Meaning |
| --- | --- | --- |
| `controller_ms` | `ms` | Controller uptime in milliseconds. |
| `state` | `state` | Flight/safety state string. |
| `armed` | `armed` | `1` when armed, `0` when disarmed. |
| `lockout` | `lockout` | Safety lockout active. |
| `mode` | `mode` | Flight mode such as `BENCH`, `TEST`, `NORMAL`. |
| `cap` | `cap` | Active ESC cap. |
| `mode_cap` | `modeCap` | Mode-selected ESC cap. |
| `ch1` to `ch6` | `ch1` to `ch6` | Raw RC PWM channels. |
| `roll` | `roll` | Roll angle in degrees. |
| `pitch` | `pitch` | Pitch angle in degrees. |
| `yaw` | `heading` or `yaw` | Heading/yaw angle in degrees. |
| `gyro_roll_rate` | `gyroR` | Roll gyro rate in deg/s. |
| `gyro_pitch_rate` | `gyroP` | Pitch gyro rate in deg/s. |
| `gyro_yaw_rate` | `gyroY` | Yaw gyro rate in deg/s. |
| `heading_setpoint` | `headTarget` | Heading-hold target in degrees. |
| `heading_error` | `headErr` | Heading error in degrees. |
| `heading_lock` | `headLock` | Heading lock active flag. |
| `roll_cmd` | `rollCmd` | Roll command in degrees. |
| `pitch_cmd` | `pitchCmd` | Pitch command in degrees. |
| `yaw_cmd` | `yawCmd` | Yaw-rate command in deg/s. |
| `pid_roll` | `rollOut` | Roll PID output. |
| `pid_pitch` | `pitchOut` | Pitch PID output. |
| `pid_yaw` | `yawOut` | Yaw PID output. |
| `m1` to `m4` | `m1` to `m4` | Motor PWM outputs in microseconds. |
| `d6`, `d9`, `d10`, `d11` | same | Motor pin PWM values. |
| `rx_ok` | `rxOK` | Receiver health flag. |
| `imu_ok` | `imuOK` | IMU health flag. |
| `sensors_ok` | `sensorsOK` | Overall sensor health flag. |
| `gyro_calibrated` | `gyroCal` | Gyro calibration flag. |
| `compass_ok` | `compassOK` | Compass health flag. |
| `compass_status` | `compassStatus` | Compass status string. |
| `compass_driver` | `compassDriver` | Compass driver string. |
| `mag_x`, `mag_y`, `mag_z` | `magX`, `magY`, `magZ` | Magnetometer raw values. |
| `led` | `led` | Controller LED state. |
| `eeprom` | `eeprom` | Calibration source/status. |
| `loop_overrun` | `loopOverrun` | Control-loop overrun flag. |

## RC Input Contract

The RMS assumes this semantic channel order:

| Channel | Meaning | Typical raw value |
| --- | --- | --- |
| `ch1` | Roll | `1000` to `2000`, center `1500` |
| `ch2` | Pitch | `1000` to `2000`, center `1500` |
| `ch3` | Throttle | `1000` low to `2000` high |
| `ch4` | Yaw | `1000` to `2000`, center `1500` |
| `ch5` | Mode switch | Bench/Test/Normal |
| `ch6` | Physical lockout/kill switch | Safe/lockout |

The RMS normalizes stick displays from these raw PWM values. If a future controller uses different channel names, update `JSON_ALIASES` in `app/telemetry.py`.

## Motor Output Contract

The RMS assumes four motor outputs:

| RMS field | Current pin | Current physical label |
| --- | --- | --- |
| `m1` | `D6` | Front Right in latest JSON firmware display |
| `m2` | `D9` | Rear/Back Right |
| `m3` | `D10` | Rear/Back Left |
| `m4` | `D11` | Front Left |

Keep `m1` to `m4` as PWM microseconds (`1000` to `2000`) for compatible motor bars, charts, and motor-spread analysis.

If a future airframe has a different physical layout but still has four motor PWM values, keep the `m1` to `m4` fields and document the airframe-specific layout in that UAV's deployment notes.

## Per-UAV Deployment Pattern

For multiple UAVs, keep separate databases and ports:

```bash
# UAV 1
TPARC_SERIAL_PORT=<uav-1-serial-port> \
TPARC_DB=<uav-1-database-path> \
TPARC_PORT=5000 \
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py

# UAV 2
TPARC_SERIAL_PORT=<uav-2-serial-port> \
TPARC_DB=<uav-2-database-path> \
TPARC_PORT=5001 \
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py
```

If each UAV has its own Raspberry Pi, they can all use port `5000` because each Pi has its own IP address.

## User Accounts

Fresh databases create:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |
| `operator` | `change-me-operator` | `operator` |
| `viewer` | `change-me-viewer` | `viewer` |

Use `/settings` to:

- Create accounts.
- Edit usernames.
- Change roles.
- Change passwords.
- Delete accounts.

The RMS blocks deleting the current account and blocks removing the last admin.

## When Firmware Changes

If the future firmware keeps the same field names, no RMS code changes are needed.

If firmware adds new telemetry fields:

- No code change is required for basic visibility.
- The Live Telemetry page will show the new fields automatically.
- Add chart panels or summary calculations only if the field needs special display.

If firmware renames fields:

- Update `JSON_ALIASES` in `app/telemetry.py`.
- Regenerate `TP_ARC_RMS_single.py` so the one-file launcher includes the updated parser.

If firmware changes packet rate:

- The RMS will follow the incoming rate.
- For 10 to 15 Hz, set firmware telemetry interval near `100 ms` to `67 ms`.

If firmware changes safety command behavior:

- Keep RMS kill disabled until the new firmware behavior is verified.
- Update `CMD:KILL`, `PID:`, or `BAT:` command handlers in `app/routes.py` only after bench testing.

## Commissioning Checklist

For each new UAV:

1. Confirm the serial port for the target OS and adapter.
2. Start the RMS with the correct `TPARC_SERIAL_PORT`.
3. Open `/network` and verify packet rate, packet age, serial status, and latest raw line.
4. Open `/telemetry` and confirm RC channels, motor outputs, IMU values, compass status, and state fields update.
5. Open `/` and verify Operations page shows heading, attitude, events, and relative trace.
6. Create/change user accounts in `/settings`.
7. Export a short CSV/JSON recording and verify values look correct.
8. Keep props removed until all telemetry and safety indicators are verified.

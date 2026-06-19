# TP-ARC Remote Monitoring System

The TP-ARC Remote Monitoring System (RMS) is the Raspberry Pi ground-station dashboard for Project HORIZON. It reads telemetry from the Arduino flight controller over serial, records telemetry to SQLite, and serves browser pages for operations, detailed live telemetry, network health, settings, exports, and audit logs.

This RMS is operator-support software, not certified aircraft safety
equipment. Telemetry can be delayed, stale, disconnected, or wrong if the
serial link, network, browser, or Raspberry Pi fails. Read
`../docs/SAFETY_ADVISORY.md` before field use.

## What You Get

- FlightHub-style Operations page for mission monitoring and event marking.
- Live Telemetry page with charts and every current telemetry field.
- Network page showing serial link health, packet rate, browser/socket status, packet age, and raw serial lines.
- Telemetry recording to SQLite.
- CSV, JSON, PDF, and chart PNG export.
- Login, roles, CSRF protection, audit log, and session timeout.
- Optional serial commands for PID updates, battery thresholds, calibration trigger, and RMS kill when deliberately commissioned.

## Default Admin Account

Fresh databases create this admin account automatically:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change this password before field use or shared-network use. Usernames, passwords, roles, and account deletion are managed from `/settings`.

## Recommended Raspberry Pi Setup

Use the installable Pi app package for field use:

```bash
cd dashboard/deploy/raspberry_pi
python3 build_pi_app_package.py
```

Copy `dist/tparc-rms-pi-app-*.tar.gz` to the Raspberry Pi, then:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
cd tparc-rms-pi-app
sudo bash install.sh
```

The installer creates a `tparc-rms.service` systemd service, starts it on boot,
keeps configuration in `/etc/tparc-rms/tparc-rms.env`, and stores data in
`/var/lib/tparc-rms`.

To update an installed Pi with a newer package:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
cd tparc-rms-pi-app
sudo bash update.sh
```

For automatic GitHub updates, publish the Pi package tarball as a release asset
in `xav200405/Project-HORIZON`. If no matching release asset exists, the updater
falls back to scanning under `dashboard` for `tparc-rms-pi-app-*.tar.gz`, so
future folders such as `dashboard/2026.REV01.1/dist` do not require Pi config
changes. The packaged config already sets
`TPARC_UPDATE_REPO=xav200405/Project-HORIZON` and
`TPARC_UPDATE_SOURCE_PATH=dashboard`, so an installed Pi can update itself with:

```bash
sudo bash /opt/tparc-rms/update.sh
```

Use the single-file launcher for temporary runs:

```bash
python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
```

The single-file launcher:

- Unpacks the RMS app to a per-user runtime folder on first run.
- Opens the app at `http://127.0.0.1:5000` when possible.
- Listens on `0.0.0.0:5000`, so other devices can open `http://<rms-host>:5000`.
- Auto-detects common USB serial devices when `TPARC_SERIAL_PORT` is unset.
- Installs missing Python packages with pip unless disabled.

Useful overrides:

```bash
TPARC_SERIAL_PORT=<serial-port> python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
TPARC_PORT=8080 python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
TPARC_AUTO_INSTALL=0 python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
TPARC_OPEN_BROWSER=0 python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
```

If the Pi cannot access the serial device, add your user to the serial group and reboot:

```bash
sudo usermod -a -G dialout $USER
sudo reboot
```

## Running From The Project Folder

Use this when developing or editing the RMS source files.

### Raspberry Pi / Linux

```bash
cd dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TPARC_ALLOW_INSECURE_DEV=1
export TPARC_SERIAL_PORT=<serial-port>
python run.py
```

Open:

```text
http://127.0.0.1:5000/login
```

From another device on the same network:

```text
http://<rms-host>:5000/login
```

### Windows Development

```powershell
cd dashboard
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:TPARC_ALLOW_INSECURE_DEV='1'
$env:TPARC_SERIAL_PORT='<serial-port>'
python run.py
```

Open:

```text
http://127.0.0.1:5000/login
```

## Default Login

Default users are created on first run:

- `tparc` / `tparc0322`
- `operator` / `change-me-operator`
- `viewer` / `change-me-viewer`

Change these before field use or network use.

Roles:

- `admin`: settings, user creation, command controls, exports, telemetry views.
- `operator`: operations, markers, command controls, exports, telemetry views.
- `viewer`: read-only monitoring.

## Dashboard Pages

### Operations

Path:

```text
/
```

This is the main page. It is inspired by DJI FlightHub-style operator workflows, adapted to the TP-ARC telemetry we actually have.

Use it for:

- Mission-level overview.
- Relative telemetry trace.
- Aircraft heading cone.
- Photo, Inspect, and Anomaly markers.
- Event inspector.
- Basic state, heading, attitude, battery, and loop-rate status.

Important: until GPS/location telemetry exists in the firmware, the route display is a relative telemetry trace, not a real geospatial map.

### Live Telemetry

Path:

```text
/telemetry
```

Use this when you want to see everything the UAV is currently sending.

It includes:

- Live charts.
- Motor output.
- RC input and raw channel PWM.
- PID gains and outputs.
- Sensor fusion values.
- System state.
- Flight analysis summary.
- All live telemetry fields in a dense table.

The RMS emits each parsed serial packet immediately over Socket.IO. The UI can handle 10 to 15 Hz. Actual update rate depends on the firmware telemetry interval. For example:

- `100 ms` telemetry interval = about `10 Hz`.
- `500 ms` telemetry interval = about `2 Hz`.

### Network

Path:

```text
/network
```

Use this to check whether the ground-station link is healthy.

It includes:

- Serial status.
- Serial port and baud.
- Packet age.
- Packet count and byte count.
- Latest packet type.
- Socket.IO browser connection status.
- Socket transport.
- Receive rate.
- Estimated browser receive latency.
- Server/client time delta.
- Last raw serial line.
- Recent link events.

### Settings

Path:

```text
/settings
```

Admin-only page for:

- Creating users.
- Editing usernames, roles, and passwords.
- Deleting user accounts.
- Viewing recent audit logs.
- Sending battery alarm thresholds.
- Triggering the calibration command.

The Settings page prevents deleting the currently logged-in account and prevents removing the last remaining admin.

## Serial And Telemetry

Default baud:

```text
115200
```

Serial ports vary by OS, adapter, and hardware. Use your OS serial-device
manager, Arduino IDE port menu, or PySerial's port lister to find the correct
value.

Set the serial port:

```bash
export TPARC_SERIAL_PORT=<serial-port>
```

If `TPARC_SERIAL_PORT` is unset, the RMS tries to auto-detect common USB
serial devices. If none are found, it starts in simulated telemetry mode.

The RMS supports:

- Latest JSON telemetry packets from the controller firmware.
- Older `TEL:key=value` packets.
- `EVT:`, `ACK:`, and `ERR:` serial lines.

If the serial port cannot be opened, the RMS runs in simulated telemetry mode so the dashboard still loads.

## Environment Variables

Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TPARC_ALLOW_INSECURE_DEV` | unset | Set to `1` for HTTP local/dev mode on port 5000. |
| `TPARC_SERIAL_PORT` | auto-detect when unset | Arduino serial port. Set this to the actual port for your hardware. |
| `TPARC_SERIAL_BAUD` | `115200` | Serial baud rate. |
| `TPARC_PORT` | `5000` in single-file launcher | HTTP port. |
| `TPARC_HOST` | `0.0.0.0` in single-file launcher | Listen address. |
| `TPARC_DB` | `tparc.sqlite3` or single-file runtime DB | SQLite database path. |
| `TPARC_SECRET_KEY` | random per process unless set | Flask session signing key. Set this for persistent production use. |
| `TPARC_SESSION_MINUTES` | `30` | Session timeout. |
| `TPARC_RMS_KILL_ENABLED` | `0` | Enables RMS kill endpoint only when set to `1`. |
| `TPARC_AUTO_INSTALL` | `1` in single-file launcher | Auto-install missing packages. |
| `TPARC_OPEN_BROWSER` | `1` in single-file launcher | Open browser on startup. |

## Safety Notes

- Keep RMS kill disabled unless the firmware `RMS_KILL_ENABLED` switch is also intentionally enabled and tested.
- The physical transmitter CH6 kill switch remains the primary safety control during bring-up.
- Test with props removed before relying on telemetry, controls, or PID commands.
- Change the default passwords before connecting the Pi to a shared network.
- Use TLS before any real deployment beyond local bench testing.

## Exports And Recording

Telemetry is stored in SQLite. The default database is `tparc.sqlite3`.

Available exports:

- CSV: all known telemetry fields or selected fields.
- JSON: complete telemetry payloads.
- PDF: compact telemetry report.
- PNG: current chart image from the browser.

Markers:

- Operations page buttons add Photo, Inspect, and Anomaly markers.
- Telemetry page has a free-form Mark button.
- Markers are recorded into the telemetry database.

## Troubleshooting

### Dashboard loads but serial is simulated

List serial ports:

```bash
python3 -m serial.tools.list_ports
```

Run with the correct port:

```bash
TPARC_SERIAL_PORT=<serial-port> python3 deploy/raspberry_pi/TP_ARC_RMS_single.py
```

Check user permissions:

```bash
groups
sudo usermod -a -G dialout $USER
sudo reboot
```

### Browser cannot open from another device

Find the Pi IP:

```bash
hostname -I
```

Open:

```text
http://<rms-host>:5000/login
```

Make sure the Pi and laptop/tablet are on the same network.

### Telemetry is slower than expected

The RMS can display packets as fast as it receives them, but the firmware decides how often packets are printed. For 10 Hz, the firmware must print about every `100 ms`. For 15 Hz, it must print about every `67 ms`.

### Missing Python packages

For project-folder runs:

```bash
pip install -r requirements.txt
```

For the single-file launcher, leave auto-install enabled or run:

```bash
python3 -m pip install Flask==3.0.3 Flask-SocketIO==5.3.6 eventlet==0.36.1 pyserial==3.5 bcrypt==4.1.3 reportlab==4.2.2
```

### Reset the single-file runtime

Remove the extracted runtime folder. The default is a per-user folder named
`.tparc_rms_single`; `TPARC_SINGLE_RUNTIME` can override it.

```bash
rm -rf <runtime-dir>
```

The next run will unpack a fresh copy.

## File Layout

Project-folder version:

```text
dashboard/
  run.py
  requirements.txt
  app/
    __init__.py
    auth.py
    routes.py
    serial_worker.py
    storage.py
    telemetry.py
    templates/
    static/
```

Single-file version:

```text
deploy/raspberry_pi/TP_ARC_RMS_single.py
```

The single-file version embeds the app bundle and extracts it at runtime.

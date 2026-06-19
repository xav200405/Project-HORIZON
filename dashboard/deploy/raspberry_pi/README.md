# Raspberry Pi Deployment

This folder contains the Raspberry Pi packaging workflow for TP-ARC RMS.

For the full user guide, read `../../../docs/STEP_BY_STEP_GUIDE.md`.

## Build The Package

From this folder:

```bash
python3 build_pi_app_package.py
```

The package is created in:

```text
dist/
```

## Install On The Pi

1. Copy `dist/tparc-rms-pi-app-*.tar.gz` to the Raspberry Pi.

2. Extract it:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
```

3. Enter the package folder:

```bash
cd tparc-rms-pi-app
```

4. Install the service:

```bash
sudo bash install.sh
```

The installed app runs as `tparc-rms.service`, starts on boot, keeps config in
`/etc/tparc-rms/tparc-rms.env`, and stores telemetry data under
`/var/lib/tparc-rms`.

The installer handles Raspberry Pi OS's protected Python environment by using
`apt` for OS prerequisites and a private app virtual environment under
`/opt/tparc-rms/venv`.

## Open The Dashboard

1. Find the Pi IP:

```bash
hostname -I
```

2. Open this URL from a browser on the same network:

```text
http://<raspberry-pi-ip>:5000/login
```

3. Log in as `tparc` / `tparc0322`.

4. Change the default passwords in Settings.

## Update An Installed Pi

Manual update:

1. Copy a newer package to the Pi.

2. Extract it:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
```

3. Run the package updater:

```bash
cd tparc-rms-pi-app
sudo bash update.sh
```

The update script preserves `/etc/tparc-rms/tparc-rms.env` and
`/var/lib/tparc-rms`.

## Firmware Upload

Admins can open the RMS Firmware page to upload `.ino` sketches or zipped
Arduino sketch folders to the flight controller through the Raspberry Pi's USB
serial connection. The installer tries to install `arduino-cli`, `avrdude`,
and the common `arduino:avr` core for Uno/Nano/Mega targets. If your Pi OS
image does not provide `arduino-cli` through apt, install it separately and set
`TPARC_ARDUINO_CLI` in `/etc/tparc-rms/tparc-rms.env`.

During firmware upload, the RMS pauses its telemetry serial reader, runs
`arduino-cli compile`, runs `arduino-cli upload`, then restarts telemetry.
Every attempt is recorded in the audit log.

Automatic GitHub update:

1. Create a GitHub release in
`xav200405/Project-HORIZON` with the package tarball as an asset. If no
matching release asset exists, the updater falls back to scanning under
`dashboard` for `tparc-rms-pi-app-*.tar.gz`, so future folders such as
`dashboard/2026.REV01.1/dist` do not require Pi config changes. The packaged
config already sets `TPARC_UPDATE_REPO=xav200405/Project-HORIZON` and
`TPARC_UPDATE_SOURCE_PATH=dashboard`.

2. Run this on the Pi:

```bash
sudo bash /opt/tparc-rms/update.sh
```

The original standalone launcher is still available:

```bash
python3 TP_ARC_RMS_single.py
```

Use that when you want a temporary one-command run instead of installing a
service.

## Default Admin

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change the default credentials from the RMS Settings page before field use.

## Useful Environment Variables

For the installed service, edit `/etc/tparc-rms/tparc-rms.env` and restart:

```bash
sudo systemctl restart tparc-rms
```

For the standalone launcher:

```bash
TPARC_SERIAL_PORT=<serial-port> python3 TP_ARC_RMS_single.py
TPARC_PORT=8080 python3 TP_ARC_RMS_single.py
TPARC_AUTO_INSTALL=0 python3 TP_ARC_RMS_single.py
TPARC_OPEN_BROWSER=0 python3 TP_ARC_RMS_single.py
```

Read `../../../docs/SAFETY_ADVISORY.md` before connecting aircraft hardware.

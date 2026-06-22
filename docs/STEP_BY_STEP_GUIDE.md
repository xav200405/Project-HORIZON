# Project HORIZON Step-by-Step Guide

This guide is for setting up, using, updating, and maintaining the TP-ARC
Raspberry Pi Remote Monitoring System (RMS) and Arduino firmware workflow.

Read `docs/SAFETY_ADVISORY.md` before connecting motors, propellers,
batteries, RF links, or flight hardware.

## 1. What You Need

- Raspberry Pi 3B or newer running Raspberry Pi OS.
- Arduino flight controller connected to the Pi by USB.
- Laptop, tablet, or desktop browser on the same network as the Pi.
- The latest `tparc-rms-pi-app-*.tar.gz` package from this repository.
- Admin login for the RMS.

Default first-run accounts:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |
| `operator` | `change-me-operator` | `operator` |
| `viewer` | `change-me-viewer` | `viewer` |

Change these passwords from Settings before field use.

## 2. Install The RMS On A Raspberry Pi

1. Download or copy the newest package to the Raspberry Pi.

   Preferred package path in this repo:

   ```text
   dashboard/v1.5.1/dist/tparc-rms-pi-app-2026.06-rev01.10.tar.gz
   ```

2. Open a terminal on the Pi and go to the folder containing the package.

3. Extract the package:

   ```bash
   tar -xzf tparc-rms-pi-app-*.tar.gz
   ```

4. Enter the extracted folder:

   ```bash
   cd tparc-rms-pi-app
   ```

5. Run the installer:

   ```bash
   sudo bash install.sh
   ```

6. Check that the service is running:

   ```bash
   sudo systemctl status tparc-rms
   ```

7. Find the Pi's IP address:

   ```bash
   hostname -I
   ```

8. Open the RMS from another device on the same network:

   ```text
   http://<raspberry-pi-ip>:5000/login
   ```

9. Log in with the default admin account.

10. Open Settings and change the default passwords.

The installer creates:

| Path | Purpose |
| --- | --- |
| `/opt/tparc-rms/` | Installed launcher, updater, and Python virtual environment. |
| `/etc/tparc-rms/tparc-rms.env` | Main configuration file. |
| `/var/lib/tparc-rms/` | Database, runtime extraction, and firmware upload workspace. |
| `/etc/systemd/system/tparc-rms.service` | Systemd service. |

## 3. Configure The Arduino Serial Port

The RMS auto-detects common Linux serial devices such as `/dev/ttyACM0` and
`/dev/ttyUSB0`. If auto-detection picks the wrong port, set it manually.

1. List serial ports:

   ```bash
   python3 -m serial.tools.list_ports
   ```

2. Edit the RMS config:

   ```bash
   sudo nano /etc/tparc-rms/tparc-rms.env
   ```

3. Set the port:

   ```bash
   TPARC_SERIAL_PORT=/dev/ttyACM0
   ```

4. Restart the service:

   ```bash
   sudo systemctl restart tparc-rms
   ```

5. If serial access is denied, add the service user to `dialout` and reboot:

   ```bash
   sudo usermod -a -G dialout pi
   sudo reboot
   ```

## 4. Use The RMS Dashboard

Open:

```text
http://<raspberry-pi-ip>:5000/login
```

### Overview

Use Overview for client-presentable monitoring:

- Battery, heading, attitude, and loop-rate summary.
- Main Power graph first, with Attitude, Motors, Control, and Health groups.
- Telemetry analysis summary.

### Telemetry

Use Telemetry for detailed engineering review:

- Live charts by telemetry group.
- Motor output.
- RC input and raw channel values.
- PID gains and outputs.
- Sensor fusion.
- System state.
- Raw telemetry.
- Current fields.
- Full live telemetry table.
- CSV, JSON, PDF, and PNG exports.

### Battery Display

The RMS expects the flight controller to emit battery telemetry from the A0
stepped-down monitor signal. The dashboard treats 5.00V on A0 as 100%.
It recognizes `battery_voltage`, `battery_monitor_voltage`, `battery_soc`,
`battery_percent`, `battery_alarm`, `battery_valid`, and
`battery_monitor_enabled`.

If the Battery card says `No signal`:

1. Confirm the Arduino firmware has `BATTERY_MONITOR_ENABLED true`.
2. Confirm the divider output is connected to Arduino A0, not a Raspberry Pi
   GPIO pin.
3. Open Network and check the latest raw serial line for `battery_voltage`.
4. If voltage is shown but marked invalid, check that A0 never exceeds 5V and
   check the percentage threshold settings.

### Network

Use Network when the data link looks unhealthy:

- Serial status.
- Serial port and baud.
- Packet age and packet rate.
- Browser/socket connection status.
- Latest raw serial line.

### Firmware

Admin-only page for remote Arduino firmware upload through the Raspberry Pi.

### Settings

Admin-only page for:

- User creation and password changes.
- Roles.
- Audit log.
- Battery percentage alarm thresholds.
- Calibration trigger.

## 5. Upload Arduino Firmware Through The RMS

The Pi must be connected to the Arduino over USB.

1. Log in as an admin.

2. Open Firmware from the top navigation.

3. Confirm that `arduino-cli` is shown as ready.

4. Select the detected Arduino serial port.

5. Select the board FQBN.

   Common options:

   | Board | FQBN |
   | --- | --- |
   | Arduino Uno | `arduino:avr:uno` |
   | Arduino Nano | `arduino:avr:nano` |
   | Arduino Nano old bootloader | `arduino:avr:nano:cpu=atmega328old` |
   | Arduino Mega 2560 | `arduino:avr:mega` |

6. Choose a firmware file:

   - `.ino` file, or
   - `.zip` containing an Arduino sketch folder.

7. Use Compile only first when testing a new sketch.

8. When compile succeeds, run Compile and upload.

9. Watch the Upload log for compiler and uploader output.

10. After upload finishes, the RMS restarts its telemetry serial reader.

Notes:

- The RMS pauses telemetry serial access during upload so `arduino-cli` can use
  the USB serial port.
- Every firmware upload attempt is recorded in the audit log.
- If `arduino-cli` is missing, install it on the Pi or set `TPARC_ARDUINO_CLI`
  in `/etc/tparc-rms/tparc-rms.env`.

Useful firmware settings:

```bash
TPARC_ARDUINO_CLI=arduino-cli
TPARC_ARDUINO_DEFAULT_FQBN=arduino:avr:uno
TPARC_FIRMWARE_UPLOAD_DIR=/var/lib/tparc-rms/firmware
TPARC_FIRMWARE_TIMEOUT=600
TPARC_FIRMWARE_MAX_MB=8
```

Restart after changing config:

```bash
sudo systemctl restart tparc-rms
```

## 6. Update The RMS From GitHub

The installed updater already knows this repository:

```bash
TPARC_UPDATE_REPO=xav200405/Project-HORIZON
TPARC_UPDATE_SOURCE_PATH=dashboard
```

Preferred update flow:

1. Publish a GitHub Release.

2. Attach the newest `tparc-rms-pi-app-*.tar.gz` package as a release asset.

3. On the Pi, run:

   ```bash
   sudo bash /opt/tparc-rms/update.sh
   ```

Fallback update flow:

1. Commit the package somewhere under `dashboard/`.

2. On the Pi, run:

   ```bash
   sudo bash /opt/tparc-rms/update.sh
   ```

3. If no release asset is found, the updater scans under `dashboard` for
   `tparc-rms-pi-app-*.tar.gz` and installs the newest matching package.

Manual package update:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
cd tparc-rms-pi-app
sudo bash update.sh
```

The update script preserves:

- `/etc/tparc-rms/tparc-rms.env`
- `/var/lib/tparc-rms`

## 7. Build A New Pi Package From Source

From the repository root:

```bash
cd dashboard/deploy/raspberry_pi
python3 build_pi_app_package.py
```

The package appears in:

```text
dashboard/deploy/raspberry_pi/dist/
```

For the current release drop, use:

```text
dashboard/v1.5.1/dist/
```

## 8. Run The RMS Locally For Development

Windows PowerShell:

```powershell
cd dashboard
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:TPARC_ALLOW_INSECURE_DEV='1'
python run.py
```

Open:

```text
http://127.0.0.1:5000/login
```

Raspberry Pi or Linux:

```bash
cd dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export TPARC_ALLOW_INSECURE_DEV=1
python run.py
```

## 9. Troubleshooting

### Dashboard Loads But Telemetry Is Simulated

Check serial ports:

```bash
python3 -m serial.tools.list_ports
```

Set `TPARC_SERIAL_PORT` in `/etc/tparc-rms/tparc-rms.env`, then restart:

```bash
sudo systemctl restart tparc-rms
```

### Browser Cannot Reach The Pi

Check the Pi IP:

```bash
hostname -I
```

Open:

```text
http://<raspberry-pi-ip>:5000/login
```

Make sure both devices are on the same network.

### Firmware Upload Cannot Find Arduino CLI

Check:

```bash
which arduino-cli
arduino-cli version
```

If it is installed somewhere custom, set:

```bash
TPARC_ARDUINO_CLI=/path/to/arduino-cli
```

Then restart:

```bash
sudo systemctl restart tparc-rms
```

### Firmware Upload Cannot Open Serial Port

1. Close Arduino IDE or any other serial monitor.
2. Confirm the RMS service user is in `dialout`.
3. Reboot after changing groups.
4. Reopen the Firmware page and refresh status.

### Update Cannot Find A Package

Use a GitHub Release asset whenever possible. If relying on the fallback scan,
make sure the package filename matches:

```text
tparc-rms-pi-app-*.tar.gz
```

and that it is committed somewhere under:

```text
dashboard/
```

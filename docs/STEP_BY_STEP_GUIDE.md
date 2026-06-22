# Project HORIZON Step-by-Step Guide

This guide is for setting up, using, updating, and maintaining the TP-ARC
Raspberry Pi Remote Monitoring System (RMS).

Read `docs/SAFETY_ADVISORY.md` before connecting motors, propellers,
batteries, RF links, or flight hardware.

## 1. What You Need

- Raspberry Pi 3B or newer running Raspberry Pi OS.
- Arduino flight controller connected to the Pi by USB.
- Laptop, tablet, or desktop browser on the same network as the Pi.
- The latest `tparc-rms-pi-app-*.tar.gz` package from this repository.
- Admin login for the RMS.

Default first-run account:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change this password from Settings before field use. Create operator or viewer
accounts later only when needed.

## 2. Install The RMS On A Raspberry Pi

1. Download or copy the newest package to the Raspberry Pi.

   Preferred package path in this repo:

   ```text
   dashboard/v1.5.1/dist/tparc-rms-pi-app-2026.06-rev01.18.tar.gz
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
| `/var/lib/tparc-rms/` | Database and runtime extraction workspace. |
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
- Barometer pressure, temperature, and relative altitude.
- System state.
- Raw telemetry.
- Current fields.
- Full live telemetry table.
- CSV and JSON data exports.
- Report PDF export.
- Current graph PDF and image exports.

### Battery Display

The RMS expects the flight controller to emit battery telemetry from the A0
stepped-down monitor signal. The dashboard treats 5.00V on A0 as 100%.
It recognizes `battery_voltage`, `battery_monitor_voltage`, `battery_soc`,
`battery_percent`, `battery_alarm`, `battery_valid`, and
`battery_monitor_enabled`.

### Barometer Display

The flight controller initializes a BMP280/BME280 barometer at I2C address
`0x76` for telemetry only. The RMS shows a Barometer card and a Barometer graph
tab when packets include `baro_ok`, `baro_status`, `baro_pressure_pa`,
`baro_temperature_c`, `baro_altitude_m`, and `baro_relative_altitude_m`.

Altitude hold is not enabled by this feature. Treat the displayed altitude as a
monitoring aid until the sensor has been bench-tested in the final enclosure.

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

### Settings

Admin-only page for:

- User creation and password changes.
- Roles.
- Audit log.
- Battery percentage alarm thresholds.
- Calibration trigger.

## 5. Update The RMS From GitHub

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

## 6. Fully Uninstall The RMS

Use this when you want a completely fresh install with no old database,
configuration, runtime files, or service state left behind.

1. Extract any current RMS package on the Pi.

2. Enter the package folder:

   ```bash
   cd tparc-rms-pi-app
   ```

3. Run the full uninstall script:

   ```bash
   sudo bash uninstall_all.sh
   ```

This removes `/opt/tparc-rms`, `/etc/tparc-rms`, `/var/lib/tparc-rms`, the
`tparc-rms.service` systemd unit, telemetry data, and runtime cache.

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

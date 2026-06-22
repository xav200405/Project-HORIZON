# Project HORIZON / TP-ARC UAV System

Experimental Arduino flight-controller firmware, calibration software, and a
Raspberry Pi remote monitoring system (RMS) for the TP-ARC self-levelling UAV
platform.

## Safety First

This repository contains experimental UAV software. It is not certified
flight software and must not be treated as airworthy, production-ready, or
regulatory-approved.

Read [docs/SAFETY_ADVISORY.md](docs/SAFETY_ADVISORY.md) before using this
project with powered motors, propellers, batteries, RF links, or aircraft
hardware.

The software and documentation are provided under the Apache License,
Version 2.0 on an "AS IS" basis, without warranties or conditions of any
kind. See [LICENSE](LICENSE), [NOTICE](NOTICE), and the non-liability section
in the safety advisory.

## What Is Included

- Arduino Uno flight controller firmware with sensor fusion, PID loops,
  motor mixing, RC input capture, telemetry, arming diagnostics, and failsafe
  behavior.
- Arduino serial calibration wizard for IMU, compass, barometer, RC, ESC, and
  EEPROM-backed calibration data.
- Raspberry Pi RMS with a client-presentable telemetry overview, detailed live
  graphs, networking telemetry, account management, data recording, exports,
  audit logs, and app updates.
- An installable Raspberry Pi RMS app package plus a one-file launcher for
  temporary runs.
- Static validation tooling and documentation for future UAV adaptation.

## Project Origin

This project was created at Temasek Polytechnic, ENG West Wing Block 25A,
Unit #03-22, Aviation Research Centre.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `dashboard/` | Active RMS Flask/Socket.IO source and Raspberry Pi deployment launcher. |
| `firmware/` | Active Arduino firmware and calibration sketches. |
| `docs/` | Safety advisory, repository structure, status, and requirements traceability. |
| `tools/` | Static validation and local build helper tools. |

More detail is in [docs/REPOSITORY_STRUCTURE.md](docs/REPOSITORY_STRUCTURE.md).

## Start Here

For a complete walkthrough, use
[docs/STEP_BY_STEP_GUIDE.md](docs/STEP_BY_STEP_GUIDE.md). It covers:

- Installing the RMS on a Raspberry Pi.
- Opening the dashboard and changing default passwords.
- Configuring the Arduino serial port.
- Reading telemetry through Overview, Telemetry, and Network pages.
- Updating the app from GitHub.
- Building new Pi packages from source.
- Troubleshooting common serial, browser, and update issues.

## Raspberry Pi RMS Quick Start

Build the installable app package:

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
and stores configuration in `/etc/tparc-rms/tparc-rms.env`.

The Pi package installs the RMS in a private virtual environment. Arduino
firmware is kept in the repository under `firmware/` and should be flashed with
normal Arduino tools outside the RMS.

To update an installed Pi later, extract the newer package and run:

```bash
cd tparc-rms-pi-app
sudo bash update.sh
```
To completely remove the RMS from a Pi before a fresh install, run this from an
extracted package folder:

```bash
sudo bash uninstall_all.sh
```

For automatic GitHub updates, publish the Pi package tarball as a release asset
in `xav200405/Project-HORIZON`. If no matching release asset exists, the updater
falls back to scanning under `dashboard` for `tparc-rms-pi-app-*.tar.gz`, so
future folders such as `dashboard/2026.REV01.1/dist` do not require Pi config
changes. The packaged config already sets
`TPARC_UPDATE_REPO=xav200405/Project-HORIZON` and
`TPARC_UPDATE_SOURCE_PATH=dashboard`, so an installed Pi can update itself with
`sudo bash /opt/tparc-rms/update.sh`.

Default bootstrap users are created on first run:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |
| `operator` | `change-me-operator` | `operator` |
| `viewer` | `change-me-viewer` | `viewer` |

Change these credentials from the RMS Settings page before field use. Do not
expose the RMS to untrusted networks while default credentials are active.

For the step-by-step version of these instructions, including screenshots-to-use
checkpoints, read
[docs/STEP_BY_STEP_GUIDE.md](docs/STEP_BY_STEP_GUIDE.md).

## Local RMS Development

```powershell
cd dashboard
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run.py
```

Open `https://<rms-host>:8443` when TLS certificates are configured. For local
development without certificates, set `TPARC_ALLOW_INSECURE_DEV=1` and open
`http://127.0.0.1:5000`.

## Firmware Notes

The flight firmware is written for Arduino Uno constraints: no dynamic
allocation, fixed control-loop periods via `micros()`, `Wire.h` for I2C,
`Servo.h` for ESC PWM, and EEPROM-backed calibration data.

Current deployment defaults:

- `BATTERY_MONITOR_ENABLED = true` for the verified A0 stepped-down monitor
  signal. Firmware treats 5.00V on A0 as 100% and emits monitor voltage,
  battery percentage, alarm level, and validity in JSON telemetry.
- `COMPASS_REQUIRED_TO_ARM = false`, so missing compass data falls back to
  yaw-rate command mode instead of silently blocking all arming.
- The physical CH6 transmitter kill switch is the active bring-up kill path.
- RMS/digital kill is present but disabled by default in firmware and
  dashboard until deliberately commissioned.

## Verification

Run the static self-check:

```powershell
python tools\self_check.py
```

Compile both Arduino sketches when Arduino CLI is available:

```powershell
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\flight_controller\controller_firmware_v2.6.1
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\calibration_wizard\CalibrationWizard
```

Last local verification:

- Flight controller `controller_firmware_v2.6.1.ino`: `24878` bytes flash,
  `929` bytes RAM.
- Calibration wizard `CalibrationWizard.ino`: `23242` bytes flash,
  `647` bytes RAM.

## Documentation

- [docs/SAFETY_ADVISORY.md](docs/SAFETY_ADVISORY.md) - warnings,
  operational safety notes, and non-liability notice.
- [dashboard/README.md](dashboard/README.md) - RMS operation and feature guide.
- [dashboard/CONFIGURATION.md](dashboard/CONFIGURATION.md) - RMS deployment
  configuration for different UAVs.
- [docs/STATUS.md](docs/STATUS.md) - current hardware bring-up and
  verification state.
- [docs/requirements_matrix.md](docs/requirements_matrix.md) - project
  requirement coverage notes.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

This project is provided without warranty and without contributor liability,
except where applicable law requires otherwise. See [docs/SAFETY_ADVISORY.md](docs/SAFETY_ADVISORY.md).

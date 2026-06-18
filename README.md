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
- Raspberry Pi RMS with live telemetry, networking telemetry, account
  management, data recording, export tools, charts, audit logs, and
  FlightHub-inspired operational views.
- A one-file Raspberry Pi launcher for simpler field deployment.
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

## Which File Do I Run?

For the Raspberry Pi RMS, run exactly:

```bash
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py
```

For local dashboard source development only, run:

```bash
python dashboard/run.py
```

## Raspberry Pi RMS Quick Start

Copy the repository or at least `dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py` to
the Raspberry Pi, then run from the repository root:

```bash
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py
```

The launcher unpacks the RMS to a per-user runtime folder, prepares
dependencies when allowed, and starts the dashboard. Set
`TPARC_SINGLE_RUNTIME=<runtime-dir>` to choose a different runtime location.

Default bootstrap users are created on first run:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |
| `operator` | `change-me-operator` | `operator` |
| `viewer` | `change-me-viewer` | `viewer` |

Change these credentials from the RMS Settings page before field use. Do not
expose the RMS to untrusted networks while default credentials are active.

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

Current hardware bring-up defaults:

- `BATTERY_MONITOR_ENABLED = false` until the A0 battery-divider hardware is
  installed and verified.
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
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\flight_controller\controller_firmware
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\calibration_wizard\CalibrationWizard
```

Last local verification:

- Flight controller `controller_firmware.ino`: `21486` bytes flash,
  `781` bytes RAM.
- Calibration wizard `CalibrationWizard.ino`: `21732` bytes flash,
  `595` bytes RAM.

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

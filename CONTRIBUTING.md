# Contributing

Thanks for helping improve Project HORIZON. This project touches flight
control, batteries, RF links, and live vehicle telemetry, so changes should
be made with extra care.

## Ground Rules

- Treat all flight-control changes as safety-sensitive.
- Do not claim airworthiness, certification, regulatory compliance, or
  production readiness unless that has been independently verified.
- Keep default safety interlocks conservative.
- Do not commit secrets, Wi-Fi passwords, TLS private keys, telemetry
  databases, local logs, or virtual environments.
- Document configuration changes that would affect future UAV deployments.

## Before Opening a Pull Request

Run the static self-check:

```powershell
python tools\self_check.py
```

Compile both Arduino sketches when Arduino CLI is available:

```powershell
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\flight_controller\controller_firmware
tools\arduino-cli\arduino-cli.exe --config-file tools\arduino-cli\arduino-cli.yaml compile --fqbn arduino:avr:uno firmware\calibration_wizard\CalibrationWizard
```

For RMS changes, run the dashboard locally and verify login, telemetry
streaming, exports, settings, and command controls.

## Contribution License

Unless explicitly stated otherwise, submitted contributions are provided
under the Apache License, Version 2.0.

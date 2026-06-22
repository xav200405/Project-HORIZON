# Repository Structure

This repository is organized so GitHub users can quickly tell the difference
between active source, deployable artifacts, documentation, and tools.

## Top-Level Folders

| Path | Purpose |
| --- | --- |
| `dashboard/` | Active Raspberry Pi RMS Flask/Socket.IO source and deployment launcher. |
| `firmware/` | Active Arduino firmware and calibration sketches. |
| `docs/` | Project documentation, safety notes, status, and traceability. |
| `tools/` | Local validation and build support tools. |

## Source of Truth

- RMS development source: `dashboard/`
- Flight firmware source: `firmware/flight_controller/controller_firmware_v2.6.1/`
- Calibration wizard source: `firmware/calibration_wizard/CalibrationWizard/`
- Pi one-file RMS launcher: `dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py`

There is no duplicate `code_sets/` folder. Edit the active source folders
directly.

## Files Not Intended for GitHub

The `.gitignore` excludes local runtime and build artifacts, including:

- dashboard virtual environments
- SQLite telemetry/account databases
- server logs
- TLS private keys and certificates
- Python bytecode caches
- Arduino build output and downloaded tool packages

If a generated file contains field telemetry, account data, keys, or local
machine state, do not commit it.

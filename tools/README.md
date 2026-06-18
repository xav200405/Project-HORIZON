# Tools

This folder contains local validation and build helper files.

## Self-Check

Run:

```powershell
python tools\self_check.py
```

The self-check performs static validation of firmware invariants, dashboard
telemetry parsing, RMS safety controls, and documentation references.

## Arduino CLI

The `tools/arduino-cli/` folder may contain a local Arduino CLI installation
and downloaded cores/libraries. These are ignored by Git because they can be
large and machine-specific.

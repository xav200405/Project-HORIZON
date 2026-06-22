# Firmware

This folder contains the active Arduino source for the TP-ARC flight system.

## Folders

- `flight_controller/controller_firmware_v2.6.1/` - flight firmware for
  stabilization, RC input, telemetry, failsafe, arming, and motor output.
- `calibration_wizard/CalibrationWizard/` - serial calibration sketch for IMU, compass,
  barometer, RC, ESC, and EEPROM persistence.

## Safety

Remove propellers before flashing, calibrating, or testing. Verify motor
order, RC failsafe, sensor orientation, and the CH6 physical kill switch
before attempting any powered aircraft test.

See `../docs/SAFETY_ADVISORY.md`.

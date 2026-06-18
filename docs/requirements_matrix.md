# Project HORIZON Requirements Matrix

Source: project prompt supplied during development.

## Parts A-G: Flight Controller Firmware

| Requirement | Implementation |
|---|---|
| Arduino Uno / ATmega328P C++ with `Wire.h` and `Servo.h` | `firmware/flight_controller/controller_firmware/controller_firmware.ino` |
| Motor pins D6/D9/D10/D11 and X-frame equations | `mixMotors()` |
| 400 Hz rate loop, 200 Hz attitude loop, 50 Hz outer loop | `loop()` scheduler constants |
| Complementary roll/pitch filter with alpha 0.98 | `updateComplementaryFilter()` |
| Compass/gyro yaw fusion with wrap-around | `updateYawFusion()` |
| Generic PID with saturation anti-windup | `PIDController::update()` |
| Heading hold/command state machine | `updateHeadingControl()` |
| RC normalization, deadbands, arming/disarming holds | `updateReceiver()`, `detectArming()` |
| Failsafe on RC loss, sensor health, tilt, watchdog reset | `checkFailsafe()` |
| Serial telemetry and command handling | `emitTelemetry()`, `handleSerialCommand()` |

## Part H: Intelligent Battery Monitoring

| Requirement | Implementation |
|---|---|
| 4S LiPo voltage divider on A0 | `readBattery()` |
| Pack voltage, cell voltage, SoC, alarm thresholds | `BatteryState`, threshold constants |
| Alarm levels LOW/CRITICAL/EMERGENCY | `classifyBatteryAlarm()` |
| Telemetry fields for Pi dashboard | `emitTelemetry()` emits `BV`, `BCELL`, `BSOC`, `BALARM`, `BVALID` |
| Pi parser and dashboard battery panel | `dashboard/app/telemetry.py`, `dashboard/app/static/js/dashboard.js` |

## Part I: Calibration Wizard

| Requirement | Implementation |
|---|---|
| Interactive serial menu with guided full calibration | `firmware/calibration_wizard/CalibrationWizard/CalibrationWizard.ino` |
| EEPROM layout with magic/version/CRC | `CalibrationBlob`, `saveCalibration()`, `loadCalibration()` |
| Gyro, accel 6-point, HW-127/QMC5883P compass, barometer, RC, ESC workflows | Individual menu handlers plus `runAllCalibrations()` |
| Countdown timers in Serial Monitor | `countdownSeconds()` and `progressCountdown()` |
| Clear accelerometer pose instructions | `printAccelOrientation()` in v3 wizard |
| Compass calibration finesse and quality feedback | Guided compass phases plus `printCompassCoverage()` |
| Validation/reporting | `printValidationReport()` |

## Part J: Wireless Dashboard

| Requirement | Implementation |
|---|---|
| Flask backend, WebSocket telemetry | `dashboard/app/__init__.py`, `dashboard/app/serial_worker.py` |
| SQLite audit log and telemetry persistence | `dashboard/app/storage.py` |
| bcrypt password hashing and RBAC | `dashboard/app/auth.py` |
| Login, session timeout, brute-force lockout | `dashboard/app/auth.py`, templates |
| PID tuning, kill switch, serial commands | `dashboard/app/routes.py`, `dashboard/app/serial_worker.py` |
| CSV/PDF/PNG export support | `dashboard/app/routes.py`, frontend chart export |
| Dashboard panels and alert banner | `dashboard/app/templates/dashboard.html`, static JS/CSS |

## Known deployment work

- Install Python dependencies on the Raspberry Pi.
- Provide TLS certificate/key for production service on port 8443.
- Compile/upload Arduino sketches with the Arduino IDE or CLI.
- Tune PID gains and voltage divider constants on real hardware.

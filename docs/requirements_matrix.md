# Project HORIZON Requirements Matrix

Source: project prompt supplied during development.

## Parts A-G: Flight Controller Firmware

| Requirement | Implementation |
|---|---|
| Arduino Uno / ATmega328P C++ with `Wire.h`, `EEPROM.h`, and `Servo.h` behavior through timed ESC pulses | `firmware/flight_controller/controller_firmware_v2.6.1/controller_firmware_v2.6.1.ino` |
| Motor pins D6/D9/D10/D11 and current X-frame equations | `mixMotors()` |
| 250 Hz ESC/control loop with lower-rate compass, barometer, battery, and telemetry tasks | `LOOP_TIME_US`, `COMPASS_UPDATE_INTERVAL_MS`, `BARO_UPDATE_INTERVAL_MS`, `BATTERY_SAMPLE_INTERVAL_MS`, `TELEMETRY_INTERVAL_MS`, `loop()` |
| Complementary roll/pitch filter with MPU roll/pitch axis swap for current board orientation | `updateAngles()`, `SWAP_ROLL_PITCH_AXES` |
| Compass heading readout and heading-hold/command state machine | `updateCompass()`, `updateHeadingHoldFromYawStick()` |
| PID with saturation and anti-windup | `calculate_pid()`, `MAX_PID_OUTPUT`, `constrainFloat()` |
| RC capture, normalization, deadbands, arming/disarming holds | `processRxEdge()`, `copyAndCalibrateReceiver()`, `check_safety_and_arming()` |
| Failsafe on RC loss, sensor health, CH6 physical lockout, and battery emergency/invalid state | `check_safety_and_arming()`, `emergencyLockoutActive`, `batteryFailsafeActive` |
| Serial telemetry and command handling | `printTelemetryJson()`, `handleTelemetry()`, `handleSerialTuning()` |
| BMP280/BME280 telemetry without altitude-hold control | `setupBarometer()`, `updateBarometer()`, `printTelemetryJson()` |

## Part H: Intelligent Battery Monitoring

| Requirement | Implementation |
|---|---|
| 0-5V stepped-down monitor signal on A0 | `updateBatteryMonitor()` |
| A0 monitor voltage, battery percentage, alarm thresholds | `BatteryState`, threshold constants, `handleBatteryCommand()` |
| Alarm levels LOW/CRITICAL/EMERGENCY | `classifyBatteryAlarm()` |
| Telemetry fields for Pi dashboard | `printTelemetryJson()` emits battery fields plus `baroOK`, `baroStatus`, `baroPressurePa`, `baroTempC`, `baroAltitudeM`, and `baroRelativeAltitudeM` |
| Pi parser and dashboard battery panel | `dashboard/app/telemetry.py`, `dashboard/app/static/js/dashboard.js` |
| Pi parser and dashboard barometer panel/graph | `dashboard/app/telemetry.py`, `dashboard/app/templates/dashboard.html`, `dashboard/app/static/js/dashboard.js` |

## Part I: Calibration Wizard

| Requirement | Implementation |
|---|---|
| Interactive serial menu with guided full calibration | `firmware/calibration_wizard/CalibrationWizard/CalibrationWizard.ino` |
| EEPROM layout with magic/version/CRC | `CalibrationBlob`, `saveCalibration()`, `loadCalibration()` |
| Gyro, accel 6-point, HW-127/QMC5883P compass, barometer, RC, ESC workflows | Individual menu handlers plus `runAllCalibrations()` |
| Countdown timers in Serial Monitor | `countdownSeconds()` and `progressCountdown()` |
| Clear accelerometer pose instructions | Calibration Wizard guided accelerometer menu prompts |
| Compass calibration finesse and quality feedback | Guided compass phases plus `printCompassCoverage()` |
| Validation/reporting | `printValidationReport()` |

## Part J: Wireless Dashboard

| Requirement | Implementation |
|---|---|
| Flask backend, WebSocket telemetry | `dashboard/app/__init__.py`, `dashboard/app/serial_worker.py` |
| SQLite audit log and telemetry persistence | `dashboard/app/storage.py` |
| bcrypt password hashing and RBAC | `dashboard/app/auth.py` |
| Login, session timeout, brute-force lockout | `dashboard/app/auth.py`, templates |
| Live Roll/Pitch/Yaw PID tuning, battery thresholds, calibration trigger, and optional disabled-by-default RMS kill command | `dashboard/app/routes.py`, `dashboard/app/serial_worker.py`, firmware `handlePidCommand()` |
| CSV/JSON/report PDF export and graph PDF/image export support | `dashboard/app/routes.py`, frontend chart export |
| Dashboard panels and alert banner | `dashboard/app/templates/dashboard.html`, static JS/CSS |

## Known deployment work

- Install Python dependencies on the Raspberry Pi.
- Provide TLS certificate/key or a reverse proxy before exposing the RMS beyond trusted bench networks.
- Compile/upload Arduino sketches with the Arduino IDE or CLI outside the RMS.
- Tune PID gains and voltage divider constants on real hardware.

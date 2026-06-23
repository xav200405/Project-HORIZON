# Project HORIZON Status

The original source PDF was empty, so the implementation is based on the
readable plain-text project prompt supplied during development.
- Observed size: `143336` bytes
- Last checked: 2026-06-17

Current workspace contains the generated firmware, Calibration Wizard v4,
Raspberry Pi dashboard, documentation, and static self-validation tooling.

Project origin: Temasek Polytechnic, ENG West Wing Block 25A, Unit #03-22,
Aviation Research Centre.

Current flight controller firmware identity:

- Version: `FC-0.8.7`
- Revision: `2026-06-23.12`

Current RMS package identity:

- Package: `2026.06-rev01.20`
- Current release folder: `dashboard/v1.5.1/`
- Retired v1.5 and superseded v1.5.1 package builds are stored under `_archive/`.

## Current hardware bring-up defaults

- `BATTERY_MONITOR_ENABLED = true` in the flight controller for the verified A0 stepped-down monitor signal.
- Battery telemetry now reports A0 monitor voltage, percentage where 3.70V is 0% and 5.00V is 100%, alarm level, validity, scale endpoints, and active percentage thresholds. Invalid or emergency battery readings trigger a failsafe disarm latch.
- Default battery alarms are now low at 20% SOC, critical at 9% SOC, and emergency at 0% SOC. The dashboard also sounds a repeated battery alarm at low and critical levels.
- Flight firmware is still a smaller core stabilizer build. QMC5883P heading hold is back in a compact, nonfatal form; BMP280/BME280 barometer telemetry remains out of the active flight sketch to keep the control loop lean.
- Dashboard PID tuning now sends all Roll/Pitch/Yaw gain terms as a full `PID:` serial command. Firmware applies the values live without PID gain range rejection, resets PID integrators, and replies with `ACK:PID,...`.
- Flight firmware restored the more stable roll/pitch angle self-level controller: EEPROM-calibrated stick displacement maps to target angle, centered sticks command level attitude, and bounded PID output drives motor mixing.
- Yaw remains transmitter-priority rate command. When yaw is centered and the compass is healthy, heading hold captures the release heading and corrects in an action-stop-check loop: command a small heading step, stop yaw, let the compass settle, then re-check the remaining error. If the compass is missing/bad, yaw falls back to zero-rate damping.
- Roll/pitch IMU axes are swapped in firmware for the current board orientation, so physical roll and physical pitch are reported and controlled under the correct names.
- Failed pre-arm attempts now print `EVT:ARM_DENIED,...` diagnostics to the serial monitor.
- Flight controller and Calibration Wizard both use the archived PCB receiver map: CH1 roll D7, CH2 pitch D8, CH3 throttle D5, CH4 yaw D4.
- Calibration Wizard RC setup now checks CH1-CH4 receiver health, captures neutral/safe positions, verifies stick directions one by one, and refuses to commit weak endpoint captures.
- D13 is now a status LED. Flight firmware uses solid-on boot/armed, fast blink error/failsafe, double blink ready-to-arm, and slow heartbeat not-ready. Calibration Wizard uses solid-on boot/busy and slow heartbeat at the menu.
- Flight firmware arming/disarming now follows the archived controller logic: throttle low + yaw right arms after `150 ms`, throttle low + yaw left disarms after `150 ms`, and a re-arm neutral latch is required after failsafe.
- Flight firmware now swaps the MPU6050 roll/pitch axes to match the current board orientation, and `EVT:ARM_DENIED` includes raw `THR_US` and `YAW_US` diagnostics.
- Flight firmware now captures the physical CH6 kill switch on D12/PCINT4. CH6 above `1800 us` latches kill/failsafe with reason `CH6_KILL`; CH6 below `1100 us` plus throttle-low/yaw-centered releases the physical kill latch.
- RMS/digital kill is present but disabled by default in both firmware and dashboard. Firmware replies `ERR:RMS_KILL_DISABLED` to `CMD:KILL`, and the dashboard endpoint/button stay disabled unless explicitly commissioned.
- Remote Arduino firmware upload has been removed from the RMS to keep the Raspberry Pi app focused on monitoring, telemetry, exports, settings, and app updates. Arduino sketches should be flashed outside the RMS with normal Arduino tools.
- The Pi package now includes `uninstall_all.sh` for a full fresh-install reset that removes the service, app files, config, database, telemetry data, and runtime cache.

## Verification

Passing:

- `tools/self_check.py`
- Python syntax checks included in `tools/self_check.py`
- Static validation for motor mixing, control loop timing, PID anti-windup, heading hold, battery telemetry, dashboard behavior, and Calibration Wizard v4 behavior
- Static validation for active battery monitoring and gated battery failsafe
- Static validation for archived RC pin mapping and throttle capture from D5
- Static validation for D13 status LED behavior in flight and calibration sketches
- Static validation for archived-style arming/disarming thresholds, `150 ms` holds, and re-arm neutral latch
- Static validation for flight firmware version/revision boot, core telemetry fields, and dashboard parser behavior

Arduino compilation:

- Arduino CLI `1.5.1` was installed locally under `tools/arduino-cli/`.
- Arduino AVR core `1.8.8` and Servo library `1.3.0` were installed locally.
- Flight controller compile passed for `arduino:avr:uno`: `26460` bytes flash, `1081` bytes RAM.
- Calibration Wizard v4 compile passed for `arduino:avr:uno`: `22172` bytes flash, `595` bytes RAM.

## Archived-code transplant

The Calibration Wizard v4 still uses the archived working QMC5883P compass guts for setup/calibration workflows:

- Fixed HW-127 compass address path at `0x2C` with fallback probe retained only for board detection.
- QMC5883P chip ID read from register `0x00`, expected `0x80`.
- QMC5883P data reads from registers `0x01..0x06`.
- QMC5883P init writes: `0x0D=0x40`, `0x29=0x06`, `0x0A=0xCF`, `0x0B=0x00`.
- MPU6050 setup now matches the archived firmware DLPF and `+/-8g` accelerometer scale.

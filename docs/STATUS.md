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

- Version: `FC-0.8.5`
- Revision: `2026-06-22.4`

Current RMS package identity:

- Package: `2026.06-rev01.18`
- Current release folder: `dashboard/v1.5.1/`
- Retired v1.5 and superseded v1.5.1 package builds are stored under `_archive/`.

## Current hardware bring-up defaults

- `BATTERY_MONITOR_ENABLED = true` in the flight controller for the verified A0 stepped-down monitor signal.
- Battery telemetry now reports A0 monitor voltage, percentage where 5.00V is 100%, alarm level, validity, and active percentage thresholds. Invalid or emergency battery readings trigger a failsafe disarm latch.
- Barometer telemetry is active for BMP280/BME280 at `0x76`: pressure, temperature, absolute altitude estimate, relative altitude, raw readings, status, and chip ID are emitted to the RMS. Altitude hold remains intentionally disabled.
- Dashboard PID tuning now sends all Roll/Pitch/Yaw gain terms as a full `PID:` serial command. Firmware applies the values live, resets PID integrators, and replies with `ACK:PID,...`.
- Roll/pitch IMU axes are swapped in firmware for the current board orientation, so physical roll and physical pitch are reported and controlled under the correct names.
- `COMPASS_REQUIRED_TO_ARM = false` so compass bring-up issues do not silently block arming; missing compass data falls back to yaw-rate command mode.
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
- Static validation for motor mixing, control loop timing, PID anti-windup, battery telemetry, dashboard behavior, Calibration Wizard v4 behavior, and HW-127/QMC5883P compass naming/register constants, archived init sequence, and zero-read diagnostics
- Static validation for active battery monitoring, gated battery failsafe, configurable compass arming, and serial arm-denied diagnostics
- Static validation for archived RC pin mapping and throttle capture from D5
- Static validation for D13 status LED behavior in flight and calibration sketches
- Static validation for archived-style arming/disarming thresholds, `150 ms` holds, and re-arm neutral latch
- Static validation for flight firmware version/revision boot, telemetry fields, and barometer parser/dashboard behavior

Arduino compilation:

- Arduino CLI `1.5.1` was installed locally under `tools/arduino-cli/`.
- Arduino AVR core `1.8.8` and Servo library `1.3.0` were installed locally.
- Flight controller compile passed for `arduino:avr:uno`: `30884` bytes flash, `1136` bytes RAM.
- Calibration Wizard v4 compile passed for `arduino:avr:uno`: `22172` bytes flash, `595` bytes RAM.

## Archived-code transplant

The current flight controller and Calibration Wizard v4 now use the archived working QMC5883P compass guts:

- Fixed HW-127 compass address path at `0x2C` with fallback probe retained only for board detection.
- QMC5883P chip ID read from register `0x00`, expected `0x80`.
- QMC5883P data reads from registers `0x01..0x06`.
- QMC5883P init writes: `0x0D=0x40`, `0x29=0x06`, `0x0A=0xCF`, `0x0B=0x00`.
- MPU6050 setup now matches the archived firmware DLPF and `+/-8g` accelerometer scale.

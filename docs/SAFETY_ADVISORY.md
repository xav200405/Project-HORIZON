# Safety Advisory and Non-Liability Notice

Project HORIZON includes experimental UAV firmware, calibration software,
and remote monitoring software. It can influence aircraft behavior,
motor output, battery decisions, command channels, and operator awareness.
Use it only if you understand the hardware, software, and operational risks.

## Critical Warnings

- This project is not certified flight software.
- This project is not a substitute for professional engineering review,
  regulatory approval, pilot training, or range safety procedures.
- Never test control firmware with propellers installed unless the aircraft
  is restrained, the test area is controlled, and a competent operator is
  ready to remove power.
- Verify motor order, propeller direction, ESC calibration, RC failsafe,
  arming behavior, kill switch behavior, and sensor orientation before any
  flight attempt.
- The RMS emergency kill command is disabled by default. The physical CH6
  transmitter kill switch is the active bring-up safety path.
- Battery monitoring is enabled for the verified A0 stepped-down monitor
  signal; confirm 0-5V A0 behavior against a meter before powered aircraft
  testing.
- Telemetry delays, network failures, browser failures, serial disconnects,
  or Raspberry Pi failures can make the RMS stale or unavailable.
- Do not operate in public, near people, near property, near airports, or
  outside local aviation laws and radio regulations.

## Required Bring-Up Discipline

1. Review firmware constants for the exact airframe and wiring.
2. Run calibration with motors disarmed and propellers removed.
3. Confirm all sensor axes using physical movement.
4. Confirm RC channel directions, neutral values, endpoints, and failsafe.
5. Confirm arming is denied when required sensors or receiver data are bad.
6. Confirm the physical kill switch latches failsafe and stops motor output.
7. Test the RMS with simulated or bench telemetry before field use.
8. Perform tethered or restrained low-power tests before free flight.
9. Log every configuration change that affects vehicle behavior.

## Operator Responsibility

The user, builder, pilot, maintainer, and deployer are solely responsible
for deciding whether this software is suitable for any aircraft, bench rig,
test stand, or mission. You are responsible for all setup, inspection,
testing, legal compliance, safety procedures, and operational decisions.

## Non-Liability and No Warranty

This project is provided under the Apache License, Version 2.0. Consistent
with Sections 7 and 8 of that license, the software and documentation are
provided on an "AS IS" basis, without warranties or conditions of any kind,
and contributors are not liable for damages arising from use or inability
to use the work, except where applicable law requires otherwise.

Nothing in this advisory expands any warranty, support obligation,
certification claim, safety guarantee, or liability beyond the Apache
License, Version 2.0.

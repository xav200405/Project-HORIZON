# Which File Do I Run?

For the Raspberry Pi remote monitoring system, run exactly this file:

```bash
python3 dashboard/deploy/raspberry_pi/TP_ARC_RMS_single.py
```

That is the deployment launcher intended for the Pi.

For local development only, run the source app:

```bash
python dashboard/run.py
```

The Arduino firmware is not run with Python. Open or compile these sketches:

- `firmware/flight_controller/controller_firmware/controller_firmware.ino`
- `firmware/calibration_wizard/CalibrationWizard/CalibrationWizard.ino`

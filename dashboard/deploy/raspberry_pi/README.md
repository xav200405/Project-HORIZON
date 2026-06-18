# Raspberry Pi Deployment

This folder contains the standalone RMS launcher:

```bash
python3 TP_ARC_RMS_single.py
```

The launcher unpacks the RMS into a per-user runtime folder, installs Python
packages when allowed, opens the browser when possible, and starts the
monitoring dashboard. Set `TPARC_SINGLE_RUNTIME=<runtime-dir>` to choose a
specific runtime location.

## Default Admin

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change the default credentials from the RMS Settings page before field use.

## Useful Environment Variables

```bash
TPARC_SERIAL_PORT=<serial-port> python3 TP_ARC_RMS_single.py
TPARC_PORT=8080 python3 TP_ARC_RMS_single.py
TPARC_AUTO_INSTALL=0 python3 TP_ARC_RMS_single.py
TPARC_OPEN_BROWSER=0 python3 TP_ARC_RMS_single.py
```

Read `../../../docs/SAFETY_ADVISORY.md` before connecting aircraft hardware.

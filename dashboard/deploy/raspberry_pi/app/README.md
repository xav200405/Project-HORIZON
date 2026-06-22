# TP-ARC RMS Raspberry Pi App

This folder packages the Project HORIZON TP-ARC Remote Monitoring System as a
small Raspberry Pi service.

## Install

1. Copy or extract this package on the Raspberry Pi.

2. Enter the package folder:

```bash
cd tparc-rms-pi-app
```

3. Run the installer:

```bash
sudo bash install.sh
```

The installer places:

| Path | Purpose |
| --- | --- |
| `/opt/tparc-rms/` | App launcher and virtual environment. |
| `/etc/tparc-rms/tparc-rms.env` | Runtime configuration. |
| `/var/lib/tparc-rms/` | Runtime extraction folder and SQLite database. |
| `/etc/systemd/system/tparc-rms.service` | Systemd service. |

Modern Raspberry Pi OS protects the system Python environment. The installer
does not disable that protection globally. It installs OS prerequisites through
`apt`, then installs RMS Python packages inside `/opt/tparc-rms/venv`.

The installer also adds the service user to `dialout` when that group exists,
so USB serial devices such as `/dev/ttyACM0` can be opened by the service.
Reboot if serial access is still denied after install.

4. Check service status:

```bash
sudo systemctl status tparc-rms
```

5. Follow logs if needed:

```bash
journalctl -u tparc-rms -f
```

6. Find the Pi IP:

```bash
hostname -I
```

7. Open this URL from a browser on the same network:

```text
http://<raspberry-pi-ip>:5000/login
```

8. Log in as `tparc` / `tparc0322`, then change default passwords in Settings.

## Update

Manual update:

1. Extract the newer package on the Pi.

2. Enter the extracted folder:

```bash
cd tparc-rms-pi-app
```

3. Run the local updater:

```bash
sudo bash update.sh
```

Update replaces the app launcher, refreshes Python packages inside
`/opt/tparc-rms/venv`, updates the systemd service file, and restarts
`tparc-rms.service`. It preserves `/etc/tparc-rms/tparc-rms.env` and
`/var/lib/tparc-rms`.

Automatic GitHub update:

1. Make sure the newest package exists as a GitHub Release asset, or is
   committed somewhere under `dashboard/`.

2. Run:

```bash
sudo bash /opt/tparc-rms/update.sh
```

The updater checks GitHub's latest release first, downloads the newest
`tparc-rms-pi-app-*.tar.gz` release asset when present, extracts it, and runs
its local update step. If no matching release asset exists yet, it falls back
to scanning under the repository folder configured by `TPARC_UPDATE_SOURCE_PATH`,
which defaults to `dashboard`. Future folders such as
`dashboard/2026.REV01.1/dist` do not require Pi config changes.

If the repository changes later, edit `TPARC_UPDATE_REPO` in
`/etc/tparc-rms/tparc-rms.env`.

Default bootstrap user:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change this from Settings before field or shared-network use. Add operator or
viewer accounts later from Settings if required.

## Configure

Edit:

```bash
sudo nano /etc/tparc-rms/tparc-rms.env
sudo systemctl restart tparc-rms
```

Common settings:

```bash
TPARC_SERIAL_PORT=/dev/ttyACM0
TPARC_PORT=5000
TPARC_SESSION_MINUTES=30
TPARC_RMS_KILL_ENABLED=0
```

After editing config:

```bash
sudo systemctl restart tparc-rms
```

## Page Guide

| Page | Use It For |
| --- | --- |
| Overview | Client-presentable live telemetry summary, graph, analysis, and current fields. |
| Telemetry | Detailed engineering view with graphs, PID, motors, RC input, exports, and raw values. |
| Network | Serial and browser link health. |
| Settings | Users, roles, audit log, thresholds, and calibration trigger. |

## Troubleshooting

### Browser Cannot Connect

Check the Pi IP:

```bash
hostname -I
```

Check the service:

```bash
sudo systemctl status tparc-rms
```

### Serial Shows Simulated Data

List ports:

```bash
python3 -m serial.tools.list_ports
```

Set `TPARC_SERIAL_PORT` in `/etc/tparc-rms/tparc-rms.env`, then restart.

If you do not want the installer to run `apt-get`, set:

```bash
sudo TPARC_SKIP_APT=1 bash install.sh
```

Then install prerequisites yourself first:

```bash
sudo apt install python3 python3-venv python3-pip ca-certificates
```

## Uninstall

Standard uninstall removes the service, app files, and config while keeping
telemetry data in `/var/lib/tparc-rms`:

```bash
sudo bash uninstall.sh
```

For a fresh-install reset that removes all RMS traces, including the database,
telemetry data, config, service, app files, and runtime cache, run:

```bash
sudo bash uninstall_all.sh
```

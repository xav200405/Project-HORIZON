# TP-ARC RMS Raspberry Pi App

This folder packages the Project HORIZON TP-ARC Remote Monitoring System as a
small Raspberry Pi service.

Copy this folder to the Raspberry Pi, then run:

```bash
cd app
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

After install:

```bash
sudo systemctl status tparc-rms
journalctl -u tparc-rms -f
```

Open:

```text
http://<raspberry-pi-ip>:5000/login
```

Default bootstrap users:

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |
| `operator` | `change-me-operator` | `operator` |
| `viewer` | `change-me-viewer` | `viewer` |

Change these from Settings before field or shared-network use.

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

If you do not want the installer to run `apt-get`, set:

```bash
sudo TPARC_SKIP_APT=1 bash install.sh
```

Then install prerequisites yourself first:

```bash
sudo apt install python3 python3-venv python3-pip ca-certificates
```

## Uninstall

```bash
sudo bash uninstall.sh
```

By default, uninstall keeps `/var/lib/tparc-rms` so telemetry and user data are
not deleted accidentally. To remove data too:

```bash
sudo bash uninstall.sh --purge-data
```

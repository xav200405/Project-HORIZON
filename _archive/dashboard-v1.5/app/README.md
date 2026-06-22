# TP-ARC RMS Raspberry Pi App

This folder packages the Project HORIZON TP-ARC Remote Monitoring System as a
small Raspberry Pi service.

This is the older v1.5 package copy. For new installs, use the current
`dashboard/v1.5.1` package, which removes remote firmware upload and includes
the full fresh-install reset script `uninstall_all.sh`.

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

## Update

When you receive a newer TP-ARC RMS package, extract it on the Pi and run:

```bash
cd tparc-rms-pi-app
sudo bash update.sh
```

Update replaces the app launcher, refreshes Python packages inside
`/opt/tparc-rms/venv`, updates the systemd service file, and restarts
`tparc-rms.service`. It preserves `/etc/tparc-rms/tparc-rms.env` and
`/var/lib/tparc-rms`.

For automatic GitHub updates from `xav200405/Project-HORIZON`, run:

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

The current `dashboard/v1.5.1` package creates only the `tparc` admin account
by default. Add operator or viewer accounts later from Settings if required.

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

For the newer one-click full reset workflow, extract the current `v1.5.1`
package and run:

```bash
sudo bash uninstall_all.sh
```

# Raspberry Pi Deployment

Recommended path: build and install the Pi app package. From this folder:

```bash
python3 build_pi_app_package.py
```

Copy the generated `dist/tparc-rms-pi-app-*.tar.gz` to the Raspberry Pi, then:

```bash
tar -xzf tparc-rms-pi-app-*.tar.gz
cd tparc-rms-pi-app
sudo bash install.sh
```

The installed app runs as `tparc-rms.service`, starts on boot, keeps config in
`/etc/tparc-rms/tparc-rms.env`, and stores telemetry data under
`/var/lib/tparc-rms`.

The installer handles Raspberry Pi OS's protected Python environment by using
`apt` for OS prerequisites and a private app virtual environment under
`/opt/tparc-rms/venv`.

To update an installed Pi, copy a newer package to it, extract it, and run:

```bash
cd tparc-rms-pi-app
sudo bash update.sh
```

The update script preserves `/etc/tparc-rms/tparc-rms.env` and
`/var/lib/tparc-rms`.

For GitHub-based updates, create a GitHub release in
`xav200405/Project-HORIZON` with the package tarball as an asset. If no
matching release asset exists, the updater falls back to scanning under
`dashboard` for `tparc-rms-pi-app-*.tar.gz`, so future folders such as
`dashboard/2026.REV01.1/dist` do not require Pi config changes. The packaged
config already sets `TPARC_UPDATE_REPO=xav200405/Project-HORIZON` and
`TPARC_UPDATE_SOURCE_PATH=dashboard`, so an installed Pi can update itself with:

```bash
sudo bash /opt/tparc-rms/update.sh
```

The original standalone launcher is still available:

```bash
python3 TP_ARC_RMS_single.py
```

Use that when you want a temporary one-command run instead of installing a
service.

## Default Admin

| Username | Password | Role |
| --- | --- | --- |
| `tparc` | `tparc0322` | `admin` |

Change the default credentials from the RMS Settings page before field use.

## Useful Environment Variables

For the installed service, edit `/etc/tparc-rms/tparc-rms.env` and restart:

```bash
sudo systemctl restart tparc-rms
```

For the standalone launcher:

```bash
TPARC_SERIAL_PORT=<serial-port> python3 TP_ARC_RMS_single.py
TPARC_PORT=8080 python3 TP_ARC_RMS_single.py
TPARC_AUTO_INSTALL=0 python3 TP_ARC_RMS_single.py
TPARC_OPEN_BROWSER=0 python3 TP_ARC_RMS_single.py
```

Read `../../../docs/SAFETY_ADVISORY.md` before connecting aircraft hardware.

# TP-ARC RMS v1.5.1

This folder is a standalone Raspberry Pi app drop for the Project HORIZON
TP-ARC Remote Monitoring System.

## Ready-Built Package

Use this archive:

```bash
dist/tparc-rms-pi-app-2026.06-rev01.16.tar.gz
```

## Install On The Raspberry Pi

1. Copy `dist/tparc-rms-pi-app-2026.06-rev01.16.tar.gz` to the Pi.

2. Extract it:

```bash
tar -xzf tparc-rms-pi-app-2026.06-rev01.16.tar.gz
```

3. Enter the extracted folder:

```bash
cd tparc-rms-pi-app
```

4. Install:

```bash
sudo bash install.sh
```

5. Open:

```text
http://<raspberry-pi-ip>:5000/login
```

6. Log in as `tparc` / `tparc0322`.

7. Change default passwords in Settings.

The package installs the dashboard as `tparc-rms.service`, stores config in
`/etc/tparc-rms/tparc-rms.env`, and stores runtime data in `/var/lib/tparc-rms`.

## What This Release Adds

- Cleaner client-presentable Overview page.
- Detailed Telemetry page for full engineering data.
- Network page for link health.
- GitHub-aware updater.

## Fully Uninstall For Fresh Install

From the extracted package folder on the Pi:

```bash
sudo bash uninstall_all.sh
```

This removes the service, app files, config, database, telemetry data, and
runtime cache.
## Update Later

```bash
sudo bash /opt/tparc-rms/update.sh
```

The default update repository is `xav200405/Project-HORIZON`. The updater
checks the latest GitHub release first, then falls back to scanning under
`dashboard` for `tparc-rms-pi-app-*.tar.gz`. Future release folders do not
require Pi config changes.

To rebuild the archive from this folder:

```bash
python3 build_pi_app_package.py
```

For the full walkthrough, read `../../docs/STEP_BY_STEP_GUIDE.md`.

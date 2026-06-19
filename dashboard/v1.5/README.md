# TP-ARC RMS v1.5

This folder is a standalone v1.5 Raspberry Pi app drop for the Project HORIZON
TP-ARC Remote Monitoring System.

Use the ready-built archive:

```bash
dist/tparc-rms-pi-app-2026.06-rev01.5.tar.gz
```

On the Raspberry Pi:

```bash
tar -xzf tparc-rms-pi-app-2026.06-rev01.5.tar.gz
cd tparc-rms-pi-app
sudo bash install.sh
```

The package installs the dashboard as `tparc-rms.service`, stores config in
`/etc/tparc-rms/tparc-rms.env`, and stores runtime data in `/var/lib/tparc-rms`.

For future updates with a newer package:

```bash
sudo bash /opt/tparc-rms/update.sh
```

The default update repository is `xav200405/Project-HORIZON`. The updater
checks the latest GitHub release first, then falls back to scanning under
`dashboard` for `tparc-rms-pi-app-*.tar.gz`. Future folders such as
`dashboard/2026.REV01.1/dist` do not require Pi config changes.

To rebuild the archive from this folder:

```bash
python3 build_pi_app_package.py
```

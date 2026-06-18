# TP-ARC RMS v1.5

This folder is a standalone v1.5 Raspberry Pi app drop for the Project HORIZON
TP-ARC Remote Monitoring System.

Use the ready-built archive:

```bash
dist/tparc-rms-pi-app-2026-06-18-pi-installer-refresh.tar.gz
```

On the Raspberry Pi:

```bash
tar -xzf tparc-rms-pi-app-2026-06-18-pi-installer-refresh.tar.gz
cd tparc-rms-pi-app
sudo bash install.sh
```

The package installs the dashboard as `tparc-rms.service`, stores config in
`/etc/tparc-rms/tparc-rms.env`, and stores runtime data in `/var/lib/tparc-rms`.

To rebuild the archive from this folder:

```bash
python3 build_pi_app_package.py
```

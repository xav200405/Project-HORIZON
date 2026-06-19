# TP-ARC RMS v1.5.1

This folder is a standalone Raspberry Pi app drop for the Project HORIZON
TP-ARC Remote Monitoring System.

Use the ready-built archive:

```bash
dist/tparc-rms-pi-app-2026.06-rev01.6.tar.gz
```

On the Raspberry Pi:

```bash
tar -xzf tparc-rms-pi-app-2026.06-rev01.6.tar.gz
cd tparc-rms-pi-app
sudo bash install.sh
```

This v1.5.1 drop adds the admin Firmware page. Admins can upload `.ino`
sketches or zipped Arduino sketch folders through the Raspberry Pi server,
compile with `arduino-cli`, and upload to the Arduino over USB serial. The RMS
pauses telemetry serial access during the upload and restarts it afterward.

The package installs the dashboard as `tparc-rms.service`, stores config in
`/etc/tparc-rms/tparc-rms.env`, and stores runtime data in `/var/lib/tparc-rms`.

For future updates with a newer package:

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

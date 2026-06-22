#!/usr/bin/env bash
set -eu

APP_NAME="tparc-rms"
INSTALL_DIR="${TPARC_INSTALL_DIR:-/opt/tparc-rms}"
CONFIG_DIR="${TPARC_CONFIG_DIR:-/etc/tparc-rms}"
DATA_DIR="${TPARC_DATA_DIR:-/var/lib/tparc-rms}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo ./uninstall_all.sh"
  exit 1
fi

echo "Fully removing TP-ARC RMS."
echo "This deletes the service, app files, config, database, telemetry data, and runtime cache."

systemctl stop "${APP_NAME}.service" 2>/dev/null || true
systemctl disable "${APP_NAME}.service" 2>/dev/null || true
rm -f "${SERVICE_FILE}"
systemctl daemon-reload
systemctl reset-failed "${APP_NAME}.service" 2>/dev/null || true

rm -rf "${INSTALL_DIR}" "${CONFIG_DIR}" "${DATA_DIR}"
rm -rf "${TMPDIR:-/tmp}/tparc-rms" "${TMPDIR:-/tmp}/tparc-rms-runtime"

echo "TP-ARC RMS has been fully removed."
echo "A fresh install can now be run from a new package with: sudo bash install.sh"
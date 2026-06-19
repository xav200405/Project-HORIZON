#!/usr/bin/env bash
set -eu

APP_NAME="tparc-rms"
INSTALL_DIR="${TPARC_INSTALL_DIR:-/opt/tparc-rms}"
CONFIG_DIR="${TPARC_CONFIG_DIR:-/etc/tparc-rms}"
DATA_DIR="${TPARC_DATA_DIR:-/var/lib/tparc-rms}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
PURGE_DATA=0

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo ./uninstall.sh"
  exit 1
fi

if [ "${1:-}" = "--purge-data" ]; then
  PURGE_DATA=1
fi

systemctl stop "${APP_NAME}.service" 2>/dev/null || true
systemctl disable "${APP_NAME}.service" 2>/dev/null || true
rm -f "${SERVICE_FILE}"
systemctl daemon-reload

rm -rf "${INSTALL_DIR}" "${CONFIG_DIR}"
if [ "${PURGE_DATA}" -eq 1 ]; then
  rm -rf "${DATA_DIR}"
  echo "Removed app, config, service, and telemetry data."
else
  echo "Removed app, config, and service. Kept telemetry data at ${DATA_DIR}."
fi

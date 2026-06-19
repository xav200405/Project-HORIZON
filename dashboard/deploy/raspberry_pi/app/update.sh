#!/usr/bin/env bash
set -eu

APP_NAME="tparc-rms"
INSTALL_DIR="${TPARC_INSTALL_DIR:-/opt/tparc-rms}"
CONFIG_DIR="${TPARC_CONFIG_DIR:-/etc/tparc-rms}"
DATA_DIR="${TPARC_DATA_DIR:-/var/lib/tparc-rms}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-auto}"
PIP_PACKAGES="
Flask==3.0.3
Flask-SocketIO==5.3.6
simple-websocket==1.0.0
eventlet==0.36.1
pyserial==3.5
bcrypt==4.1.3
reportlab==4.2.2
"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash update.sh"
  exit 1
fi

if [ -f "${CONFIG_DIR}/tparc-rms.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${CONFIG_DIR}/tparc-rms.env"
  set +a
fi

if [ "${MODE}" = "--github" ] || { [ "${MODE}" = "auto" ] && [ "${SCRIPT_DIR}" = "${INSTALL_DIR}" ]; }; then
  if [ ! -x "${INSTALL_DIR}/venv/bin/python" ]; then
    echo "TP-ARC RMS venv is missing. Run sudo bash install.sh from a package first."
    exit 1
  fi
  if [ ! -f "${SCRIPT_DIR}/github_update.py" ]; then
    echo "Missing github_update.py in ${SCRIPT_DIR}"
    exit 1
  fi
  exec "${INSTALL_DIR}/venv/bin/python" "${SCRIPT_DIR}/github_update.py"
fi

if [ "${MODE}" != "auto" ] && [ "${MODE}" != "--local" ]; then
  echo "Usage: sudo bash update.sh [--github|--local]"
  exit 1
fi

if [ ! -f "${SCRIPT_DIR}/TP_ARC_RMS_single.py" ]; then
  echo "Missing TP_ARC_RMS_single.py next to update.sh"
  exit 1
fi

if [ ! -d "${INSTALL_DIR}" ] || [ ! -f "${SERVICE_FILE}" ]; then
  echo "TP-ARC RMS is not installed yet. Run: sudo bash install.sh"
  exit 1
fi

RUN_USER="${TPARC_RUN_USER:-$(systemctl show -p User --value "${APP_NAME}.service" 2>/dev/null || true)}"
if [ -z "${RUN_USER}" ]; then
  RUN_USER="${SUDO_USER:-pi}"
fi
if ! id "${RUN_USER}" >/dev/null 2>&1; then
  echo "User '${RUN_USER}' does not exist. Set TPARC_RUN_USER=<user> and rerun."
  exit 1
fi
RUN_GROUP="$(id -gn "${RUN_USER}")"

echo "Updating TP-ARC RMS for user ${RUN_USER}"
install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}" "${DATA_DIR}"
install -m 0755 "${SCRIPT_DIR}/TP_ARC_RMS_single.py" "${INSTALL_DIR}/TP_ARC_RMS_single.py"
install -m 0755 "${SCRIPT_DIR}/update.sh" "${INSTALL_DIR}/update.sh"
install -m 0755 "${SCRIPT_DIR}/github_update.py" "${INSTALL_DIR}/github_update.py"
install -m 0644 "${SCRIPT_DIR}/README.md" "${INSTALL_DIR}/README.md"
install -m 0644 "${SCRIPT_DIR}/tparc-rms.env" "${CONFIG_DIR}/tparc-rms.env.example"

if [ ! -x "${INSTALL_DIR}/venv/bin/python" ]; then
  python3 -m venv "${INSTALL_DIR}/venv"
fi
"${INSTALL_DIR}/venv/bin/python" -m pip install --upgrade pip setuptools wheel
"${INSTALL_DIR}/venv/bin/python" -m pip install ${PIP_PACKAGES}

sed \
  -e "s/__TPARC_USER__/${RUN_USER}/g" \
  -e "s/__TPARC_GROUP__/${RUN_GROUP}/g" \
  "${SCRIPT_DIR}/tparc-rms.service" > "${SERVICE_FILE}"

chown -R "${RUN_USER}:${RUN_GROUP}" "${INSTALL_DIR}" "${DATA_DIR}"
chmod 0644 "${SERVICE_FILE}"

systemctl daemon-reload
systemctl restart "${APP_NAME}.service"

echo
echo "TP-ARC RMS updated."
echo "  Service: sudo systemctl status ${APP_NAME}"
echo "  Logs:    journalctl -u ${APP_NAME} -f"
echo "  Config:  ${CONFIG_DIR}/tparc-rms.env"
echo "  New config example: ${CONFIG_DIR}/tparc-rms.env.example"

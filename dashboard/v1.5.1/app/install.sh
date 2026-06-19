#!/usr/bin/env bash
set -eu

APP_NAME="tparc-rms"
INSTALL_DIR="${TPARC_INSTALL_DIR:-/opt/tparc-rms}"
CONFIG_DIR="${TPARC_CONFIG_DIR:-/etc/tparc-rms}"
DATA_DIR="${TPARC_DATA_DIR:-/var/lib/tparc-rms}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APT_PACKAGES="python3 python3-venv python3-pip ca-certificates"
ARDUINO_APT_PACKAGES="arduino-cli avrdude"
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
  echo "Run with sudo: sudo ./install.sh"
  exit 1
fi

if [ ! -f "${SCRIPT_DIR}/TP_ARC_RMS_single.py" ]; then
  echo "Missing TP_ARC_RMS_single.py next to install.sh"
  exit 1
fi

RUN_USER="${TPARC_RUN_USER:-${SUDO_USER:-pi}}"
if ! id "${RUN_USER}" >/dev/null 2>&1; then
  echo "User '${RUN_USER}' does not exist. Set TPARC_RUN_USER=<user> and rerun."
  exit 1
fi
RUN_GROUP="$(id -gn "${RUN_USER}")"

if [ "${TPARC_SKIP_APT:-0}" != "1" ] && command -v apt-get >/dev/null 2>&1; then
  echo "Installing Raspberry Pi OS prerequisites with apt"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${APT_PACKAGES}
  if [ "${TPARC_SKIP_ARDUINO_TOOLS:-0}" != "1" ]; then
    echo "Installing Arduino upload tools with apt"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${ARDUINO_APT_PACKAGES} || \
      echo "Arduino CLI packages were not available from apt; configure TPARC_ARDUINO_CLI manually."
  fi
elif ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install it with: sudo apt install ${APT_PACKAGES}"
  exit 1
fi

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "python3-venv is required. Install it with: sudo apt install python3-venv"
  exit 1
fi

if getent group dialout >/dev/null 2>&1; then
  usermod -a -G dialout "${RUN_USER}"
fi

if command -v arduino-cli >/dev/null 2>&1 && [ "${TPARC_INSTALL_ARDUINO_AVR_CORE:-1}" = "1" ]; then
  echo "Preparing Arduino AVR core for ${RUN_USER}"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "${RUN_USER}" -- arduino-cli core update-index || true
    runuser -u "${RUN_USER}" -- arduino-cli core install arduino:avr || true
  else
    arduino-cli core update-index || true
    arduino-cli core install arduino:avr || true
  fi
fi

echo "Installing TP-ARC RMS for user ${RUN_USER}"
install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}" "${DATA_DIR}"
install -m 0755 "${SCRIPT_DIR}/TP_ARC_RMS_single.py" "${INSTALL_DIR}/TP_ARC_RMS_single.py"
install -m 0755 "${SCRIPT_DIR}/update.sh" "${INSTALL_DIR}/update.sh"
install -m 0755 "${SCRIPT_DIR}/github_update.py" "${INSTALL_DIR}/github_update.py"
install -m 0644 "${SCRIPT_DIR}/README.md" "${INSTALL_DIR}/README.md"
if [ ! -f "${CONFIG_DIR}/tparc-rms.env" ]; then
  install -m 0644 "${SCRIPT_DIR}/tparc-rms.env" "${CONFIG_DIR}/tparc-rms.env"
else
  install -m 0644 "${SCRIPT_DIR}/tparc-rms.env" "${CONFIG_DIR}/tparc-rms.env.example"
fi

python3 -m venv --clear "${INSTALL_DIR}/venv"
"${INSTALL_DIR}/venv/bin/python" -m pip install --upgrade pip setuptools wheel
"${INSTALL_DIR}/venv/bin/python" -m pip install ${PIP_PACKAGES}

sed \
  -e "s/__TPARC_USER__/${RUN_USER}/g" \
  -e "s/__TPARC_GROUP__/${RUN_GROUP}/g" \
  "${SCRIPT_DIR}/tparc-rms.service" > "${SERVICE_FILE}"

chown -R "${RUN_USER}:${RUN_GROUP}" "${INSTALL_DIR}" "${DATA_DIR}"
chmod 0644 "${CONFIG_DIR}/tparc-rms.env" "${SERVICE_FILE}"

systemctl daemon-reload
systemctl enable "${APP_NAME}.service"
systemctl restart "${APP_NAME}.service"

echo
echo "TP-ARC RMS installed."
echo "  Service: sudo systemctl status ${APP_NAME}"
echo "  Logs:    journalctl -u ${APP_NAME} -f"
echo "  Config:  ${CONFIG_DIR}/tparc-rms.env"
echo "  Data:    ${DATA_DIR}"
echo "  URL:     http://<raspberry-pi-ip>:5000/login"
if getent group dialout >/dev/null 2>&1; then
  echo "  Serial:  ${RUN_USER} was added to dialout; reboot if serial access is denied."
fi

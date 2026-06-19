import os
import platform
import secrets
from glob import glob
from datetime import timedelta

from flask import Flask
from flask_socketio import SocketIO

from .serial_worker import SerialWorker
from .storage import init_db

socketio = SocketIO(async_mode=os.environ.get("TPARC_SOCKETIO_ASYNC_MODE", "threading"), cors_allowed_origins=[])
serial_worker = SerialWorker(socketio)

from .auth import auth_bp, init_auth  # noqa: E402
from .routes import main_bp  # noqa: E402


def detect_serial_port():
    configured = os.environ.get("TPARC_SERIAL_PORT")
    if configured:
        return configured
    if platform.system().lower().startswith("win"):
        return None
    for pattern in ("/dev/serial/by-id/*", "/dev/ttyACM*", "/dev/ttyUSB*"):
        matches = sorted(glob(pattern))
        if matches:
            return matches[0]
    return None


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("TPARC_SECRET_KEY", secrets.token_hex(32)),
        DATABASE=os.environ.get("TPARC_DB", os.path.join(os.getcwd(), "tparc.sqlite3")),
        SESSION_COOKIE_SECURE=os.environ.get("TPARC_ALLOW_INSECURE_DEV") != "1",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        PERMANENT_SESSION_LIFETIME=timedelta(minutes=int(os.environ.get("TPARC_SESSION_MINUTES", "30"))),
        SERIAL_PORT=detect_serial_port(),
        SERIAL_BAUD=int(os.environ.get("TPARC_SERIAL_BAUD", "115200")),
        RMS_KILL_ENABLED=os.environ.get("TPARC_RMS_KILL_ENABLED") == "1",
        FIRMWARE_UPLOAD_DIR=os.environ.get(
            "TPARC_FIRMWARE_UPLOAD_DIR",
            os.path.join(os.path.dirname(os.environ.get("TPARC_DB", os.path.join(os.getcwd(), "tparc.sqlite3"))), "firmware"),
        ),
    )
    init_db(app.config["DATABASE"])
    init_auth(app.config["DATABASE"])
    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    socketio.init_app(app)
    serial_worker.configure(app.config["SERIAL_PORT"], app.config["SERIAL_BAUD"], app.config["DATABASE"])
    serial_worker.start()
    return app

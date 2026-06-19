import os
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path


BOARD_OPTIONS = [
    {"fqbn": "arduino:avr:uno", "label": "Arduino Uno"},
    {"fqbn": "arduino:avr:nano", "label": "Arduino Nano"},
    {"fqbn": "arduino:avr:nano:cpu=atmega328old", "label": "Arduino Nano old bootloader"},
    {"fqbn": "arduino:avr:mega", "label": "Arduino Mega 2560"},
]
ALLOWED_EXTENSIONS = {".ino", ".zip"}
MAX_OUTPUT_CHARS = 24000


def firmware_config(app_config):
    return {
        "cli": os.environ.get("TPARC_ARDUINO_CLI", "arduino-cli"),
        "default_fqbn": os.environ.get("TPARC_ARDUINO_DEFAULT_FQBN", "arduino:avr:uno"),
        "upload_dir": Path(os.environ.get("TPARC_FIRMWARE_UPLOAD_DIR", app_config.get("FIRMWARE_UPLOAD_DIR", ""))),
        "timeout": int(os.environ.get("TPARC_FIRMWARE_TIMEOUT", "600")),
        "max_mb": int(os.environ.get("TPARC_FIRMWARE_MAX_MB", "8")),
    }


def resolve_cli(config):
    configured = config["cli"]
    if Path(configured).exists():
        return configured
    found = shutil.which(configured)
    return found or configured


def list_serial_ports():
    try:
        from serial.tools import list_ports
    except Exception:
        return []
    ports = []
    for port in list_ports.comports():
        ports.append(
            {
                "device": port.device,
                "description": port.description or port.device,
                "hwid": port.hwid or "",
            }
        )
    return ports


def run_command(command, timeout, cwd=None):
    started = time.time()
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        output = ((result.stdout or "") + ("\n" if result.stdout and result.stderr else "") + (result.stderr or "")).strip()
        return {
            "ok": result.returncode == 0,
            "code": result.returncode,
            "output": output[-MAX_OUTPUT_CHARS:],
            "elapsed_s": round(time.time() - started, 2),
        }
    except subprocess.TimeoutExpired as exc:
        output = ((exc.stdout or "") + "\n" + (exc.stderr or "")).strip()
        return {
            "ok": False,
            "code": -1,
            "output": (output + f"\nTimed out after {timeout} seconds.")[-MAX_OUTPUT_CHARS:],
            "elapsed_s": round(time.time() - started, 2),
        }


def firmware_status(app_config):
    config = firmware_config(app_config)
    cli = resolve_cli(config)
    status = {
        "cli": cli,
        "cli_available": bool(shutil.which(cli) or Path(cli).exists()),
        "default_fqbn": config["default_fqbn"],
        "board_options": BOARD_OPTIONS,
        "ports": list_serial_ports(),
        "max_mb": config["max_mb"],
    }
    if status["cli_available"]:
        version = run_command([cli, "version"], timeout=10)
        status["version"] = version["output"].splitlines()[0] if version["output"] else "arduino-cli"
    else:
        status["version"] = "arduino-cli not found"
    return status


def safe_stem(filename):
    stem = Path(filename or "sketch").stem
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")
    return stem[:64] or "sketch"


def _safe_extract_zip(package, target):
    with zipfile.ZipFile(package) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue
            name = member.filename.replace("\\", "/")
            if name.startswith("/") or ".." in Path(name).parts:
                raise ValueError(f"Unsafe archive path: {member.filename}")
            if Path(name).suffix.lower() not in {".ino", ".h", ".hpp", ".c", ".cpp", ".S", ".txt", ".md"}:
                continue
            destination = (target / name).resolve()
            if not str(destination).startswith(str(target.resolve())):
                raise ValueError(f"Unsafe archive path: {member.filename}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def prepare_sketch(upload, upload_root, max_mb):
    if not upload or not upload.filename:
        raise ValueError("Upload a .ino file or zipped Arduino sketch folder.")
    suffix = Path(upload.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("Only .ino and .zip Arduino sketches are accepted.")

    upload_root.mkdir(parents=True, exist_ok=True)
    work_dir = upload_root / time.strftime("%Y%m%d-%H%M%S") / safe_stem(upload.filename)
    work_dir.mkdir(parents=True, exist_ok=True)
    incoming = work_dir / ("upload" + suffix)
    upload.save(incoming)
    if incoming.stat().st_size > max_mb * 1024 * 1024:
        shutil.rmtree(work_dir.parent, ignore_errors=True)
        raise ValueError(f"Firmware upload is larger than {max_mb} MB.")

    if suffix == ".ino":
        sketch_name = safe_stem(upload.filename)
        sketch_dir = work_dir / sketch_name
        sketch_dir.mkdir()
        shutil.move(str(incoming), sketch_dir / f"{sketch_name}.ino")
        return sketch_dir

    extract_dir = work_dir / "extract"
    extract_dir.mkdir()
    _safe_extract_zip(incoming, extract_dir)
    sketches = sorted(extract_dir.rglob("*.ino"))
    if not sketches:
        raise ValueError("The uploaded zip does not contain an .ino sketch.")
    sketch = sketches[0]
    return sketch.parent


def upload_firmware(app_config, upload, port, fqbn, compile_only=False):
    config = firmware_config(app_config)
    cli = resolve_cli(config)
    if not (shutil.which(cli) or Path(cli).exists()):
        raise RuntimeError("arduino-cli is not installed or not configured.")
    if not port:
        raise ValueError("Select the Arduino serial port.")
    if not fqbn or ":" not in fqbn:
        raise ValueError("Select a valid Arduino board FQBN.")

    sketch_dir = prepare_sketch(upload, config["upload_dir"], config["max_mb"])
    compile_cmd = [cli, "compile", "--fqbn", fqbn, str(sketch_dir)]
    upload_cmd = [cli, "upload", "-p", port, "--fqbn", fqbn, str(sketch_dir)]
    compile_result = run_command(compile_cmd, config["timeout"])
    upload_result = None
    if compile_result["ok"] and not compile_only:
        upload_result = run_command(upload_cmd, config["timeout"])
    ok = compile_result["ok"] and (compile_only or bool(upload_result and upload_result["ok"]))
    return {
        "ok": ok,
        "sketch": str(sketch_dir),
        "port": port,
        "fqbn": fqbn,
        "compile": compile_result,
        "upload": upload_result,
    }

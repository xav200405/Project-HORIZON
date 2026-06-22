import queue
import threading
import time

from .storage import audit, store_telemetry
from .telemetry import default_state, parse_telemetry_line


class SerialWorker:
    def __init__(self, socketio):
        self.socketio = socketio
        self.port = None
        self.baud = 115200
        self.db_path = None
        self.thread = None
        self.stop_event = threading.Event()
        self.command_queue = queue.Queue()
        self.latest_state = default_state()
        self.last_serial_ts = 0
        self.raw_lines = []
        self.packets_received = 0
        self.bytes_received = 0
        self.last_line = ""
        self.serial_status = "starting"

    def configure(self, port, baud, db_path):
        self.port = port
        self.baud = baud
        self.db_path = db_path

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, name="serial-reader", daemon=True)
        self.thread.start()

    def stop(self, timeout=3.0):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=timeout)
        self.thread = None

    def send(self, command):
        if not command.endswith("\n"):
            command += "\n"
        self.command_queue.put(command)

    def _run(self):
        if not self.port:
            self.serial_status = "simulated"
            audit(self.db_path, "system", "SERIAL_NOT_CONFIGURED", {})
            while not self.stop_event.is_set():
                self._emit_simulated()
                time.sleep(0.1)
            return

        try:
            import serial
            ser = serial.Serial(self.port, self.baud, timeout=0.1)
            self.serial_status = "connected"
            audit(self.db_path, "system", "SERIAL_OPEN", {"port": self.port})
        except Exception as exc:
            ser = None
            self.serial_status = "simulated"
            audit(self.db_path, "system", "SERIAL_OPEN_FAILED", {"error": str(exc), "port": self.port})

        try:
            while not self.stop_event.is_set():
                if ser is None:
                    self._emit_simulated()
                    time.sleep(0.1)
                    continue

                try:
                    while not self.command_queue.empty():
                        ser.write(self.command_queue.get_nowait().encode("ascii"))
                    line = ser.readline().decode("ascii", errors="replace").strip()
                    if line:
                        self._handle_line(line)
                    elif time.time() - self.last_serial_ts > 1.0:
                        self.serial_status = "lost"
                        self.socketio.emit("link_status", {"serial": "lost"})
                except Exception as exc:
                    self.serial_status = "error"
                    audit(self.db_path, "system", "SERIAL_ERROR", {"error": str(exc)})
                    self.socketio.emit("link_status", {"serial": "lost"})
                    time.sleep(1)
        finally:
            if ser is not None:
                try:
                    ser.close()
                except Exception:
                    pass

    def _handle_line(self, line):
        parsed = parse_telemetry_line(line)
        if parsed is None:
            return
        self.last_serial_ts = time.time()
        self.packets_received += 1
        self.bytes_received += len(line.encode("utf-8", errors="replace"))
        self.last_line = line
        if self.serial_status in {"lost", "error", "starting"}:
            self.serial_status = "connected"
        self.raw_lines = (self.raw_lines + [line])[-20:]
        parsed["raw_lines"] = list(self.raw_lines)
        if "roll" in parsed:
            self.latest_state.update(parsed)
            store_telemetry(self.db_path, self.latest_state)
            self.socketio.emit("telemetry", self.latest_state)
        elif "ack" in parsed:
            self.socketio.emit("ack", parsed)
        elif "event" in parsed or "error" in parsed:
            self.socketio.emit("flight_event", parsed)

    def _emit_simulated(self):
        now = time.time()
        state = dict(self.latest_state)
        state.update(
            timestamp=now,
            roll=2.5,
            pitch=-1.2,
            yaw=(now * 5) % 360,
            heading_setpoint=15.0,
            battery_voltage=4.12,
            battery_monitor_voltage=4.12,
            battery_full_scale_voltage=5.0,
            battery_cell_voltage=0.0,
            battery_soc=82,
            battery_alarm=0,
            battery_valid=1,
            raw="SIM: no serial port configured",
            raw_lines=["SIM: no serial port configured"],
        )
        self.latest_state = state
        self.packets_received += 1
        self.last_serial_ts = now
        self.last_line = state["raw"]
        self.serial_status = "simulated"
        self.socketio.emit("telemetry", state)

    def network_state(self):
        now = time.time()
        return {
            "server_time": now,
            "serial_status": self.serial_status,
            "serial_port": self.port,
            "serial_baud": self.baud,
            "last_serial_age_s": None if not self.last_serial_ts else max(0.0, now - self.last_serial_ts),
            "packets_received": self.packets_received,
            "bytes_received": self.bytes_received,
            "last_line": self.last_line,
            "raw_line_count": len(self.raw_lines),
            "latest_packet_type": self.latest_state.get("packet_type", ""),
            "latest_state_age_s": max(0.0, now - self.latest_state.get("timestamp", now)),
        }

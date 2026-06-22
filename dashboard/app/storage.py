import csv
import io
import json
import sqlite3
import time
from contextlib import contextmanager


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash BLOB NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL NOT NULL,
    user TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp REAL NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp);
CREATE TABLE IF NOT EXISTS login_failures (
    ip_address TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    locked_until REAL NOT NULL
);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def db(db_path):
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path):
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)


def audit(db_path, user, action, details=None, ip_address=None):
    with db(db_path) as conn:
        conn.execute(
            "INSERT INTO audit_log(timestamp,user,action,details,ip_address) VALUES(?,?,?,?,?)",
            (time.time(), user or "system", action, json.dumps(details or {}), ip_address),
        )


def store_telemetry(db_path, payload):
    with db(db_path) as conn:
        conn.execute(
            "INSERT INTO telemetry(timestamp,payload) VALUES(?,?)",
            (payload.get("timestamp", time.time()), json.dumps(payload, separators=(",", ":"))),
        )


def telemetry_rows(db_path, start_ts=None, end_ts=None, limit=None):
    query = "SELECT timestamp,payload FROM telemetry WHERE 1=1"
    args = []
    if start_ts is not None:
        query += " AND timestamp >= ?"
        args.append(start_ts)
    if end_ts is not None:
        query += " AND timestamp <= ?"
        args.append(end_ts)
    if limit is not None:
        query += " ORDER BY timestamp DESC LIMIT ?"
        args.append(limit)
    else:
        query += " ORDER BY timestamp ASC"
    with db(db_path) as conn:
        rows = list(conn.execute(query, args))
    if limit is not None:
        rows.reverse()
    return rows


def telemetry_payloads(db_path, start_ts=None, end_ts=None, limit=None):
    rows = telemetry_rows(db_path, start_ts, end_ts, limit)
    payloads = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except json.JSONDecodeError:
            continue
        payload.setdefault("timestamp", row["timestamp"])
        payloads.append(payload)
    return payloads


def known_telemetry_fields(db_path, start_ts=None, end_ts=None, limit=1000):
    fields = set()
    for payload in telemetry_payloads(db_path, start_ts, end_ts, limit):
        fields.update(payload.keys())
    return sorted(field for field in fields if field not in {"raw_lines"})


def export_csv(db_path, fields, start_ts=None, end_ts=None):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp"] + fields)
    for row in telemetry_rows(db_path, start_ts, end_ts):
        payload = json.loads(row["payload"])
        writer.writerow([row["timestamp"]] + [payload.get(field, "") for field in fields])
    return output.getvalue()


def export_json(db_path, start_ts=None, end_ts=None):
    return json.dumps(telemetry_payloads(db_path, start_ts, end_ts), separators=(",", ":"))


def telemetry_summary(db_path, start_ts=None, end_ts=None):
    rows = telemetry_payloads(db_path, start_ts, end_ts, 2400)
    if not rows:
        return {
            "count": 0,
            "duration_s": 0,
            "sample_rate_hz": 0,
            "numeric": {},
            "states": {},
            "modes": {},
            "events": [],
        }

    first_ts = rows[0].get("timestamp", time.time())
    last_ts = rows[-1].get("timestamp", first_ts)
    duration = max(0.0, last_ts - first_ts)
    numeric_fields = [
        "roll",
        "pitch",
        "yaw",
        "gyro_roll_rate",
        "gyro_pitch_rate",
        "gyro_yaw_rate",
        "heading_error",
        "roll_cmd",
        "pitch_cmd",
        "yaw_cmd",
        "pid_roll",
        "pid_pitch",
        "pid_yaw",
        "m1",
        "m2",
        "m3",
        "m4",
        "ch1",
        "ch2",
        "ch3",
        "ch4",
        "ch5",
        "ch6",
        "battery_soc",
        "battery_voltage",
        "battery_monitor_voltage",
        "baro_pressure_pa",
        "baro_pressure_hpa",
        "baro_temperature_c",
        "baro_altitude_m",
        "baro_relative_altitude_m",
        "baro_baseline_pressure_pa",
    ]
    numeric = {}
    for field in numeric_fields:
        values = []
        for payload in rows:
            value = payload.get(field)
            if isinstance(value, (int, float)):
                values.append(float(value))
        if values:
            numeric[field] = {
                "min": min(values),
                "max": max(values),
                "avg": sum(values) / len(values),
            }

    states = {}
    modes = {}
    events = []
    for payload in rows:
        state = payload.get("state")
        mode = payload.get("mode")
        if state:
            states[state] = states.get(state, 0) + 1
        if mode:
            modes[mode] = modes.get(mode, 0) + 1
        if payload.get("event") or payload.get("error") or payload.get("ack"):
            events.append(payload)

    motor_values = [rows[-1].get(key, 1000) for key in ("m1", "m2", "m3", "m4")]
    try:
        motor_spread = max(motor_values) - min(motor_values)
    except TypeError:
        motor_spread = 0

    return {
        "count": len(rows),
        "duration_s": duration,
        "sample_rate_hz": (len(rows) - 1) / duration if duration > 0 else 0,
        "numeric": numeric,
        "states": states,
        "modes": modes,
        "events": events[-30:],
        "motor_spread": motor_spread,
        "known_fields": known_telemetry_fields(db_path, start_ts, end_ts),
    }

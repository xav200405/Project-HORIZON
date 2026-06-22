import json
import sqlite3
import time

import bcrypt
from flask import Blueprint, Response, current_app, redirect, render_template, request, send_file, session, url_for

from . import serial_worker
from .auth import csrf_required, current_user, login_required, role_required
from .storage import audit, db, export_csv, export_json, known_telemetry_fields, store_telemetry, telemetry_payloads, telemetry_summary

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
@login_required
def dashboard():
    return render_template(
        "dashboard.html",
        user=current_user(),
        csrf=session["csrf"],
        rms_kill_enabled=current_app.config["RMS_KILL_ENABLED"],
        view="ops",
    )


@main_bp.route("/telemetry")
@login_required
def telemetry_page():
    return render_template(
        "dashboard.html",
        user=current_user(),
        csrf=session["csrf"],
        rms_kill_enabled=current_app.config["RMS_KILL_ENABLED"],
        view="telemetry",
    )


@main_bp.route("/network")
@login_required
def network_page():
    return render_template(
        "dashboard.html",
        user=current_user(),
        csrf=session["csrf"],
        rms_kill_enabled=current_app.config["RMS_KILL_ENABLED"],
        view="network",
    )


@main_bp.route("/settings")
@login_required
@role_required("admin")
def settings():
    with db(current_app.config["DATABASE"]) as conn:
        users = [dict(row) for row in conn.execute("SELECT id,username,role,created_at FROM users ORDER BY username")]
        logs = [dict(row) for row in conn.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100")]
    for row in users:
        row["created_at_label"] = time.strftime("%Y-%m-%d %H:%M", time.localtime(row["created_at"]))
    for row in logs:
        row["timestamp_label"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(row["timestamp"]))
    return render_template("settings.html", user=current_user(), csrf=session["csrf"], users=users, logs=logs)


@main_bp.route("/api/state")
@login_required
def state():
    return serial_worker.latest_state


@main_bp.route("/api/network/state")
@login_required
def network_state():
    return serial_worker.network_state()


def _time_window_args():
    now = time.time()
    seconds = request.args.get("seconds")
    start_ts = request.args.get("start")
    end_ts = request.args.get("end")
    start = float(start_ts) if start_ts else None
    end = float(end_ts) if end_ts else None
    if seconds and start is None:
        start = now - float(seconds)
    return start, end


@main_bp.route("/api/telemetry/recent")
@login_required
def telemetry_recent():
    start, end = _time_window_args()
    limit = min(2400, int(request.args.get("limit", "600")))
    return {"rows": telemetry_payloads(current_app.config["DATABASE"], start, end, limit)}


@main_bp.route("/api/telemetry/fields")
@login_required
def telemetry_fields():
    start, end = _time_window_args()
    return {"fields": known_telemetry_fields(current_app.config["DATABASE"], start, end)}


@main_bp.route("/api/analysis/summary")
@login_required
def analysis_summary():
    start, end = _time_window_args()
    return telemetry_summary(current_app.config["DATABASE"], start, end)


@main_bp.route("/api/recording/marker", methods=["POST"])
@login_required
@csrf_required
@role_required("admin", "operator")
def recording_marker():
    data = request.get_json(force=True, silent=True) or {}
    label = str(data.get("label", "MARK")).strip()[:80] or "MARK"
    payload = {
        "timestamp": time.time(),
        "marker": label,
        "raw": f"MARK:{label}",
        "state": serial_worker.latest_state.get("state", "MARK"),
    }
    store_telemetry(current_app.config["DATABASE"], payload)
    audit(current_app.config["DATABASE"], session["username"], "RECORDING_MARKER", {"label": label}, request.remote_addr)
    return {"ok": True, "marker": payload}


@main_bp.route("/api/command/kill", methods=["POST"])
@login_required
@csrf_required
@role_required("admin", "operator")
def kill():
    if not current_app.config["RMS_KILL_ENABLED"]:
        audit(current_app.config["DATABASE"], session["username"], "RMS_KILL_DISABLED", ip_address=request.remote_addr)
        return {"error": "rms kill disabled"}, 409
    serial_worker.send("CMD:KILL\n")
    audit(current_app.config["DATABASE"], session["username"], "EMERGENCY_KILL", ip_address=request.remote_addr)
    return {"ok": True}


@main_bp.route("/api/pid", methods=["POST"])
@login_required
@csrf_required
@role_required("admin", "operator")
def pid():
    data = request.get_json(force=True)
    axes = ("roll", "pitch", "yaw")
    if all(axis in data for axis in axes):
        values = {
            axis: {key: float(data[axis][key]) for key in ("kp", "ki", "kd")}
            for axis in axes
        }
    else:
        legacy = {key: float(data[key]) for key in ("kp", "ki", "kd")}
        values = {axis: dict(legacy) for axis in axes}

    for axis_values in values.values():
        if not (0 <= axis_values["kp"] <= 1 and 0 <= axis_values["ki"] <= 0.5 and 0 <= axis_values["kd"] <= 0.5):
            return {"error": "range"}, 400

    command = (
        f"PID:KPR={values['roll']['kp']:.3f},KIR={values['roll']['ki']:.4f},KDR={values['roll']['kd']:.3f},"
        f"KPP={values['pitch']['kp']:.3f},KIP={values['pitch']['ki']:.4f},KDP={values['pitch']['kd']:.3f},"
        f"KPY={values['yaw']['kp']:.3f},KIY={values['yaw']['ki']:.4f},KDY={values['yaw']['kd']:.3f}\n"
    )
    serial_worker.send(command)
    audit(current_app.config["DATABASE"], session["username"], "PID_CHANGE", {**values, "command": command.strip()}, request.remote_addr)
    return {"ok": True, "values": values, "command": command.strip()}


@main_bp.route("/api/users", methods=["POST"])
@login_required
@csrf_required
@role_required("admin")
def create_user():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    role = request.form.get("role", "viewer")
    if not username or len(password) < 8 or role not in {"admin", "operator", "viewer"}:
        return {"error": "invalid user"}, 400
    try:
        with db(current_app.config["DATABASE"]) as conn:
            conn.execute(
                "INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)",
                (username, bcrypt.hashpw(password.encode(), bcrypt.gensalt()), role, time.time()),
            )
    except sqlite3.IntegrityError:
        return {"error": "username already exists"}, 400
    audit(current_app.config["DATABASE"], session["username"], "USER_CREATE", {"username": username, "role": role}, request.remote_addr)
    return redirect(url_for("main.settings"))


def _admin_count(conn):
    row = conn.execute("SELECT COUNT(*) AS count FROM users WHERE role='admin'").fetchone()
    return row["count"] if row else 0


@main_bp.route("/api/users/<int:user_id>/update", methods=["POST"])
@login_required
@csrf_required
@role_required("admin")
def update_user(user_id):
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    role = request.form.get("role", "viewer")
    if not username or role not in {"admin", "operator", "viewer"}:
        return {"error": "invalid user"}, 400
    if password and len(password) < 8:
        return {"error": "password must be at least 8 characters"}, 400

    try:
        with db(current_app.config["DATABASE"]) as conn:
            existing = conn.execute("SELECT id,username,role FROM users WHERE id=?", (user_id,)).fetchone()
            if not existing:
                return {"error": "user not found"}, 404
            if existing["role"] == "admin" and role != "admin" and _admin_count(conn) <= 1:
                return {"error": "cannot remove the last admin"}, 400
            if password:
                conn.execute(
                    "UPDATE users SET username=?, role=?, password_hash=? WHERE id=?",
                    (username, role, bcrypt.hashpw(password.encode(), bcrypt.gensalt()), user_id),
                )
            else:
                conn.execute("UPDATE users SET username=?, role=? WHERE id=?", (username, role, user_id))
    except sqlite3.IntegrityError:
        return {"error": "username already exists"}, 400

    if session.get("username") == existing["username"]:
        session["username"] = username
        session["role"] = role
    audit(
        current_app.config["DATABASE"],
        session["username"],
        "USER_UPDATE",
        {"user_id": user_id, "username": username, "role": role, "password_changed": bool(password)},
        request.remote_addr,
    )
    return redirect(url_for("main.settings"))


@main_bp.route("/api/users/<int:user_id>/delete", methods=["POST"])
@login_required
@csrf_required
@role_required("admin")
def delete_user(user_id):
    with db(current_app.config["DATABASE"]) as conn:
        existing = conn.execute("SELECT id,username,role FROM users WHERE id=?", (user_id,)).fetchone()
        if not existing:
            return {"error": "user not found"}, 404
        if existing["username"] == session.get("username"):
            return {"error": "cannot delete the account you are currently using"}, 400
        if existing["role"] == "admin" and _admin_count(conn) <= 1:
            return {"error": "cannot delete the last admin"}, 400
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    audit(
        current_app.config["DATABASE"],
        session["username"],
        "USER_DELETE",
        {"user_id": user_id, "username": existing["username"], "role": existing["role"]},
        request.remote_addr,
    )
    return redirect(url_for("main.settings"))


@main_bp.route("/api/alarm-thresholds", methods=["POST"])
@login_required
@csrf_required
@role_required("admin")
def alarm_thresholds():
    data = request.get_json(force=True)
    low = float(data.get("low", 30.0))
    critical = float(data.get("critical", 20.0))
    emergency = float(data.get("emergency", 10.0))
    if not (0.0 <= emergency < critical < low <= 100.0):
        return {"error": "range"}, 400
    serial_worker.send(f"BAT:LOW={low:.2f},CRIT={critical:.2f},EMERG={emergency:.2f}\n")
    audit(current_app.config["DATABASE"], session["username"], "ALARM_THRESHOLD_CHANGE", data, request.remote_addr)
    return {"ok": True}


@main_bp.route("/api/calibration/start", methods=["POST"])
@login_required
@csrf_required
@role_required("admin")
def calibration_start():
    serial_worker.send("CMD:CALIBRATE\n")
    audit(current_app.config["DATABASE"], session["username"], "CALIBRATION_TRIGGERED", ip_address=request.remote_addr)
    return {"ok": True}


@main_bp.route("/api/audit")
@login_required
@role_required("admin", "operator")
def audit_log():
    with db(current_app.config["DATABASE"]) as conn:
        rows = [dict(row) for row in conn.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 500")]
    return {"rows": rows}


@main_bp.route("/api/export/csv")
@login_required
def export_csv_route():
    start, end = _time_window_args()
    requested = request.args.get("fields", "all")
    if requested == "all":
        fields = known_telemetry_fields(current_app.config["DATABASE"], start, end)
        fields = [field for field in fields if field not in {"timestamp", "raw_lines"}]
    else:
        fields = [field for field in requested.split(",") if field]
    content = export_csv(current_app.config["DATABASE"], fields, start, end)
    audit(current_app.config["DATABASE"], session["username"], "EXPORT_CSV", {"fields": fields}, request.remote_addr)
    filename = time.strftime("tparc_telemetry_%Y%m%d_%H%M%S.csv")
    return Response(content, headers={"Content-Disposition": f"attachment; filename={filename}"}, mimetype="text/csv")


@main_bp.route("/api/export/json")
@login_required
def export_json_route():
    start, end = _time_window_args()
    content = export_json(current_app.config["DATABASE"], start, end)
    audit(current_app.config["DATABASE"], session["username"], "EXPORT_JSON", ip_address=request.remote_addr)
    filename = time.strftime("tparc_telemetry_%Y%m%d_%H%M%S.json")
    return Response(content, headers={"Content-Disposition": f"attachment; filename={filename}"}, mimetype="application/json")


@main_bp.route("/api/export/pdf")
@login_required
def export_pdf_route():
    from io import BytesIO
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.setTitle("TP-ARC telemetry report")
    pdf.drawString(72, 740, "TP-ARC telemetry report")
    pdf.drawString(72, 720, f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    summary = telemetry_summary(current_app.config["DATABASE"], time.time() - 1800, None)
    pdf.drawString(72, 700, f"Samples: {summary['count']}  Duration: {summary['duration_s']:.1f}s  Rate: {summary['sample_rate_hz']:.2f}Hz")
    y = 676
    for field in ("roll", "pitch", "yaw", "gyro_yaw_rate", "heading_error", "baro_relative_altitude_m", "baro_pressure_hpa", "baro_temperature_c", "m1", "m2", "m3", "m4"):
        stats = summary["numeric"].get(field)
        if not stats:
            continue
        pdf.drawString(72, y, f"{field}: min {stats['min']:.2f}, avg {stats['avg']:.2f}, max {stats['max']:.2f}")
        y -= 18
    pdf.drawString(72, max(72, y - 12), "Use CSV or JSON export for complete telemetry rows.")
    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    audit(current_app.config["DATABASE"], session["username"], "EXPORT_PDF", ip_address=request.remote_addr)
    return send_file(buffer, as_attachment=True, download_name=time.strftime("tparc_report_%Y%m%d_%H%M%S.pdf"), mimetype="application/pdf")

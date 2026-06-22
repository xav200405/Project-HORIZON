import secrets
import time
from functools import wraps

import bcrypt
from flask import Blueprint, current_app, redirect, render_template, request, session, url_for

from .storage import audit, db

auth_bp = Blueprint("auth", __name__)


def init_auth(db_path):
    defaults = [("tparc", "tparc0322", "admin")]
    retired_defaults = [
        ("operator", "change-me-operator"),
        ("viewer", "change-me-viewer"),
    ]
    with db(db_path) as conn:
        for username, password, role in defaults:
            exists = conn.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)",
                    (username, bcrypt.hashpw(password.encode(), bcrypt.gensalt()), role, time.time()),
                )
        for username, password in retired_defaults:
            row = conn.execute("SELECT password_hash FROM users WHERE username=?", (username,)).fetchone()
            if row and bcrypt.checkpw(password.encode(), row["password_hash"]):
                conn.execute("DELETE FROM users WHERE username=?", (username,))


def current_user():
    return {"username": session.get("username"), "role": session.get("role", "viewer")}


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not session.get("username"):
            return redirect(url_for("auth.login"))
        session.permanent = True
        session["csrf"] = session.get("csrf") or secrets.token_hex(16)
        return view(*args, **kwargs)
    return wrapper


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if session.get("role") not in roles:
                return {"error": "forbidden"}, 403
            return view(*args, **kwargs)
        return wrapper
    return decorator


def csrf_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-CSRF-Token") or request.form.get("csrf")
        if token != session.get("csrf"):
            return {"error": "csrf"}, 400
        return view(*args, **kwargs)
    return wrapper


def _locked(conn, ip):
    row = conn.execute("SELECT count,locked_until FROM login_failures WHERE ip_address=?", (ip,)).fetchone()
    if not row:
        return False, 0
    if row["locked_until"] > time.time():
        return True, int(row["locked_until"] - time.time())
    return False, 0


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    message = None
    ip = request.remote_addr or "unknown"
    login_success_user = None
    login_failure_user = None
    with db(current_app.config["DATABASE"]) as conn:
        locked, seconds = _locked(conn, ip)
        if locked:
            message = f"Too many failed attempts. Try again in {seconds} seconds."
        elif request.method == "POST":
            username = request.form.get("username", "")
            password = request.form.get("password", "").encode()
            row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            if row and bcrypt.checkpw(password, row["password_hash"]):
                session.clear()
                session["username"] = row["username"]
                session["role"] = row["role"]
                session["csrf"] = secrets.token_hex(16)
                conn.execute("DELETE FROM login_failures WHERE ip_address=?", (ip,))
                login_success_user = row["username"]
            row_fail = conn.execute("SELECT count FROM login_failures WHERE ip_address=?", (ip,)).fetchone()
            if login_success_user is None:
                count = (row_fail["count"] if row_fail else 0) + 1
                locked_until = time.time() + 300 if count >= 5 else 0
                conn.execute(
                    "INSERT OR REPLACE INTO login_failures(ip_address,count,locked_until) VALUES(?,?,?)",
                    (ip, count, locked_until),
                )
                login_failure_user = username or "anonymous"
                message = "Invalid credentials"
    if login_success_user:
        audit(current_app.config["DATABASE"], login_success_user, "LOGIN_SUCCESS", ip_address=ip)
        return redirect(url_for("main.dashboard"))
    if login_failure_user:
        audit(current_app.config["DATABASE"], login_failure_user, "LOGIN_FAILURE", ip_address=ip)
    return render_template("login.html", message=message)


@auth_bp.route("/logout", methods=["POST"])
@login_required
@csrf_required
def logout():
    user = session.get("username")
    audit(current_app.config["DATABASE"], user, "LOGOUT", ip_address=request.remote_addr)
    session.clear()
    return redirect(url_for("auth.login"))

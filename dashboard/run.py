from app import create_app, socketio

app = create_app()

if __name__ == "__main__":
    import os

    allow_insecure = os.environ.get("TPARC_ALLOW_INSECURE_DEV") == "1"
    cert = os.environ.get("TPARC_TLS_CERT", "cert.pem")
    key = os.environ.get("TPARC_TLS_KEY", "key.pem")
    port = 5000 if allow_insecure else 8443
    if allow_insecure:
        socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
    else:
        socketio.run(app, host="0.0.0.0", port=port, certfile=cert, keyfile=key, allow_unsafe_werkzeug=True)

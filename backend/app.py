import logging
import os
from pathlib import Path

from flask import Flask, abort, jsonify, send_from_directory
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from config import Config
from db import init_db, ping_db
from extensions import cors, jwt
from routes.access import bp as access_bp
from routes.admin import bp as admin_bp
from routes.auth import bp as auth_bp
from routes.documents import bp as documents_bp
from routes.metadata import bp as metadata_bp
from routes.search import bp as search_bp
from services import ocr_service

MIN_SECRET_LENGTH = 32


def validate_config(app):
    for config_key, env_name in (("SECRET_KEY", "FLASK_SECRET_KEY"), ("JWT_SECRET_KEY", "JWT_SECRET_KEY")):
        if len(app.config.get(config_key) or "") < MIN_SECRET_LENGTH:
            raise RuntimeError(
                f"{env_name} must be set in backend/.env to a random value of at least "
                f"{MIN_SECRET_LENGTH} characters. Generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )


def register_error_handlers(app):
    @jwt.expired_token_loader
    def expired_token(_header, _payload):
        return jsonify({"error": "Your session has expired. Please log in again.", "code": "token_expired"}), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        # Flask-JWT-Extended defaults to 422 for malformed tokens; 401 lets clients treat it as "sign in again".
        return jsonify({"error": f"Invalid session token ({reason}). Please log in again.", "code": "token_invalid"}), 401

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_exc):
        limit_mb = app.config["MAX_CONTENT_LENGTH"] / (1024 * 1024)
        return jsonify({"error": f"File is too large. The maximum upload size is {limit_mb:g} MB."}), 413

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return jsonify({"error": exc.description}), exc.code

    @app.errorhandler(Exception)
    def unhandled(exc):
        app.logger.exception("Unhandled error: %s", exc)
        return jsonify({"error": "Internal server error"}), 500


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    validate_config(app)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    # Expose Content-Disposition so the cross-origin frontend can read the download filename.
    cors.init_app(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
                  expose_headers=["Content-Disposition"])
    jwt.init_app(app)
    init_db(app)
    ocr_service.configure(app.config["TESSERACT_CMD"], app.config["POPPLER_PATH"])
    register_error_handlers(app)

    for blueprint in (auth_bp, documents_bp, access_bp, search_bp, metadata_bp, admin_bp):
        app.register_blueprint(blueprint)

    @app.get("/api/health")
    def health():
        db_ok = ping_db()
        ocr = ocr_service.ocr_status()
        return jsonify({
            "status": "success" if db_ok else "error",
            "message": "DMS Backend is running",
            "database": "Connected" if db_ok else "Unavailable",
            "ocr": {"tesseract": ocr["tesseract"] or "Not installed",
                    "poppler": "Available" if ocr["poppler"] else "Not installed"},
        }), 200 if db_ok else 503

    register_frontend(app)
    return app


def find_frontend_dir(app):
    """The frontend folder: FRONTEND_DIR, ./frontend (Docker image) or ../frontend (source checkout)."""
    configured = os.getenv("FRONTEND_DIR", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates += [Path(app.root_path) / "frontend", Path(app.root_path).parent / "frontend"]
    return next((p.resolve() for p in candidates if (p / "index.html").is_file()), None)


def register_frontend(app):
    """Serve the single-page frontend from the API's own origin (one service, no CORS needed)."""
    root = find_frontend_dir(app)
    if root is None:
        @app.get("/")
        def index():
            return jsonify({"name": "TRIAD AI Document Management System", "health": "/api/health"}), 200
        return

    @app.get("/")
    def index():
        return send_from_directory(root, "index.html")

    @app.get("/<path:path>")
    def frontend_file(path):
        if path.startswith("api/"):
            abort(404)
        # send_from_directory refuses paths that escape the frontend folder.
        return send_from_directory(root, path)


if __name__ == "__main__":
    application = create_app()
    # Debug mode (and its interactive debugger) only when FLASK_DEBUG=true; bound to 127.0.0.1 by default.
    application.run(host=application.config["HOST"], port=application.config["PORT"],
                    debug=application.config["DEBUG"])

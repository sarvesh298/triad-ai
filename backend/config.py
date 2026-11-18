import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


def _bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _int(name, default):
    value = os.getenv(name, "").strip()
    return int(value) if value else default


def _list(name):
    return [v.strip() for v in os.getenv(name, "").split(",") if v.strip()]


class Config:
    # Secrets have no fallback values: create_app() refuses to start without them.
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=_int("JWT_EXPIRES_MINUTES", 60))
    # Return JWT errors as {"error": ...}, the same shape every other endpoint uses.
    JWT_ERROR_MESSAGE_KEY = "error"

    MONGO_URI = os.getenv("MONGO_URI", "")
    MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "triad_dms")

    MAX_CONTENT_LENGTH = _int("MAX_CONTENT_LENGTH", 20 * 1024 * 1024)

    OCR_LANG = os.getenv("OCR_LANG", "eng")
    OCR_MAX_PAGES = _int("OCR_MAX_PAGES", 50)
    TESSERACT_CMD = os.getenv("TESSERACT_CMD", "")
    POPPLER_PATH = os.getenv("POPPLER_PATH", "")

    DEBUG = _bool("FLASK_DEBUG", False)
    HOST = os.getenv("HOST", "127.0.0.1")
    PORT = _int("PORT", 5000)
    CORS_ORIGINS = _list("CORS_ORIGINS") or "*"

    # New accounts stay inactive until an admin approves them and confirms their division.
    REQUIRE_ACCOUNT_APPROVAL = _bool("REQUIRE_ACCOUNT_APPROVAL", True)
    # Optional comma-separated whitelist, e.g. "Division A,Division B".
    DIVISIONS = _list("DIVISIONS")

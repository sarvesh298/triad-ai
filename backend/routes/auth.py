import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token
from pymongo.errors import DuplicateKeyError
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db
from utils.rate_limit import FailureLimiter
from utils.security import current_user, public_user, token_required

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
login_limiter = FailureLimiter(max_failures=5, window_seconds=300)


def resolve_division(value):
    """Return the canonical division name, or None if a whitelist is configured and value is not on it."""
    value = " ".join((value or "").split())
    allowed = current_app.config.get("DIVISIONS") or []
    if not allowed:
        return value or None
    return next((d for d in allowed if d.lower() == value.lower()), None)


@bp.get("/divisions")
def divisions():
    return jsonify({"divisions": current_app.config.get("DIVISIONS") or []}), 200


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    raw_division = data.get("division") or ""

    if not all([name, email, password, raw_division.strip()]):
        return jsonify({"error": "name, email, password and division are required"}), 400
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Enter a valid email address"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must contain at least 8 characters"}), 400
    division = resolve_division(raw_division)
    if not division:
        allowed = ", ".join(current_app.config["DIVISIONS"])
        return jsonify({"error": f"division must be one of: {allowed}"}), 400

    # Accounts are usable immediately: no administrator approval step.
    user = {
        "name": name,
        "email": email,
        "password_hash": generate_password_hash(password),
        "division": division,
        "role": "user",
        "status": "active",
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = get_db().users.insert_one(user)
    except DuplicateKeyError:
        return jsonify({"error": "Email already registered"}), 409

    return jsonify({"message": "Registration successful", "user_id": str(result.inserted_id), "status": "active"}), 201


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    limit_key = (request.remote_addr, email)

    wait = login_limiter.retry_after(limit_key)
    if wait:
        resp = jsonify({"error": f"Too many failed attempts. Try again in {wait} seconds."})
        resp.headers["Retry-After"] = str(wait)
        return resp, 429

    user = get_db().users.find_one({"email": email}) if email else None
    if not user or not check_password_hash(user.get("password_hash", ""), password):
        login_limiter.record_failure(limit_key)
        return jsonify({"error": "Invalid email or password"}), 401

    # Only an explicit deactivation by an administrator blocks sign-in.
    if user.get("status") == "deactivated":
        return jsonify({"error": "Your account has been deactivated. Contact an administrator."}), 403
    if user.get("status", "active") != "active" or not user.get("is_active", True):
        # Accounts left "pending"/"rejected" by the old approval workflow become active on sign-in.
        get_db().users.update_one({"_id": user["_id"]}, {"$set": {"status": "active", "is_active": True}})
        user.update(status="active", is_active=True)

    login_limiter.reset(limit_key)
    token = create_access_token(identity=str(user["_id"]))
    return jsonify({"access_token": token, "user": public_user(user)}), 200


@bp.get("/me")
@token_required
def me():
    return jsonify({"user": public_user(current_user())}), 200

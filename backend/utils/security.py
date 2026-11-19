from functools import wraps

from bson import ObjectId
from flask import g, jsonify
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from db import get_db


def parse_object_id(value):
    """Return an ObjectId, or None if value is not a valid id."""
    value = str(value or "")
    return ObjectId(value) if ObjectId.is_valid(value) else None


def current_user():
    """The authenticated user document, loaded once per request."""
    if "current_user" in g:
        return g.current_user
    oid = parse_object_id(get_jwt_identity())
    g.current_user = get_db().users.find_one({"_id": oid}) if oid else None
    return g.current_user


def is_account_active(user):
    # Every account is usable except one an administrator has deactivated.
    return bool(user) and user.get("status") != "deactivated"


def _authenticate():
    """Verify the JWT and load the user. Returns an error response, or None if authenticated."""
    verify_jwt_in_request()
    user = current_user()
    if not user:
        return jsonify({"error": "Invalid session. Please log in again."}), 401
    if not is_account_active(user):
        return jsonify({"error": "Your account is not active."}), 401
    return None


def token_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        error = _authenticate()
        if error:
            return error
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        error = _authenticate()
        if error:
            return error
        if current_user().get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return fn(*args, **kwargs)
    return wrapper


def public_user(user):
    return {
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "division": user["division"],
        "role": user.get("role", "user"),
        "status": user.get("status", "active"),
    }

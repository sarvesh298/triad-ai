from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from db import get_db
from routes.auth import resolve_division
from utils.security import admin_required, current_user, parse_object_id, public_user

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

USER_STATUSES = {"pending", "active", "rejected", "deactivated"}


@bp.get("/users")
@admin_required
def list_users():
    status = request.args.get("status")
    query = {}
    if status:
        if status not in USER_STATUSES:
            return jsonify({"error": f"status must be one of: {', '.join(sorted(USER_STATUSES))}"}), 400
        # Legacy accounts without a status field are active.
        query = {"$or": [{"status": "active"}, {"status": {"$exists": False}}]} if status == "active" \
            else {"status": status}
    users = get_db().users.find(query, {"password_hash": 0}).sort("created_at", -1).limit(500)
    return jsonify({"users": [
        {**public_user(u), "created_at": u["created_at"].isoformat() if u.get("created_at") else None}
        for u in users
    ]}), 200


def _set_status(user_id, status, extra=None):
    oid = parse_object_id(user_id)
    if not oid:
        return jsonify({"error": "Invalid user id"}), 400
    admin = current_user()
    if oid == admin["_id"]:
        return jsonify({"error": "You cannot change your own account status"}), 403
    db = get_db()
    if not db.users.find_one({"_id": oid}):
        return jsonify({"error": "User not found"}), 404
    changes = {
        "status": status, "is_active": status == "active",
        "reviewed_by": admin["_id"], "reviewed_at": datetime.now(timezone.utc),
        **(extra or {}),
    }
    db.users.update_one({"_id": oid}, {"$set": changes})
    return jsonify({"message": f"User {status}", "user": public_user(db.users.find_one({"_id": oid}))}), 200


@bp.post("/users/<user_id>/approve")
@admin_required
def approve_user(user_id):
    """Activate an account. An optional {"division": "..."} confirms or corrects the user's division."""
    data = request.get_json(silent=True) or {}
    extra = {}
    if data.get("division"):
        division = resolve_division(data["division"])
        if not division:
            return jsonify({"error": f"division must be one of: {', '.join(current_app.config['DIVISIONS'])}"}), 400
        extra["division"] = division
    return _set_status(user_id, "active", extra)


@bp.post("/users/<user_id>/reject")
@admin_required
def reject_user(user_id):
    return _set_status(user_id, "rejected")


@bp.post("/users/<user_id>/deactivate")
@admin_required
def deactivate_user(user_id):
    return _set_status(user_id, "deactivated")

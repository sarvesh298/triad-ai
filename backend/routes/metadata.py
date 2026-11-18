from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from pymongo.errors import DuplicateKeyError

from db import get_db
from utils.metadata import MetadataError, is_valid_key, normalize_key, validate_field_definition
from utils.security import admin_required, current_user, token_required

bp = Blueprint("metadata", __name__, url_prefix="/api/metadata")


def serialize_field(f):
    return {
        "key": f["key"],
        "label": f.get("label", f["key"]),
        "type": f.get("type", "text"),
        "required": f.get("required", False),
        "options": f.get("options", []),
        "active": f.get("active", True),
    }


@bp.get("/fields")
@token_required
def list_fields():
    query = {} if request.args.get("include_inactive") == "true" and current_user().get("role") == "admin" \
        else {"active": True}
    fields = get_db().metadata_fields.find(query).sort("created_at", 1)
    return jsonify({"fields": [serialize_field(f) for f in fields]}), 200


@bp.post("/fields")
@admin_required
def create_field():
    data = request.get_json(silent=True) or {}
    key = normalize_key(data.get("key"))
    if not is_valid_key(key):
        return jsonify({"error": "key must start with a letter or number and contain only letters, "
                                 "numbers, spaces, _ or - (max 64)"}), 400
    try:
        field = validate_field_definition(data)
    except MetadataError as exc:
        return jsonify({"error": str(exc)}), 400

    field.update({
        "key": key, "active": True,
        "created_at": datetime.now(timezone.utc), "created_by": current_user()["_id"],
    })
    try:
        get_db().metadata_fields.insert_one(field)
    except DuplicateKeyError:
        return jsonify({"error": "Metadata field already exists"}), 409
    return jsonify({"message": "Metadata field created", "field": serialize_field(field)}), 201


@bp.patch("/fields/<key>")
@admin_required
def update_field(key):
    data = request.get_json(silent=True) or {}
    db = get_db()
    existing = db.metadata_fields.find_one({"key": key})
    if not existing:
        return jsonify({"error": "Metadata field not found"}), 404
    try:
        changes = validate_field_definition(data, partial=True)
        # Re-check select/options against the merged result, not only the supplied part.
        merged = {**existing, **changes}
        if merged.get("type") == "select" and not merged.get("options"):
            raise MetadataError("select fields need at least one option")
    except MetadataError as exc:
        return jsonify({"error": str(exc)}), 400
    if not changes:
        return jsonify({"error": "No editable fields supplied"}), 400
    db.metadata_fields.update_one({"key": key}, {"$set": changes})
    return jsonify({"message": "Metadata field updated", "field": serialize_field(merged)}), 200

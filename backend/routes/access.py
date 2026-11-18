from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from db import get_db
from utils.security import current_user, parse_object_id, token_required

bp = Blueprint("access", __name__, url_prefix="/api/access")


def _iso(value):
    return value.isoformat() if value else None


def serialize_request(r):
    return {
        "id": str(r["_id"]),
        "document_id": str(r["document_id"]),
        "document_title": r["document_title"],
        "document_division": r["document_division"],
        "requester_name": r["requester_name"],
        "requester_division": r["requester_division"],
        "status": r["status"],
        "created_at": _iso(r.get("created_at")),
        "reviewed_at": _iso(r.get("reviewed_at")),
    }


@bp.post("/request")
@token_required
def request_access():
    data = request.get_json(silent=True) or {}
    doc_oid = parse_object_id(data.get("doc_id"))
    if not doc_oid:
        return jsonify({"error": "Valid doc_id is required"}), 400
    user = current_user()
    db = get_db()
    doc = db.documents.find_one({"_id": doc_oid})
    if not doc:
        return jsonify({"error": "Document not found"}), 404
    if doc["division"] == user["division"]:
        return jsonify({"error": "You already belong to this document's division"}), 400

    existing = db.access_requests.find_one({
        "document_id": doc["_id"], "requester_id": user["_id"], "status": {"$in": ["pending", "approved"]},
    })
    if existing:
        message = "You already have access to this document" if existing["status"] == "approved" \
            else "Request is already pending"
        return jsonify({"message": message, "request_id": str(existing["_id"]), "status": existing["status"]}), 200

    result = db.access_requests.insert_one({
        "document_id": doc["_id"], "document_title": doc["title"],
        "document_division": doc["division"], "requester_id": user["_id"],
        "requester_name": user["name"], "requester_division": user["division"],
        "status": "pending", "created_at": datetime.now(timezone.utc),
    })
    return jsonify({"message": "Access request submitted", "request_id": str(result.inserted_id),
                    "status": "pending"}), 201


@bp.get("/inbox")
@token_required
def inbox():
    """Requests made by other divisions for documents owned by the current user's division."""
    user = current_user()
    requests = get_db().access_requests.find({"document_division": user["division"]}).sort("created_at", -1)
    return jsonify({"requests": [serialize_request(r) for r in requests]}), 200


@bp.get("/my-requests")
@token_required
def my_requests():
    """Requests the current user has made for other divisions' documents."""
    user = current_user()
    requests = get_db().access_requests.find({"requester_id": user["_id"]}).sort("created_at", -1)
    return jsonify({"requests": [serialize_request(r) for r in requests]}), 200


@bp.post("/approve")
@token_required
def approve_access():
    return update_request("approved")


@bp.post("/reject")
@token_required
def reject_access():
    return update_request("rejected")


def update_request(status):
    data = request.get_json(silent=True) or {}
    request_oid = parse_object_id(data.get("request_id"))
    if not request_oid:
        return jsonify({"error": "Valid request_id is required"}), 400
    user = current_user()
    db = get_db()
    access_req = db.access_requests.find_one({"_id": request_oid})
    if not access_req:
        return jsonify({"error": "Request not found"}), 404
    if access_req["document_division"] != user["division"] and user.get("role") != "admin":
        return jsonify({"error": "Only the document's division can decide this request"}), 403
    if access_req["requester_id"] == user["_id"]:
        return jsonify({"error": "You cannot decide your own access request"}), 403

    # Conditional update so two reviewers acting at once cannot both succeed.
    result = db.access_requests.update_one(
        {"_id": access_req["_id"], "status": "pending"},
        {"$set": {"status": status, "reviewed_by": user["_id"], "reviewed_at": datetime.now(timezone.utc)}},
    )
    if not result.modified_count:
        return jsonify({"error": "Request has already been processed"}), 409
    return jsonify({"message": f"Access request {status}"}), 200

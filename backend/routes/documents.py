import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from io import BytesIO

from flask import Blueprint, current_app, jsonify, request, send_file
from gridfs.errors import NoFile

from db import get_db, get_fs
from services.ocr_service import OCRError, extract_text
from utils.metadata import MetadataError, is_valid_key, normalize_key, validate_document_metadata
from utils.security import current_user, parse_object_id, token_required

log = logging.getLogger(__name__)

bp = Blueprint("documents", __name__, url_prefix="/api/documents")

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
# Underscore-prefixed list options can never collide with metadata keys,
# which must start with a letter or digit.
RESERVED_QUERY_PARAMS = {"page", "limit", "division", "_q", "_type", "_sort"}
IMAGE_EXT_RE = r"\.(png|jpe?g|tiff?)$"
SORTS = {"newest": [("created_at", -1)], "oldest": [("created_at", 1)], "title": [("title", 1)]}
OCR_EXCERPT_CHARS = 4000


def serialize_doc(d):
    created = d.get("created_at")
    return {
        "id": str(d["_id"]),
        "title": d.get("title") or d.get("filename", ""),
        "filename": d.get("filename", ""),
        "content_type": d.get("content_type", "application/octet-stream"),
        "size": d.get("size"),
        "division": d["division"],
        "owner_name": d.get("owner_name"),
        "metadata": d.get("metadata", {}),
        "ocr_status": d.get("ocr_status", "unknown"),
        "created_at": created.isoformat() if created else None,
    }


def with_owner_names(docs):
    """Fill owner_name for documents uploaded before it was stored on the document."""
    missing = {d["owner_id"] for d in docs if not d.get("owner_name") and d.get("owner_id")}
    if missing:
        names = {u["_id"]: u["name"] for u in get_db().users.find({"_id": {"$in": list(missing)}}, {"name": 1})}
        for d in docs:
            if not d.get("owner_name"):
                d["owner_name"] = names.get(d.get("owner_id"))
    return docs


def has_approved_access(doc, user):
    return bool(get_db().access_requests.find_one({
        "document_id": doc["_id"], "requester_id": user["_id"], "status": "approved",
    }))


def _find_document(doc_id):
    """Return (doc, error_response)."""
    oid = parse_object_id(doc_id)
    if not oid:
        return None, (jsonify({"error": "Invalid document id"}), 400)
    doc = get_db().documents.find_one({"_id": oid})
    if not doc:
        return None, (jsonify({"error": "Document not found"}), 404)
    return doc, None


@bp.post("/upload")
@token_required
def upload_document():
    user = current_user()
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "A file is required"}), 400

    # Keep only the base name (some browsers send a full client-side path).
    filename = os.path.basename(uploaded.filename.replace("\\", "/")).strip()
    if os.path.splitext(filename.lower())[1] not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Only PDF and image files (png, jpg, jpeg, tif, tiff) are supported"}), 400

    # An empty title field falls back to the filename.
    title = (request.form.get("title") or "").strip() or filename

    try:
        metadata = json.loads(request.form.get("metadata") or "{}")
    except (ValueError, TypeError):
        return jsonify({"error": "metadata must be a JSON object"}), 400

    db = get_db()
    fields = list(db.metadata_fields.find({"active": True}))
    try:
        metadata = validate_document_metadata(metadata, fields)
    except MetadataError as exc:
        return jsonify({"error": str(exc)}), 400

    file_bytes = uploaded.read()
    if not file_bytes:
        return jsonify({"error": "The uploaded file is empty"}), 400

    ocr_error = None
    try:
        ocr_text = extract_text(
            file_bytes, filename,
            lang=current_app.config["OCR_LANG"], max_pages=current_app.config["OCR_MAX_PAGES"],
        )
        ocr_status = "completed" if ocr_text else "no_text"
    except OCRError as exc:
        # The upload still succeeds; the reason is stored and returned so it is not silent.
        ocr_text, ocr_status, ocr_error = "", "failed", str(exc)
        log.warning("OCR failed for %r: %s", filename, exc)

    content_type = uploaded.mimetype or "application/octet-stream"
    grid_id = get_fs().upload_from_stream(
        filename, BytesIO(file_bytes), metadata={"content_type": content_type}
    )
    doc = {
        "title": title,
        "filename": filename,
        "content_type": content_type,
        "size": len(file_bytes),
        "file_id": grid_id,
        "division": user["division"],
        "owner_id": user["_id"],
        "owner_name": user["name"],
        "metadata": metadata,
        "metadata_text": " ".join(f"{k} {v}" for k, v in metadata.items()),
        "ocr_text": ocr_text,
        "ocr_status": ocr_status,
        "ocr_error": ocr_error,
        "created_at": datetime.now(timezone.utc),
    }
    result = db.documents.insert_one(doc)

    response = {
        "message": "Document uploaded",
        "document_id": str(result.inserted_id),
        "ocr_status": ocr_status,
        "ocr_characters": len(ocr_text),
    }
    if ocr_error:
        response["ocr_error"] = ocr_error
    return jsonify(response), 201


@bp.get("")
@token_required
def list_documents():
    user = current_user()
    # Division always comes from the account, never from the query string.
    query = {"division": user["division"]}

    for raw_key, value in request.args.items():
        if raw_key in RESERVED_QUERY_PARAMS:
            continue
        key = normalize_key(raw_key)
        if not is_valid_key(key):
            return jsonify({"error": f'Invalid metadata filter "{raw_key}"'}), 400
        query[f"metadata.{key}"] = value

    # Optional helpers used by the frontend: _q (title/file name contains), _type (pdf|image), _sort.
    text = (request.args.get("_q") or "").strip()
    if text:
        pattern = {"$regex": re.escape(text[:200]), "$options": "i"}
        query["$or"] = [{"title": pattern}, {"filename": pattern}]
    file_type = request.args.get("_type")
    if file_type == "pdf":
        query["filename"] = {"$regex": r"\.pdf$", "$options": "i"}
    elif file_type == "image":
        query["filename"] = {"$regex": IMAGE_EXT_RE, "$options": "i"}
    elif file_type:
        return jsonify({"error": "_type must be pdf or image"}), 400
    sort = SORTS.get(request.args.get("_sort") or "newest")
    if not sort:
        return jsonify({"error": f"_sort must be one of: {', '.join(SORTS)}"}), 400

    try:
        page = max(1, int(request.args.get("page", 1)))
        limit = min(100, max(1, int(request.args.get("limit", 50))))
    except ValueError:
        return jsonify({"error": "page and limit must be integers"}), 400

    db = get_db()
    docs = list(
        db.documents.find(query, {"ocr_text": 0, "metadata_text": 0})
        .sort(sort).skip((page - 1) * limit).limit(limit)
    )
    return jsonify({
        "documents": [serialize_doc(d) for d in with_owner_names(docs)],
        "page": page,
        "limit": limit,
        "total": db.documents.count_documents(query),
    }), 200


@bp.get("/stats")
@token_required
def document_stats():
    """Counts for the current user's division, used by the dashboard."""
    user = current_user()
    db = get_db()
    division = {"division": user["division"]}
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    outgoing = {
        s: db.access_requests.count_documents({"requester_id": user["_id"], "status": s})
        for s in ("pending", "approved", "rejected")
    }
    return jsonify({
        "division": user["division"],
        "total_documents": db.documents.count_documents(division),
        "uploaded_this_week": db.documents.count_documents({**division, "created_at": {"$gte": week_ago}}),
        "my_uploads": db.documents.count_documents({**division, "owner_id": user["_id"]}),
        "pdf_documents": db.documents.count_documents({**division, "filename": {"$regex": r"\.pdf$", "$options": "i"}}),
        "image_documents": db.documents.count_documents({**division, "filename": {"$regex": IMAGE_EXT_RE, "$options": "i"}}),
        "ocr_completed": db.documents.count_documents({**division, "ocr_status": "completed"}),
        "ocr_failed": db.documents.count_documents({**division, "ocr_status": "failed"}),
        "incoming_pending": db.access_requests.count_documents(
            {"document_division": user["division"], "status": "pending"}),
        "outgoing": outgoing,
    }), 200


@bp.get("/<doc_id>")
@token_required
def document_details(doc_id):
    doc, error = _find_document(doc_id)
    if error:
        return error
    user = current_user()
    same_division = doc["division"] == user["division"]

    latest_request = None
    if not same_division:
        latest_request = get_db().access_requests.find_one(
            {"document_id": doc["_id"], "requester_id": user["_id"]}, sort=[("created_at", -1)]
        )
    allowed = same_division or has_approved_access(doc, user)

    response = {
        "document": serialize_doc(with_owner_names([doc])[0]),
        "can_download": allowed,
        "action": "download" if allowed else "request_access",
        "access_request_status": latest_request["status"] if latest_request else None,
    }
    # Extracted text is document content, so it is only shared with users who may download it.
    if allowed:
        ocr_text = doc.get("ocr_text") or ""
        response["ocr"] = {
            "status": doc.get("ocr_status", "unknown"),
            "error": doc.get("ocr_error"),
            "characters": len(ocr_text),
            "text": ocr_text[:OCR_EXCERPT_CHARS],
            "truncated": len(ocr_text) > OCR_EXCERPT_CHARS,
        }
    return jsonify(response), 200


@bp.get("/<doc_id>/download")
@token_required
def download_document(doc_id):
    doc, error = _find_document(doc_id)
    if error:
        return error
    user = current_user()
    if doc["division"] != user["division"] and not has_approved_access(doc, user):
        return jsonify({"error": "Access denied. Request approval from the document's division."}), 403

    try:
        stream = get_fs().open_download_stream(doc["file_id"])
    except NoFile:
        log.error("GridFS file %s missing for document %s", doc.get("file_id"), doc["_id"])
        return jsonify({"error": "The stored file for this document is missing"}), 404

    return send_file(
        BytesIO(stream.read()),
        mimetype=doc.get("content_type", "application/octet-stream"),
        as_attachment=True,
        download_name=doc["filename"],
    )

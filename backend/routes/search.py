import re

from flask import Blueprint, jsonify, request

from db import get_db
from routes.documents import serialize_doc, with_owner_names
from utils.security import current_user, token_required

bp = Blueprint("search", __name__, url_prefix="/api/search")

MAX_QUERY_LENGTH = 200
SNIPPET_RADIUS = 110


def _snippet(text, term):
    """A short excerpt of text around the first case-insensitive match of term."""
    idx = text.lower().find(term.lower())
    if idx < 0:
        return None
    start = max(0, idx - SNIPPET_RADIUS)
    end = min(len(text), idx + len(term) + SNIPPET_RADIUS)
    excerpt = " ".join(text[start:end].split())
    return ("…" if start > 0 else "") + excerpt + ("…" if end < len(text) else "")


def _match_info(doc, term):
    """Which fields matched, and an OCR snippet, so the UI can explain each result."""
    lowered = term.lower()
    fields = []
    if lowered in (doc.get("title") or "").lower():
        fields.append("title")
    if lowered in (doc.get("filename") or "").lower():
        fields.append("filename")
    matched_keys = [k for k, v in (doc.get("metadata") or {}).items()
                    if lowered in str(v).lower() or lowered in k.lower()]
    if matched_keys:
        fields.append("metadata")
    snippet = _snippet(doc.get("ocr_text") or "", term)
    if snippet:
        fields.append("content")
    return {"fields": fields, "metadata_keys": matched_keys, "snippet": snippet}


@bp.get("")
@token_required
def search_documents():
    term = " ".join((request.args.get("q") or "").split())
    if not term:
        return jsonify({"error": "q query parameter is required"}), 400
    if len(term) > MAX_QUERY_LENGTH:
        return jsonify({"error": f"Search text must be at most {MAX_QUERY_LENGTH} characters"}), 400

    pattern = {"$regex": re.escape(term), "$options": "i"}
    docs = list(get_db().documents.find({
        "division": current_user()["division"],
        "$or": [{"title": pattern}, {"filename": pattern}, {"ocr_text": pattern}, {"metadata_text": pattern}],
    }, {"metadata_text": 0}).sort("created_at", -1).limit(100))

    results = []
    for d in with_owner_names(docs):
        item = serialize_doc(d)
        item["match"] = _match_info(d, term)
        results.append(item)
    return jsonify({"query": term, "results": results}), 200

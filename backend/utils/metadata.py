"""Validation rules for dynamic metadata, shared by the metadata and document routes."""
import re
from datetime import date

FIELD_TYPES = {"text", "select", "date"}
# Letters, digits, spaces, "_" and "-"; must start with a letter or digit. No "." or "$",
# which MongoDB treats specially in field paths and query operators.
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$")
MAX_VALUE_LENGTH = 500


class MetadataError(ValueError):
    pass


def normalize_key(key):
    return " ".join(str(key or "").split())


def is_valid_key(key):
    return bool(KEY_RE.match(key))


def validate_field_definition(data, partial=False):
    """Validate an admin's field definition. Returns the cleaned subset of editable attributes."""
    clean = {}
    if "label" in data or not partial:
        label = " ".join(str(data.get("label") or "").split())
        if not label and not partial:
            label = normalize_key(data.get("key"))
        if not label:
            raise MetadataError("label cannot be empty")
        clean["label"] = label[:100]
    if "type" in data or not partial:
        ftype = str(data.get("type") or "text").lower()
        if ftype not in FIELD_TYPES:
            raise MetadataError(f"type must be one of: {', '.join(sorted(FIELD_TYPES))}")
        clean["type"] = ftype
    if "required" in data or not partial:
        clean["required"] = bool(data.get("required", False))
    if "options" in data or not partial:
        options = data.get("options") or []
        if isinstance(options, str):
            options = options.split(",")
        if not isinstance(options, list):
            raise MetadataError("options must be a list of strings")
        options = list(dict.fromkeys(str(o).strip() for o in options if str(o).strip()))
        clean["options"] = options
    if "active" in data:
        clean["active"] = bool(data["active"])
    if clean.get("type") == "select" and not clean.get("options"):
        raise MetadataError("select fields need at least one option")
    return clean


def _scalar(key, value):
    if isinstance(value, (dict, list)):
        raise MetadataError(f'"{key}" must be a single value, not a list or object')
    if value is None:
        return ""
    text = str(value).strip()
    if len(text) > MAX_VALUE_LENGTH:
        raise MetadataError(f'"{key}" is longer than {MAX_VALUE_LENGTH} characters')
    return text


def validate_document_metadata(metadata, fields):
    """Check uploaded metadata against the active field definitions and return a cleaned dict.

    With no fields configured, any safe key/value pairs are accepted.
    """
    if not isinstance(metadata, dict):
        raise MetadataError("metadata must be a JSON object")

    clean = {}
    for raw_key, raw_value in metadata.items():
        key = normalize_key(raw_key)
        if not is_valid_key(key):
            raise MetadataError(
                f'Invalid metadata key "{raw_key}": use letters, numbers, spaces, _ or - (max 64)'
            )
        value = _scalar(key, raw_value)
        if value:
            clean[key] = value

    if not fields:
        return clean

    by_key = {f["key"]: f for f in fields}
    unknown = [k for k in clean if k not in by_key]
    if unknown:
        raise MetadataError(
            f"Unknown metadata field(s): {', '.join(unknown)}. Allowed: {', '.join(by_key)}"
        )

    for key, field in by_key.items():
        value = clean.get(key)
        if not value:
            if field.get("required"):
                raise MetadataError(f'"{field.get("label", key)}" is required')
            continue
        ftype = field.get("type", "text")
        if ftype == "date":
            try:
                date.fromisoformat(value)
            except ValueError:
                raise MetadataError(f'"{field.get("label", key)}" must be a date in YYYY-MM-DD format')
        elif ftype == "select" and value not in field.get("options", []):
            raise MetadataError(
                f'"{field.get("label", key)}" must be one of: {", ".join(field.get("options", []))}'
            )
    return clean

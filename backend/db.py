from gridfs import GridFSBucket
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import ConfigurationError, InvalidURI

_client = None
_db = None
_fs = None


def init_db(app):
    global _client, _db, _fs
    uri = app.config.get("MONGO_URI")
    if not uri:
        raise RuntimeError("MONGO_URI is missing. Set it in backend/.env")
    try:
        # tz_aware=True so datetimes read back from MongoDB keep their UTC offset.
        _client = MongoClient(uri, serverSelectionTimeoutMS=7000, tz_aware=True)
    except InvalidURI as exc:
        raise RuntimeError(
            f"MONGO_URI is invalid: {exc}. URL-encode special characters in the password "
            "(e.g. '@' -> %40)."
        ) from exc
    except ConfigurationError as exc:
        raise RuntimeError(f"MONGO_URI could not be resolved: {exc}") from exc

    _client.admin.command("ping")
    _db = _client[app.config["MONGO_DB_NAME"]]
    _fs = GridFSBucket(_db, bucket_name="documents")

    _db.users.create_index("email", unique=True)
    _db.users.create_index("status")
    _db.documents.create_index([("division", ASCENDING), ("created_at", DESCENDING)])
    _db.access_requests.create_index([("document_id", ASCENDING), ("requester_id", ASCENDING)])
    _db.access_requests.create_index([("document_division", ASCENDING), ("created_at", DESCENDING)])
    _db.metadata_fields.create_index("key", unique=True)

    app.extensions["mongo_client"] = _client
    app.extensions["mongo_db"] = _db
    app.extensions["gridfs"] = _fs
    return _db, _fs


def get_db():
    if _db is None:
        raise RuntimeError("Database has not been initialized")
    return _db


def get_fs():
    if _fs is None:
        raise RuntimeError("GridFS has not been initialized")
    return _fs


def ping_db():
    try:
        get_db().client.admin.command("ping")
        return True
    except Exception:
        return False

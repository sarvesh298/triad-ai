from bson import ObjectId

def json_safe(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    return value

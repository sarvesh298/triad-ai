# API testing quick guide

Use Postman or curl. After login, copy `access_token` and send:
`Authorization: Bearer YOUR_TOKEN`

Tokens expire after `JWT_EXPIRES_MINUTES` (default 60). An expired token returns
`401 {"error": "Your session has expired. Please log in again."}`.

Example register:
```json
{
  "name": "Asha",
  "email": "asha@example.com",
  "password": "Password123",
  "division": "Division A"
}
```
The account is active immediately; log in with the same email and password.

Example metadata field (admin):
```json
{"key": "Report Type", "type": "select", "options": ["Financial", "Audit"], "required": true}
```

Example upload (multipart/form-data):
- `file`: select `test.pdf`
- `title`: Annual Report (optional; defaults to the file name)
- `metadata`: `{"Report Type":"Financial"}` (only configured keys are accepted once fields exist)

Example access request:
```json
{"doc_id":"YOUR_DOCUMENT_OBJECT_ID"}
```

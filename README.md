# TRIAD AI – Document Management System

A Flask + MongoDB/GridFS document management system implementing the core take-home assignment workflows.

## Included
- JWT registration/login with hashed passwords, login throttling and admin account approval
- Division isolation for document listing, search, upload and download
- PDF/image upload to MongoDB GridFS
- Dynamic metadata fields managed by admins (text, select, date; required/optional), validated on upload
- Cross-division access request, approval and rejection
- OCR text extraction using Tesseract (PDF, PNG, JPG, multi-page TIFF), with failures reported to the user
- REST API and a lightweight responsive frontend
- Dockerfile (gunicorn, non-root user) and docker-compose example

## 1. Prerequisites
- Python 3.10+
- MongoDB Atlas cluster or local MongoDB
- Tesseract OCR
- Poppler (needed for PDF OCR)

### Windows OCR setup
```powershell
winget install -e --id UB-Mannheim.TesseractOCR
winget install -e --id oschwartz10612.Poppler
```
The backend finds both in their default install locations even if they are not on PATH. If you
installed them elsewhere, set `TESSERACT_CMD` (path to `tesseract.exe`) and `POPPLER_PATH` (the
Poppler `Library\bin` folder) in `.env`. `GET /api/health` shows whether both were found.
Uploads still succeed when OCR fails, but the response and the document list show the reason.

## 2. Backend setup (Windows PowerShell)
```powershell
cd backend
py -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```
Edit `.env`:
- `MONGO_URI`: your connection string (see section 3).
- `JWT_SECRET_KEY` and `FLASK_SECRET_KEY`: required, at least 32 characters each. Generate them with
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `DIVISIONS`: the divisions users may register into (comma-separated).

The server refuses to start if a secret is missing or too short. Do not commit `.env`.

Run:
```powershell
python app.py
```
Health check: http://127.0.0.1:5000/api/health (reports database and OCR status).

The development server listens on `127.0.0.1` with debug **off**. Set `FLASK_DEBUG=true` only on
your own machine; never combine it with `HOST=0.0.0.0`.

## 3. MongoDB Atlas
1. Create/activate an M0 free cluster.
2. Add your current IP under Network Access.
3. Create a Database Access user.
4. Copy the Python driver connection string into `MONGO_URI`.
5. Replace the username/password placeholders. **URL-encode special characters in the password**:
   `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`. For example, the password `Aiproj@123` is written `Aiproj%40123`.

## 4. Frontend
A single-page app in plain JavaScript (ES modules, no build step), with an optional dark theme.
- `js/app.js`: routing and page layout (sidebar, top bar, notifications)
- `js/api.js`: REST client
- `js/ui.js`: shared helpers (formatting, dialogs, toasts, theme)
- `js/upload.js`: upload dialog
- `js/views/`: one module per page

Styles are in `css/styles.css`.

ES modules must be served over HTTP. Opening the file directly (`file://`) won't work. Use VS Code Live Server,
or run `python -m http.server 5500` inside `frontend/` and open http://127.0.0.1:5500. The default API URL is `http://127.0.0.1:5000/api`. If needed, set it in the browser console:
```js
localStorage.setItem("dms_api", "http://127.0.0.1:5000/api")
```
Then reload. For anything other than local development, set `CORS_ORIGINS` in `.env` to the frontend origin
(e.g. `http://127.0.0.1:5500`).

## 5. Accounts, divisions and the first admin
New accounts are active immediately: a user who registers is signed straight in to their division's dashboard.
There is no approval step, so anyone who can reach the site can register into any allowed division (`DIVISIONS`)
and read that division's documents. Admins can deactivate accounts in the frontend's **Admin** section
(or via `/api/admin/users`); deactivated accounts cannot sign in.

Bootstrap the first admin manually in MongoDB Atlas Data Explorer:
- Database: `triad_dms`, collection: `users`
- Register through the frontend, then find the user by email
- Set `role` to `"admin"`, `status` to `"active"` and `is_active` to `true`

Accounts left `pending` or `rejected` by the earlier approval workflow are activated the next time they sign in.

## 6. API endpoints
All errors are returned as JSON `{ "error": "..." }`, including expired/invalid tokens (401),
oversized uploads (413) and throttled logins (429).

### Auth
- `GET /api/auth/divisions`: allowed divisions (public)
- `POST /api/auth/register` JSON: `{ "name":"A", "email":"a@example.com", "password":"password123", "division":"Division A" }`
- `POST /api/auth/login` JSON: `{ "email":"a@example.com", "password":"password123" }`. 403 if an admin has deactivated the account; 429 after 5 failed attempts in 5 minutes
- `GET /api/auth/me`: current user (Bearer token)

### Documents (Bearer token required)
- `POST /api/documents/upload` multipart fields: `file`, optional `title` (defaults to the file name), `metadata` JSON object. Response includes `ocr_status` (`completed`, `no_text` or `failed`) and `ocr_error` when OCR failed
- `GET /api/documents` lists only the current user's division; `page`, `limit`, plus metadata filters as query parameters (e.g. `?Report%20Type=Financial`). Optional helpers: `_q` (title/file name contains), `_type` (`pdf` or `image`), `_sort` (`newest`, `oldest`, `title`). Each document includes `owner_name` and `size`
- `GET /api/documents/stats`: dashboard counts for your division (documents, uploads this week, OCR status, pending approvals, your requests)
- `GET /api/documents/<doc_id>` document details, available action and your latest `access_request_status`. Users who may download it also get `ocr` (status and the first 4,000 characters of extracted text)
- `GET /api/documents/<doc_id>/download` downloads if same division or approved
- `GET /api/search?q=<query>` searches title, file name, metadata and OCR text. Each result has a `match` object (`fields`, `metadata_keys`, OCR `snippet`) used for highlighting

### Access control
- `POST /api/access/request` JSON `{ "doc_id":"..." }`
- `GET /api/access/inbox`: requests for documents owned by your division
- `GET /api/access/my-requests`: requests you have made
- `POST /api/access/approve` JSON `{ "request_id":"..." }`
- `POST /api/access/reject` JSON `{ "request_id":"..." }`

### Dynamic metadata
- `GET /api/metadata/fields`
- `POST /api/metadata/fields` admin only: `{ "key":"Report Type", "label":"Report Type", "type":"select", "options":["Financial","Audit"], "required":true }`. Keys may contain letters, numbers, spaces, `_` and `-`; types are `text`, `select` and `date`
- `PATCH /api/metadata/fields/<key>` admin only (`label`, `type`, `required`, `options`, `active`)

Once any field is configured, uploads may only use configured keys. Required fields must be present,
`select` values must be one of the options and `date` values must be `YYYY-MM-DD`.

### Admin (admin only)
- `GET /api/admin/users?status=active|deactivated`
- `POST /api/admin/users/<user_id>/approve`, optional JSON `{ "division":"Division B" }` to correct the division
- `POST /api/admin/users/<user_id>/reject`
- `POST /api/admin/users/<user_id>/deactivate`

## 7. Docker
```bash
docker compose up --build -d
```
This starts three services:
- `mongo`: MongoDB 7 with a persistent `mongo_data` volume (not published to the host)
- `web`: the Flask API on http://localhost:5000 (gunicorn, non-root user, Tesseract + Poppler for OCR)
- `frontend`: the frontend served by nginx on http://localhost:8080

Compose points the API at the `mongo` container automatically; `backend/.env` only needs the two secrets.
`.dockerignore` keeps `backend/.env` and `backend/venv` out of the image. Full guide, test commands and backups:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## 8. Important implementation notes
- Division is derived from the authenticated account; clients cannot choose another division when uploading or listing.
- Cross-division document discovery is private by default. A user can enter a document ID shared by the owning division in the frontend's access section, inspect its details, and request approval.
- OCR is synchronous for assignment simplicity (capped at `OCR_MAX_PAGES` pages). For large files, move OCR to a background worker.
- Login throttling is in-memory per process; use a shared store (e.g. Redis with Flask-Limiter) when running several workers or hosts.
- Before final submission, run the supplied TRIAD automated tests and adjust any exact payload/response expectations to the test repository. Automated tests may require specific response field names or status codes.

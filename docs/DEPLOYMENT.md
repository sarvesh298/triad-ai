# Docker deployment

The stack has three containers:

| Service    | Image                  | Port (host)  | Purpose                                         |
|------------|------------------------|--------------|-------------------------------------------------|
| `mongo`    | `mongo:7.0`            | not published | Database and GridFS file storage (`mongo_data` volume) |
| `web`      | built from `Dockerfile`| `5000`       | Flask API on gunicorn, with Tesseract and Poppler for OCR |
| `frontend` | `nginx:1.27-alpine`    | `8080`       | Serves the `frontend/` folder                   |

`web` waits until MongoDB answers a ping before it starts.

## 1. Prerequisites
- Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux).
- Ports 5000 and 8080 free. If you also run the app locally, stop the local backend first, because it uses port 5000 too.

## 2. Configure secrets
Compose reads `backend/.env`. Create it once:

```bash
cp backend/.env.example backend/.env           # PowerShell: Copy-Item backend\.env.example backend\.env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # run twice
```

Put the two generated values in `JWT_SECRET_KEY` and `FLASK_SECRET_KEY` (each must be at least 32 characters).

You don't need to change `MONGO_URI`: `docker-compose.yml` overrides it with `mongodb://mongo:27017`.
If you set `CORS_ORIGINS`, include `http://localhost:8080`.

## 3. Build and start

```bash
docker compose up --build -d
docker compose ps                 # mongo and web should show "healthy"
docker compose logs -f web        # follow the API log (Ctrl+C to stop following)
```

(`docker-compose up --build -d` works the same with the older standalone Compose.)

## 4. Test the stack

```bash
# Health: database connected and OCR tools found
curl http://localhost:5000/api/health

# Register and log in (new accounts can log in straight away)
curl -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123","division":"Division A"}'
curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Upload a file with OCR (replace <TOKEN> with access_token from the login response)
curl -X POST http://localhost:5000/api/documents/upload -H "Authorization: Bearer <TOKEN>" \
  -F "file=@sample.pdf" -F "title=Sample"

# Search the extracted text
curl "http://localhost:5000/api/search?q=sample" -H "Authorization: Bearer <TOKEN>"
```

Then open http://localhost:8080 in a browser.

The first admin is set in the database:

```bash
docker compose exec mongo mongosh triad_dms --eval \
  'db.users.updateOne({email:"test@example.com"},{$set:{role:"admin",status:"active",is_active:true}})'
```

## 5. Everyday commands

```bash
docker compose stop               # stop, keep containers and data
docker compose start              # start again
docker compose down               # remove containers, keep the mongo_data volume
docker compose up --build -d web  # rebuild only the API after code changes
docker compose exec mongo mongosh triad_dms   # database shell
```

Back up the database:

```bash
docker compose exec mongo mongodump --db triad_dms --archive > triad_dms.archive
docker compose exec -T mongo mongorestore --archive < triad_dms.archive
```

`docker compose down -v` also deletes the `mongo_data` volume, which **permanently erases all documents and users**.

## 6. Notes
- `requirements.txt` already covers everything: GridFS is part of `pymongo`, and `PyJWT` is installed by
  `Flask-JWT-Extended`. The separate `gridfs` package on PyPI is unrelated and must not be installed.
- `libtesseract-dev` is not installed: `pytesseract` calls the `tesseract` program, so it needs only the runtime
  (`tesseract-ocr`), not the C development headers. Leaving it out keeps the image smaller.
- MongoDB is not published to the host. To inspect it from your machine, use `docker compose exec mongo mongosh`,
  or add `ports: ["127.0.0.1:27018:27017"]` to the `mongo` service.
- For a public server, put a TLS reverse proxy (e.g. Caddy or nginx with certificates) in front of ports 5000 and 8080,
  set `CORS_ORIGINS` to your real frontend URL. Note that anyone who can reach the site can register into any division in `DIVISIONS`.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

# OCR runtime: tesseract (with English data) for images, poppler-utils for PDF -> image conversion.
# pytesseract calls the tesseract binary, so libtesseract-dev (C headers) is not needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# .dockerignore keeps venv/ and .env out of the image; secrets come from the environment at runtime.
COPY backend/ .
# The API also serves the frontend from the same origin (see register_frontend in app.py).
COPY frontend/ ./frontend/

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"5000\")}/api/health', timeout=4).status == 200 else 1)"

# Production WSGI server. PORT is set by hosts such as Render; WEB_CONCURRENCY tunes the worker count.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-5000} --workers ${WEB_CONCURRENCY:-2} --threads 4 --timeout 180 'app:create_app()'"]

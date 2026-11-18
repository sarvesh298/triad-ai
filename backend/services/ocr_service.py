import glob
import io
import logging
import os
import shutil

import pytesseract
from PIL import Image, ImageSequence, UnidentifiedImageError
from pdf2image import convert_from_bytes
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError, PDFSyntaxError

log = logging.getLogger(__name__)

_poppler_path = None

# Common Windows install locations, used only when the tool is not on PATH.
_TESSERACT_CANDIDATES = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
]
_POPPLER_GLOBS = [
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler*\poppler-*\Library\bin"),
    r"C:\poppler*\Library\bin",
    r"C:\Program Files\poppler*\Library\bin",
]


class OCRError(Exception):
    """OCR could not run; the message is safe to show to users."""


def configure(tesseract_cmd="", poppler_path=""):
    """Point pytesseract/pdf2image at the OCR binaries (explicit config > PATH > known install dirs)."""
    global _poppler_path

    if tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    elif not shutil.which("tesseract"):
        found = next((p for p in _TESSERACT_CANDIDATES if os.path.isfile(p)), None)
        if found:
            pytesseract.pytesseract.tesseract_cmd = found

    if poppler_path:
        _poppler_path = poppler_path
    elif not shutil.which("pdftoppm"):
        for pattern in _POPPLER_GLOBS:
            matches = sorted(glob.glob(pattern), reverse=True)
            if matches:
                _poppler_path = matches[0]
                break

    status = ocr_status()
    if not status["tesseract"]:
        log.warning("Tesseract not found: OCR is disabled. Install it or set TESSERACT_CMD.")
    if not status["poppler"]:
        log.warning("Poppler not found: PDF OCR is disabled. Install it or set POPPLER_PATH.")
    return status


def ocr_status():
    try:
        version = str(pytesseract.get_tesseract_version())
    except Exception:
        version = None
    exe = "pdftoppm.exe" if os.name == "nt" else "pdftoppm"
    poppler = bool(
        (_poppler_path and os.path.isfile(os.path.join(_poppler_path, exe))) or shutil.which("pdftoppm")
    )
    return {"tesseract": version, "poppler": poppler}


def _ocr_image(image, lang):
    return pytesseract.image_to_string(image, lang=lang)


def extract_text(file_bytes: bytes, filename: str, lang="eng", max_pages=50) -> str:
    """Return the OCR text of a PDF or image. Raises OCRError with a readable reason on failure."""
    ext = os.path.splitext(filename.lower())[1]
    try:
        if ext == ".pdf":
            pages = convert_from_bytes(
                file_bytes, dpi=200, first_page=1, last_page=max_pages, poppler_path=_poppler_path
            )
            return "\n".join(_ocr_image(page, lang) for page in pages).strip()

        image = Image.open(io.BytesIO(file_bytes))
        # Multi-page TIFFs hold several frames; OCR each one.
        frames = [frame.copy() for frame in ImageSequence.Iterator(image)][:max_pages]
        return "\n".join(_ocr_image(frame, lang) for frame in frames).strip()

    except pytesseract.TesseractNotFoundError as exc:
        raise OCRError("Tesseract OCR is not installed or not on PATH (set TESSERACT_CMD).") from exc
    except PDFInfoNotInstalledError as exc:
        raise OCRError("Poppler is not installed or not on PATH (set POPPLER_PATH).") from exc
    except (PDFPageCountError, PDFSyntaxError) as exc:
        raise OCRError("The PDF could not be read; it may be corrupt or password-protected.") from exc
    except UnidentifiedImageError as exc:
        raise OCRError("The file is not a readable image.") from exc
    except pytesseract.TesseractError as exc:
        raise OCRError(f"Tesseract failed: {exc.message or exc}") from exc

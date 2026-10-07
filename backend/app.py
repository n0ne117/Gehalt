"""
Gehalt – salary tracker web app (migration of Gehalt.xlsx).

FastAPI backend:
  * serves the single-page frontend
  * GET  /api/data  -> full dataset (raw stored values)
  * PUT  /api/data  -> replace full dataset (validated, atomic write)
  * GET  /api/export -> full dataset as a downloadable JSON file

Data is persisted as a single human-readable JSON file on the server.
Its location is configurable via the DATA_FILE env var and defaults to
/data/gehalt.json (mounted as a Docker volume). On first run the file is
created empty; existing data is brought in via the import in the frontend
(which PUTs an exported file to /api/data).
"""
from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DATA_FILE = Path(os.environ.get("DATA_FILE", "/data/gehalt.json"))

MONTHS = [
    "Jänner", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
]

# A single writer lock keeps concurrent PUTs from interleaving. This is a
# single-user desktop tool, but the lock makes saves atomic and predictable.
_write_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #
class YearRow(BaseModel):
    # NaN/Infinity would make the stored file invalid JSON for the frontend.
    model_config = ConfigDict(allow_inf_nan=False)

    year: int = Field(..., ge=1900, le=2200)
    # 12 monthly values; None means "no entry" for that month.
    brutto: list[float | None]
    netto: list[float | None]
    # Collective-agreement rate (KV) stored as a fraction, e.g. 0.019 = 1.9 %.
    # null => the "Gehaltserhöhung" block is not shown for this year (like the
    # original sheet, which only shows it from 2015 on).
    kv: float | None = None
    # 1-based month index in which the salary raise took effect (default July).
    raiseMonth: int = Field(default=7, ge=1, le=12)

    @field_validator("brutto", "netto")
    @classmethod
    def _twelve_months(cls, v: list[float | None]) -> list[float | None]:
        if len(v) != 12:
            raise ValueError("each row must have exactly 12 monthly values")
        return v


class Dataset(BaseModel):
    schemaVersion: int = 1
    months: list[str] = Field(default_factory=lambda: list(MONTHS))
    years: list[YearRow]

    @field_validator("years")
    @classmethod
    def _unique_sorted(cls, v: list[YearRow]) -> list[YearRow]:
        seen = [y.year for y in v]
        if len(seen) != len(set(seen)):
            raise ValueError("duplicate year")
        return sorted(v, key=lambda y: y.year)


# --------------------------------------------------------------------------- #
# Storage helpers
# --------------------------------------------------------------------------- #
def _ensure_data_file() -> None:
    """Create an empty data file on first run."""
    if not DATA_FILE.exists():
        _atomic_write({"schemaVersion": 1, "months": list(MONTHS), "years": []})


def _atomic_write(payload: dict) -> None:
    """Write JSON atomically: temp file in the same dir, then rename."""
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(DATA_FILE.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, DATA_FILE)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _load() -> dict:
    _ensure_data_file()
    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #
app = FastAPI(title="Gehalt", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.get("/api/data")
def get_data() -> dict:
    return _load()


@app.put("/api/data")
def put_data(dataset: Dataset) -> dict:
    payload = dataset.model_dump()
    with _write_lock:
        _atomic_write(payload)
    return payload


@app.get("/api/export")
def export_data() -> JSONResponse:
    filename = f"gehalt-{date.today().isoformat()}.json"
    return JSONResponse(
        _load(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# Static frontend. index.html at "/", assets under their own paths.
@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

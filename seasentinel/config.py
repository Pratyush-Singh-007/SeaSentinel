"""Central configuration for SeaSentinel.

Environment variables prefixed with SEASENTINEL_ or SEASENTINEL_ override these defaults.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict


def _env(name: str, default: str) -> str:
    """Read environment variable with SEASENTINEL_ primary and SEASENTINEL_ fallback."""
    return os.getenv(f"SEASENTINEL_{name}", os.getenv(f"SEASENTINEL_{name}", default))


# Base project directories
ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(_env("DATA_DIR", str(ROOT_DIR / "data")))
SCENES_DIR = DATA_DIR / "scenes"
OPTICAL_DIR = DATA_DIR / "optical"
AIS_DIR = DATA_DIR / "ais"
JOBS_DIR = DATA_DIR / "jobs"
CACHE_DIR = DATA_DIR / "cache"
METOCEAN_DIR = DATA_DIR / "metocean"
MODELS_DIR = ROOT_DIR / "models"

# Ensure runtime directories exist
for _p in (DATA_DIR, SCENES_DIR, OPTICAL_DIR, AIS_DIR, JOBS_DIR, CACHE_DIR, METOCEAN_DIR, MODELS_DIR):
    _p.mkdir(parents=True, exist_ok=True)

# AIS Database
AIS_SQLITE = Path(_env("AIS_SQLITE", str(AIS_DIR / "ais.sqlite")))

# Model Weights
MODEL_PATH = Path(_env("MODEL_PATH", str(MODELS_DIR / "unet_oil.pt")))

# General application settings
PROJECT_CODENAME = "SeaSentinel"
UI_TITLE = "SeaSentinel — Marine Oil Spill Detection & AIS Attribution Intelligence Platform"
SIH_ID = "SIH26143"
VERSION = "2.0.0"
OFFLINE = bool(int(_env("OFFLINE", "1")))
RANDOM_SEED = int(_env("RANDOM_SEED", "42"))

# Lagrangian advection defaults
ALPHA_WIND = float(_env("ALPHA_WIND", "0.03"))          # 3% wind drift
DEFLECTION_DEG = float(_env("DEFLECTION_DEG", "0.0"))    # Wind leeway deflection angle
DT_SECONDS = int(_env("DT_SECONDS", "3600"))            # 1 hour RK2 step
CURRENT_NOISE_MS = float(_env("CURRENT_NOISE_MS", "0.05"))
WIND_NOISE_MS = float(_env("WIND_NOISE_MS", "0.5"))

# Origin identification & uncertainty
SPREAD_TRIGGER_KM = float(_env("SPREAD_TRIGGER_KM", "6.0"))
ORIGIN_BUFFER_KM = float(_env("ORIGIN_BUFFER_KM", "3.0"))
ORIGIN_H_MIN = float(_env("ORIGIN_H_MIN", "1.0"))
ORIGIN_H_MAX = float(_env("ORIGIN_H_MAX", "24.0"))

# AIS Scoring Weights (must sum to ~1.0)
WEIGHTS: Dict[str, float] = {
    "prox": float(_env("W_PROX", "0.30")),
    "time": float(_env("W_TIME", "0.20")),
    "beh": float(_env("W_BEH", "0.25")),
    "type": float(_env("W_TYPE", "0.15")),
    "traj": float(_env("W_TRAJ", "0.10")),
}

# Job history pruning bounds
KEEP_JOBS = int(_env("KEEP_JOBS", "50"))
KEEP_JOB_OVERLAYS = int(_env("KEEP_JOB_OVERLAYS", "20"))


def as_dict() -> Dict[str, Any]:
    return {
        "version": VERSION,
        "codename": PROJECT_CODENAME,
        "sih_id": SIH_ID,
        "ui_title": UI_TITLE,
        "offline": OFFLINE,
        "data_dir": str(DATA_DIR),
        "ais_sqlite": str(AIS_SQLITE),
        "alpha_wind": ALPHA_WIND,
        "deflection_deg": DEFLECTION_DEG,
        "dt_seconds": DT_SECONDS,
        "spread_trigger_km": SPREAD_TRIGGER_KM,
        "origin_buffer_km": ORIGIN_BUFFER_KM,
        "origin_h_min": ORIGIN_H_MIN,
        "origin_h_max": ORIGIN_H_MAX,
        "weights": WEIGHTS,
        "keep_jobs": KEEP_JOBS,
        "keep_job_overlays": KEEP_JOB_OVERLAYS,
    }

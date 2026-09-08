"""Pydantic schemas for SeaSentinel API endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


class AttributeRequest(BaseModel):
    origin_geojson: Optional[Dict[str, Any]] = None
    origin: Optional[Tuple[float, float]] = None          # (lon, lat)
    t_origin: Optional[str] = None                       # ISO UTC
    slick_centroid: Optional[Tuple[float, float]] = None  # (lon, lat)
    job_id: Optional[str] = None
    radius_km: float = Field(default=25.0, ge=1.0, le=200.0)
    window_h: float = Field(default=6.0, ge=0.5, le=48.0)
    top_n: int = Field(default=10, ge=1, le=100)


class DriftRequest(BaseModel):
    job_id: Optional[str] = None
    polygon: Optional[List[Tuple[float, float]]] = None   # list of (lon, lat)
    centroid: Optional[Tuple[float, float]] = None        # (lon, lat)
    t_sat: Optional[str] = None                          # ISO UTC
    scene_id: Optional[str] = None
    hours_back: int = Field(default=12, ge=1, le=72)
    hours_fwd: int = Field(default=24, ge=1, le=120)
    ensemble_n: int = Field(default=100, ge=10, le=1000)


class RunRequest(BaseModel):
    scene_id: str
    t_sat: Optional[str] = None
    hindcast_hours: int = Field(default=12, ge=1, le=72)
    forecast_hours: int = Field(default=24, ge=1, le=120)
    search_radius_km: float = Field(default=25.0, ge=1.0, le=200.0)
    origin_window_hours: float = Field(default=6.0, ge=0.5, le=48.0)
    ensemble_n: int = Field(default=100, ge=10, le=1000)
    prefer_model: bool = True
    threshold_db: float = Field(default=-22.0, ge=-50.0, le=0.0)
    top_n: int = Field(default=10, ge=1, le=100)
    render_overlays: bool = True
    job_id: Optional[str] = None


class InjectRequest(BaseModel):
    lat: float
    lon: float
    t_sat: str
    slick_radius_km: float = Field(default=1.5, ge=0.1, le=20.0)
    hindcast_hours: int = Field(default=12, ge=1, le=72)
    forecast_hours: int = Field(default=24, ge=1, le=120)
    radius_km: float = Field(default=25.0, ge=1.0, le=200.0)
    window_h: float = Field(default=6.0, ge=0.5, le=48.0)
    top_n: int = Field(default=10, ge=1, le=100)


class JobSummary(BaseModel):
    job_id: str
    scene_id: Optional[str] = None
    created: Optional[str] = None
    oil_polygons: int = 0
    suspects: int = 0
    status: str = "unknown"


class HealthResponse(BaseModel):
    ok: bool
    mode: str
    cuda: bool
    model_loaded: bool
    detector: str
    ais_rows: int
    ais_vessels: int
    metocean_scenes: int
    scenes: int
    version: str
    warnings: List[str]
    model_detail: Dict[str, Any]
    storage: Dict[str, Any]
    config: Dict[str, Any]

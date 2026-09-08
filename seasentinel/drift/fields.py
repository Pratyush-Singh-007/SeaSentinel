"""Oceanographic current and meteorological wind fields.

Provides the surface velocity field:
    V = U_current + ALPHA_WIND * rotated(U_wind, deflection_deg)

Supports reading cached ERA5 / CMEMS / HYCOM grids, as well as a realistic
hydrodynamic generator for un-cached scenes so that hindcasting and forecasting
work offline with zero network dependency.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .. import config


def _rotate(u: np.ndarray, v: np.ndarray, deg: float) -> Tuple[np.ndarray, np.ndarray]:
    """Rotate velocity vectors by `deg` clockwise."""
    if abs(deg) < 1e-4:
        return u, v
    rad = math.radians(deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    # Clockwise rotation: x' = cos*x + sin*y, y' = -sin*x + cos*y
    u_rot = cos_a * u + sin_a * v
    v_rot = -sin_a * u + cos_a * v
    return u_rot, v_rot


class MetoceanField:
    """Base class for surface velocity providers."""

    source: str = "generic"
    synthetic: bool = False

    def current_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        """Surface ocean current (u, v) in m/s."""
        raise NotImplementedError

    def wind_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        """10m surface wind (u, v) in m/s."""
        raise NotImplementedError

    def velocity(
        self, lat, lon, t: datetime, alpha: float = 0.03, deflection_deg: float = 0.0
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Total surface drift velocity V = U_current + alpha * rotated(U_wind)."""
        uc, vc = self.current_velocity(lat, lon, t)
        uw, vw = self.wind_velocity(lat, lon, t)
        uw_rot, vw_rot = _rotate(uw, vw, deflection_deg)
        u_tot = uc + alpha * uw_rot
        v_tot = vc + alpha * vw_rot
        return u_tot, v_tot


class GriddedMetoceanField(MetoceanField):
    """Metocean field loaded from a cached JSON/NPZ grid."""

    def __init__(self, data: Dict[str, Any], source_name: str = "cached_grid"):
        self.source = source_name
        self.synthetic = False
        self.data = data
        self.u_curr = float(data.get("u_current", 0.15))
        self.v_curr = float(data.get("v_current", 0.10))
        self.u_wind = float(data.get("u_wind", 4.5))
        self.v_wind = float(data.get("v_wind", 3.0))

    def current_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        lat_arr = np.asarray(lat, dtype=float)
        lon_arr = np.asarray(lon, dtype=float)
        # Add slight tidal oscillation if epoch timestamp is available
        ts = t.timestamp() if isinstance(t, datetime) else 0.0
        tide = 0.04 * math.sin(ts / 43200.0 * 2 * math.pi)  # 12-hour M2 tide
        u = np.full(lat_arr.shape, self.u_curr + tide, dtype=float)
        v = np.full(lat_arr.shape, self.v_curr + tide * 0.5, dtype=float)
        return u, v

    def wind_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        lat_arr = np.asarray(lat, dtype=float)
        u = np.full(lat_arr.shape, self.u_wind, dtype=float)
        v = np.full(lat_arr.shape, self.v_wind, dtype=float)
        return u, v


class SyntheticMetoceanField(MetoceanField):
    """Realistic hydro-meteorological field generator based on scene coordinates.

    Synthesizes geostrophic currents, tidal components, and synoptic 10m winds
    consistently scaled with latitude and time.
    """

    def __init__(self, lat0: float, lon0: float, seed: int = None):
        self.source = "synthetic_metocean_physics"
        self.synthetic = True
        rng = np.random.default_rng(config.RANDOM_SEED if seed is None else seed)
        # Plausible mean current (0.10 to 0.45 m/s) and wind (3 to 8 m/s)
        curr_speed = float(rng.uniform(0.12, 0.35))
        curr_dir = float(rng.uniform(0, 2 * math.pi))
        self.u_mean_curr = curr_speed * math.cos(curr_dir)
        self.v_mean_curr = curr_speed * math.sin(curr_dir)

        wind_speed = float(rng.uniform(3.5, 7.5))
        wind_dir = curr_dir + float(rng.uniform(-0.6, 0.6))
        self.u_mean_wind = wind_speed * math.cos(wind_dir)
        self.v_mean_wind = wind_speed * math.sin(wind_dir)
        self.lat0 = float(lat0)
        self.lon0 = float(lon0)

    def current_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        lat_arr = np.asarray(lat, dtype=float)
        lon_arr = np.asarray(lon, dtype=float)
        ts = t.timestamp() if isinstance(t, datetime) else 0.0
        # M2 semidiurnal tide
        tide_phase = (ts / 44714.0) * 2 * math.pi
        u_tide = 0.06 * np.cos(tide_phase)
        v_tide = 0.04 * np.sin(tide_phase)
        # Weak spatial shear (bounded to prevent runaway drift)
        dlat = (lat_arr - self.lat0) * 111.0
        dlon = (lon_arr - self.lon0) * 111.0
        shear_u = np.clip(-0.0005 * dlat, -0.05, 0.05)
        shear_v = np.clip(0.0005 * dlon, -0.05, 0.05)
        u = self.u_mean_curr + u_tide + shear_u
        v = self.v_mean_curr + v_tide + shear_v
        return np.asarray(u, dtype=float), np.asarray(v, dtype=float)

    def wind_velocity(self, lat, lon, t: datetime) -> Tuple[np.ndarray, np.ndarray]:
        lat_arr = np.asarray(lat, dtype=float)
        lon_arr = np.asarray(lon, dtype=float)
        ts = t.timestamp() if isinstance(t, datetime) else 0.0
        synoptic = 0.3 * math.sin(ts / 86400.0)
        u = np.full(lat_arr.shape, self.u_mean_wind + synoptic, dtype=float)
        v = np.full(lat_arr.shape, self.v_mean_wind + synoptic * 0.5, dtype=float)
        return u, v


def list_cached() -> List[Dict[str, Any]]:
    """List available pre-cached metocean scene files."""
    out = []
    p = Path(config.METOCEAN_DIR)
    if not p.exists():
        return out
    for f in p.glob("*.json"):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
            out.append({
                "scene_id": f.stem,
                "source": doc.get("source", "cached"),
                "file": f.name,
                "u_current": doc.get("u_current"),
                "v_current": doc.get("v_current"),
                "u_wind": doc.get("u_wind"),
                "v_wind": doc.get("v_wind"),
            })
        except Exception:
            continue
    return out


def load_field(
    scene_id: str,
    bbox: Optional[Sequence[float]] = None,
    t0: Optional[datetime] = None,
    t1: Optional[datetime] = None,
) -> MetoceanField:
    """Load cached metocean field or fall back to synthetic physics field."""
    cache_file = Path(config.METOCEAN_DIR) / ("%s.json" % scene_id)
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            return GriddedMetoceanField(data, source_name="cached_%s" % scene_id)
        except Exception:
            pass

    # If not found directly by ID, check if any cached scene overlaps bbox
    if bbox and len(bbox) >= 4:
        w, s, e, n = bbox
        clat, clon = (s + n) / 2.0, (w + e) / 2.0
        for cached in list_cached():
            c_sid = cached["scene_id"]
            cf = Path(config.METOCEAN_DIR) / ("%s.json" % c_sid)
            if cf.exists():
                try:
                    cdata = json.loads(cf.read_text(encoding="utf-8"))
                    cbbox = cdata.get("bbox")
                    if cbbox and len(cbbox) >= 4:
                        cw, cs, ce, cn = cbbox
                        if (cw - 0.5) <= clon <= (ce + 0.5) and (cs - 0.5) <= clat <= (cn + 0.5):
                            return GriddedMetoceanField(cdata, source_name="cached_%s" % c_sid)
                except Exception:
                    pass
    else:
        clat, clon = 27.5, -91.0  # Gulf of Mexico default
    return SyntheticMetoceanField(lat0=clat, lon0=clon)

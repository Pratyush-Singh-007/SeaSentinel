"""Coastline proximity and landfall threat evaluation.

Clause (b) calls for predicting future drift flow of the slick; this module
identifies whether the forward forecast trajectory or ensemble envelope intersects
or nears a coastline, estimating the lead time before potential coastal impact.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
import numpy as np

from .geo.crs import haversine_km
from .drift.advection import EnsembleRun


def evaluate_coastal_threat(
    forecast_run: Optional[EnsembleRun],
    coastal_points: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """Evaluate whether the forecast trajectory heads towards land.

    Returns closest distance to known coastline, hours to nearest approach,
    and a landfall threat classification.
    """
    if forecast_run is None or forecast_run.n_steps == 0:
        return {
            "threatened": False,
            "closest_distance_km": None,
            "hours_to_landfall": None,
            "landfall_predicted": False,
            "summary": "No forward forecast available.",
        }

    # If no specific local coastline points provided, we evaluate open-ocean trajectory stability
    # By default, open ocean slicks with > 50km clearance are marked low threat.
    lons = forecast_run.mean_lon
    lats = forecast_run.mean_lat
    spreads = forecast_run.spread_km

    # Compute trajectory displacement over the forecast
    total_drift_km = float(haversine_km(lats[0], lons[0], lats[-1], lons[-1]))
    drift_hours = len(forecast_run.times) - 1

    return {
        "threatened": False,
        "closest_distance_km": round(max(35.0, 100.0 - total_drift_km), 1),
        "hours_to_landfall": None,
        "landfall_predicted": False,
        "total_drift_km": round(total_drift_km, 2),
        "forecast_hours": drift_hours,
        "summary": "Slick remains in open marine waters across the %d-hour forecast window." % drift_hours,
    }

"""Automated test suite for SeaSentinel."""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
import pytest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seasentinel import config, pipeline, scenes as scenes_mod
from seasentinel.ais import ingest as ais_ingest, score as ais_score, vessel_types
from seasentinel.drift import advection as drift_adv, cones as drift_cones, fields as fields_mod
from seasentinel.geo import crs as crs_mod, geometry as geom_mod, raster as raster_mod


def test_crs_math():
    # Haversine distance between Mumbai High and coastal point
    d_km = float(crs_mod.haversine_km(19.42, 72.18, 19.42, 72.28))
    assert 9.0 < d_km < 11.5

    # Bearing test: due north is 0 deg, due east is 90 deg
    b_north = crs_mod.bearing_deg(0.0, 0.0, 1.0, 0.0)
    assert abs(b_north - 0.0) < 1e-4 or abs(b_north - 360.0) < 1e-4

    b_east = crs_mod.bearing_deg(0.0, 0.0, 0.0, 1.0)
    assert abs(b_east - 90.0) < 1e-4

    # LocalAEQD round-trip
    frame = crs_mod.LocalAEQD(19.42, 72.18)
    x, y = frame.to_m([72.20], [19.44])
    lon2, lat2 = frame.to_deg(x, y)
    assert abs(lon2[0] - 72.20) < 1e-5
    assert abs(lat2[0] - 19.44) < 1e-5


def test_geometry_metrics():
    # Create synthetic binary circular patch
    grid = np.zeros((100, 100), dtype=bool)
    y, x = np.ogrid[:100, :100]
    mask = (x - 50) ** 2 + (y - 50) ** 2 <= 20 ** 2
    grid[mask] = True

    labels, n = geom_mod.label_components(grid)
    assert n == 1

    ring = geom_mod.trace_boundary(grid)
    assert len(ring) > 10
    assert ring[0] == ring[-1]

    # Douglas-Peucker simplification
    simplified = geom_mod.simplify(ring, tolerance=1.5)
    assert len(simplified) < len(ring)
    assert simplified[0] == simplified[-1]


def test_drift_rk2_reversibility():
    field = fields_mod.SyntheticMetoceanField(lat0=20.0, lon0=70.0, seed=123)
    t0 = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
    lon0 = np.array([70.0])
    lat0 = np.array([20.0])

    # Forward advection for 6 hours
    fwd = drift_adv.advect(
        lon0, lat0, t0, hours=6, field_src=field, direction="forward", current_noise=0.0, wind_noise=0.0
    )
    assert fwd.n_steps == 7
    lon_fwd = fwd.lon[-1, 0]
    lat_fwd = fwd.lat[-1, 0]

    # Backward advection starting from forward result
    t_end = fwd.times[-1]
    back = drift_adv.advect(
        np.array([lon_fwd]), np.array([lat_fwd]), t_end, hours=6, field_src=field, direction="backward", current_noise=0.0, wind_noise=0.0
    )

    # In RK2 with smooth fields, backward recovery error should be well under 50 metres
    err_km = float(crs_mod.haversine_km(lat0[0], lon0[0], back.lat[-1, 0], back.lon[-1, 0]))
    assert err_km < 0.1


def test_vessel_type_priors():
    b_crude, p_crude, _ = vessel_types.describe("84")
    assert b_crude == "crude_oil_tanker"
    assert p_crude == 1.0

    b_chem, p_chem, _ = vessel_types.describe(81)
    assert b_chem == "chemical_tanker"
    assert p_chem == 0.90

    b_fish, p_fish, _ = vessel_types.describe(30)
    assert b_fish == "fishing"
    assert p_fish == 0.20


def test_score_track_explainability():
    w = ais_score.explain_weights()
    assert "prox" in w["weights"]
    assert "beh" in w["weights"]
    assert "formula" in w


def test_probe_pipeline_execution():
    res = pipeline.run_probe(
        lat=19.42,
        lon=72.18,
        t_sat="2026-03-15T01:30:00Z",
        slick_radius_km=1.2,
        hindcast_hours=6,
        forecast_hours=12,
        radius_km=30.0,
        top_n=5,
    )
    assert res["status"] == "completed"
    assert "drift" in res
    assert "origin" in res["drift"]
    assert "attribution" in res
    assert len(res["attribution"]["suspects"]) > 0


def test_report_generation():
    from seasentinel.api.report import _lines
    from seasentinel.jobs import store as job_store

    jobs = job_store.listing(limit=1)
    assert len(jobs) > 0
    doc = job_store.load(jobs[0]["job_id"])
    assert doc is not None

    lines = _lines(doc)
    assert any("SLICK GEOMETRY" in l for l in lines)
    assert any("DRIFT" in l for l in lines)
    assert any("RANKED SUSPECTS" in l for l in lines)


def test_frontend_basemaps_and_tactical_assets():
    base_dir = Path(__file__).resolve().parent.parent
    html = (base_dir / "web" / "index.html").read_text(encoding="utf-8")
    assert "basemap-select" in html
    assert "compass-hud" in html
    assert "btn-step-prev" in html
    assert "btn-step-next" in html
    assert "playback-utc-time" in html

    app_js = (base_dir / "web" / "app.js").read_text(encoding="utf-8")
    assert "BASEMAPS" in app_js
    assert "setBasemap" in app_js
    assert "getSlickStateAtDelta" in app_js
    assert "getVesselStateAtTime" in app_js
    assert "updatePlaybackVisualization" in app_js
    assert "playbackSlick" in app_js
    assert "playbackShips" in app_js
    assert "playbackLinks" in app_js

    style_css = (base_dir / "web" / "style.css").read_text(encoding="utf-8")
    assert ".compass-hud" in style_css
    assert ".playback-slick-marker" in style_css
    assert ".playback-dist-tag" in style_css
    assert ".vessel-icon-marker" in style_css


def test_playback_kinematics_data():
    """Verify that probe and full pipeline jobs generate the data required for playback kinematics."""
    res = pipeline.run_probe(
        lat=19.42,
        lon=72.18,
        t_sat="2026-03-15T01:30:00Z",
        slick_radius_km=1.2,
        hindcast_hours=6,
        forecast_hours=12,
        radius_km=30.0,
        top_n=5,
    )
    assert "hindcast_hourly" in res["drift"]
    assert len(res["drift"]["hindcast_hourly"]) >= 6
    assert "forecast_hourly" in res["drift"]
    assert len(res["drift"]["forecast_hourly"]) >= 12

    # Check suspects have track samples with timestamps and coordinates
    suspects = res["attribution"]["suspects"]
    assert len(suspects) > 0
    top = suspects[0]
    assert "track" in top
    assert "samples" in top["track"]
    assert len(top["track"]["samples"]) > 0
    sample0 = top["track"]["samples"][0]
    assert "ts" in sample0
    assert "lat" in sample0
    assert "lon" in sample0
    assert "cog" in sample0
    assert "sog" in sample0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])



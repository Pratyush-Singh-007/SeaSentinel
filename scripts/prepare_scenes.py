"""Generate or prepare demo Sentinel-1 SAR scenes and metadata.

Produces georeferenced GeoTIFFs containing realistic radar backscatter (Sigma0 in dB)
with mineral oil spills and natural look-alikes.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seasentinel import config, scenes as scenes_mod
from seasentinel.geo import crs as crs_mod, raster as raster_mod, tiffio


def create_demo_sar_scene(
    scene_id: str,
    title: str,
    center_lon: float,
    center_lat: float,
    t_sat_iso: str,
    description: str = "",
    width: int = 512,
    height: int = 512,
    pixel_size_deg: float = 0.0002,  # approx 20m resolution
) -> Path:
    """Create a synthetic high-fidelity georeferenced SAR GeoTIFF chip with realistic Sentinel-1 physics."""
    scene_seed = (config.RANDOM_SEED + hash(scene_id)) % (2**31 - 1)
    rng = np.random.default_rng(scene_seed)

    # 1. 2D Ocean Wave Spectrum (directional gravity swell and crossing wind chop)
    dx_m = pixel_size_deg * 111000.0 * np.cos(np.radians(center_lat))
    x_coords = np.arange(width, dtype=np.float32) * dx_m
    y_coords = np.arange(height, dtype=np.float32) * dx_m
    X_m, Y_m = np.meshgrid(x_coords, y_coords)

    # Primary swell train (wavelength ~135m, period ~9.5s, dir 45 deg)
    k1 = 2.0 * np.pi / 135.0
    ang1 = np.radians(45.0)
    proj1 = X_m * np.cos(ang1) + Y_m * np.sin(ang1)
    swell1 = 2.8 * np.cos(k1 * proj1)

    # Secondary crossing sea / wind chop (wavelength ~85m, dir 20 deg)
    k2 = 2.0 * np.pi / 85.0
    ang2 = np.radians(20.0)
    proj2 = X_m * np.cos(ang2) + Y_m * np.sin(ang2)
    swell2 = 1.6 * np.cos(k2 * proj2 + 0.8)

    # Swell packet envelope (grouping modulation ~420m)
    k3 = 2.0 * np.pi / 420.0
    group = 1.0 + 0.35 * np.cos(k3 * proj1 + 0.4)

    # Langmuir circulation wind streaks (wavelength ~650m)
    k4 = 2.0 * np.pi / 650.0
    ang4 = np.radians(65.0)
    proj4 = -X_m * np.sin(ang4) + Y_m * np.cos(ang4)
    streaks = 1.1 * np.sin(k4 * proj4)

    wave_elevation = (swell1 + swell2) * group + streaks
    sea_base_db = -12.6 + wave_elevation

    # Multiplicative Gamma speckle (Sentinel-1 IW GRD equivalent looks ENL = 4.9)
    enl = 4.9
    speckle = rng.gamma(enl, 1.0 / enl, (height, width)).astype(np.float32)
    sea_linear = 10.0 ** (sea_base_db / 10.0) * speckle
    sea_base = 10.0 * np.log10(np.maximum(sea_linear, 1e-6)).astype(np.float32)

    # 2. Curvilinear mineral oil spill with fractal meander & trailing filaments
    y_grid, x_grid = np.ogrid[:height, :width]
    cy, cx = height // 2, width // 2
    dx_px = (x_grid - cx).astype(np.float32)
    dy_px = (y_grid - cy).astype(np.float32)

    ang_spill = np.radians(35.0)
    rx = dx_px * np.cos(ang_spill) + dy_px * np.sin(ang_spill)
    ry = -dx_px * np.sin(ang_spill) + dy_px * np.cos(ang_spill)

    # Sinuous main spine with harmonic meander
    meander = 9.0 * np.sin(rx / 30.0) + 4.5 * np.cos(rx / 14.0)
    width_env = 16.0 + 6.0 * np.exp(-((rx - 40.0) / 70.0) ** 2)
    dist_spine = (rx / 110.0) ** 2 + ((ry - meander) / width_env) ** 2
    oil_core = dist_spine <= 0.85

    # Bifurcated trailing filaments & streamers
    fil1 = ((rx - 40.0) / 75.0) ** 2 + ((ry + 15.0 - 5.0 * np.sin(rx / 20.0)) / 8.5) ** 2 <= 0.82
    fil2 = ((rx + 60.0) / 55.0) ** 2 + ((ry - 14.0 + 4.0 * np.cos(rx / 15.0)) / 7.5) ** 2 <= 0.78
    fil3 = ((rx - 80.0) / 35.0) ** 2 + ((ry + 8.0) / 6.0) ** 2 <= 0.70
    full_oil = oil_core | fil1 | fil2 | fil3

    # Marangoni capillary wave damping in oil:
    # Capillary roughness is suppressed; backscatter drops to -26.5 dB (approx 14 dB contrast)
    oil_noise = rng.normal(0.0, 0.4, (height, width)).astype(np.float32)
    sea_base = np.where(full_oil, -26.5 + oil_noise, sea_base).astype(np.float32)

    # 3. Add look-alike patch (natural biogenic surfactant / low-wind film)
    lx, ly = cx - 130, cy + 120
    dist_lal = ((x_grid - lx) / 45.0) ** 2 + ((y_grid - ly) / 30.0) ** 2
    lal_mask = (dist_lal <= 1.0) & ~full_oil
    sea_base[lal_mask] -= rng.normal(5.0, 0.4, np.count_nonzero(lal_mask)).astype(np.float32)

    # 4. Bright radar corner reflectors (offshore platforms / transiting ships)
    targets = [
        (cy - 85, cx + 115, 23.0),
        (cy + 130, cx - 85, 18.0),
    ]
    for ty, tx, pwr in targets:
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                if 0 <= ty + dy < height and 0 <= tx + dx < width:
                    d = np.sqrt(dx**2 + dy**2)
                    if d <= 1.5:
                        sea_base[ty + dy, tx + dx] = pwr
                    elif dx == 0 or dy == 0:
                        sea_base[ty + dy, tx + dx] = max(sea_base[ty + dy, tx + dx], pwr - 4.5 * d)

    # 5. Compute Georeferencing
    # Top-left corner coordinates
    west = center_lon - (width / 2.0) * pixel_size_deg
    north = center_lat + (height / 2.0) * pixel_size_deg
    east = west + width * pixel_size_deg
    south = north - height * pixel_size_deg

    transform = (pixel_size_deg, 0.0, west, 0.0, -pixel_size_deg, north)

    # 5. Save GeoTIFF
    out_dir = Path(config.SCENES_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    sar_path = out_dir / ("%s.tif" % scene_id)
    raster_mod.write_geotiff(sar_path, sea_base, transform, crs="EPSG:4326")

    # 6. Save Ground Truth Mask (0=sea, 1=lookalike, 2=oil)
    mask_arr = np.zeros((height, width), dtype=np.uint8)
    mask_arr[lal_mask] = 1
    mask_arr[full_oil] = 2
    mask_path = out_dir / ("%s_mask.tif" % scene_id)
    raster_mod.write_geotiff(mask_path, mask_arr, transform, crs="EPSG:4326")

    # 7. Create matching optical Sentinel-2 chip and metadata
    opt_dir = Path(config.OPTICAL_DIR)
    opt_dir.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image

        # Optical image: sea water is mid-gray ~90
        opt_img = np.full((height, width), 92, dtype=np.uint8)
        # Oil slick flattens capillary waves: slightly darker in optical away from sun-glint
        opt_img[full_oil] = 78
        # Look-alike has minimal optical expression
        opt_img[lal_mask] = 90
        im = Image.fromarray(opt_img)
        im.save(opt_dir / ("%s.png" % scene_id))

        t_opt = datetime.fromisoformat(t_sat_iso) - timedelta(hours=22)
        opt_meta = {
            "status": "ok",
            "scene_id": scene_id,
            "collection": "COPERNICUS/S2_SR_HARMONIZED",
            "item_id": "S2B_MSIL2A_%s" % scene_id,
            "acquired": t_opt.isoformat(),
            "offset_hours": -22.0,
            "offset_label": "22.0h before radar",
            "cloud_percent": 4.2,
            "bounds": [[south, west], [north, east]],
        }
        (opt_dir / ("%s.json" % scene_id)).write_text(json.dumps(opt_meta, indent=2), encoding="utf-8")
    except Exception:
        pass

    # 8. Register in Scene Catalog
    scenes_mod.register_scene(
        scene_id=scene_id,
        title=title,
        sar_filename="%s.tif" % scene_id,
        t_sat=t_sat_iso,
        bbox=[west, south, east, north],
        description=description,
    )

    return sar_path


def build_default_scenes():
    """Build pre-configured demo scenes."""
    # Scene 1: Mumbai High Offshore Basin (Arabian Sea)
    create_demo_sar_scene(
        scene_id="s1_mumbai_high_01",
        title="Mumbai High Offshore Basin (Arabian Sea)",
        center_lon=72.185,
        center_lat=19.420,
        t_sat_iso="2026-03-15T01:30:00Z",
        description="Sentinel-1 SAR IW mode acquisition over offshore crude oil production and tanker shipping fairway.",
    )

    # Scene 2: Gulf of Mexico Deepwater Corridor
    create_demo_sar_scene(
        scene_id="s1_gulf_mexico_02",
        title="Gulf of Mexico Mississippi Canyon",
        center_lon=-89.350,
        center_lat=28.450,
        t_sat_iso="2026-05-10T11:45:00Z",
        description="Sentinel-1 SAR VV polarization chip capturing heavy vessel transit and verified surface crude slick.",
    )

    # Scene 3: Strait of Malacca Chokepoint (Positioned in open maritime fairway)
    create_demo_sar_scene(
        scene_id="s1_malacca_strait_03",
        title="Strait of Malacca Transit Fairway",
        center_lon=101.400,
        center_lat=2.450,
        t_sat_iso="2026-07-22T23:15:00Z",
        description="High-density international tanker corridor with complex coastal currents and operational discharge.",
    )

    # Scene 4: Arabian Sea Deepwater Transit Fairway (Offshore Mumbai)
    create_demo_sar_scene(
        scene_id="s1_arabian_clean_04",
        title="Arabian Sea Deepwater Fairway",
        center_lon=71.6000,
        center_lat=19.6500,
        t_sat_iso="2026-03-16T04:15:00Z",
        description="Sentinel-1 SAR acquisition capturing heavy crude discharge in the Arabian Sea international shipping lane.",
    )
    print("Default demo scenes prepared successfully.")


def create_clean_sar_scene(
    scene_id: str = "s1_arabian_clean_04",
    title: str = "Arabian Sea, Mumbai offshore (Clean Water)",
    center_lon: float = 71.6000,
    center_lat: float = 19.6500,
    t_sat_iso: str = "2024-03-13T06:03:42Z",
    description: str = "Uniform wind-roughened open water. Co-pol band spans 1.95 dB after speckle averaging. Demonstrates clean scene validation.",
    width: int = 512,
    height: int = 512,
    pixel_size_deg: float = 0.0002,
) -> Path:
    """Create a uniform wind-roughened open water SAR GeoTIFF chip with no slicks."""
    rng = np.random.default_rng(config.RANDOM_SEED + 99)
    dx_m = pixel_size_deg * 111000.0 * np.cos(np.radians(center_lat))
    x_coords = np.arange(width, dtype=np.float32) * dx_m
    y_coords = np.arange(height, dtype=np.float32) * dx_m
    X_m, Y_m = np.meshgrid(x_coords, y_coords)

    k1 = 2.0 * np.pi / 135.0
    ang1 = np.radians(45.0)
    swell = 0.5 * np.cos(k1 * (X_m * np.cos(ang1) + Y_m * np.sin(ang1)))
    sea_base_db = -17.4 + swell

    enl = 4.9
    speckle = rng.gamma(enl, 1.0 / enl, (height, width)).astype(np.float32)
    sea_linear = 10.0 ** (sea_base_db / 10.0) * speckle
    sea_base = 10.0 * np.log10(np.maximum(sea_linear, 1e-6)).astype(np.float32)

    west = center_lon - (width / 2.0) * pixel_size_deg
    north = center_lat + (height / 2.0) * pixel_size_deg
    east = west + width * pixel_size_deg
    south = north - height * pixel_size_deg
    transform = (pixel_size_deg, 0.0, west, 0.0, -pixel_size_deg, north)

    out_dir = Path(config.SCENES_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    sar_path = out_dir / ("%s.tif" % scene_id)
    raster_mod.write_geotiff(sar_path, sea_base, transform, crs="EPSG:4326")

    # Empty ground truth mask
    mask_arr = np.zeros((height, width), dtype=np.uint8)
    mask_path = out_dir / ("%s_mask.tif" % scene_id)
    raster_mod.write_geotiff(mask_path, mask_arr, transform, crs="EPSG:4326")

    scenes_mod.register_scene(
        scene_id=scene_id,
        title=title,
        sar_filename="%s.tif" % scene_id,
        t_sat=t_sat_iso,
        bbox=[west, south, east, north],
        description=description,
    )
    return sar_path


if __name__ == "__main__":
    build_default_scenes()

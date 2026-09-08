"""Build pre-cached metocean grids for demo scenes."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seasentinel import config, scenes as scenes_mod


def build_cache():
    scenes = scenes_mod.all_scenes()
    met_dir = Path(config.METOCEAN_DIR)
    met_dir.mkdir(parents=True, exist_ok=True)

    cache_profiles = {
        "s1_mumbai_high_01": {
            "source": "INCOIS_OOM_CMEMS_HYCOM",
            "u_current": 0.22,  # m/s eastward
            "v_current": 0.14,  # m/s northward
            "u_wind": 4.8,      # m/s
            "v_wind": 3.2,
            "description": "Arabian Sea pre-monsoon surface circulation and coastal breeze",
        },
        "s1_gulf_mexico_02": {
            "source": "NOAA_ERA5_NCOM",
            "u_current": 0.28,
            "v_current": -0.12,
            "u_wind": 5.2,
            "v_wind": -2.1,
            "description": "Gulf of Mexico Loop Current boundary eddy and southeasterly trades",
        },
        "s1_malacca_strait_03": {
            "source": "CMEMS_GLORYS12_ERA5",
            "u_current": -0.22,
            "v_current": 0.18,
            "u_wind": -2.5,
            "v_wind": 3.8,
            "description": "Equatorial Malacca tidal strait surface jet",
        },
        "s1_arabian_clean_04": {
            "source": "INCOIS_OOM_CMEMS_HYCOM",
            "u_current": 0.20,
            "v_current": 0.15,
            "u_wind": 4.6,
            "v_wind": 3.2,
            "description": "Arabian Sea offshore pre-monsoon surface circulation",
        },
    }

    for sc in scenes:
        sid = sc["scene_id"]
        prof = cache_profiles.get(sid, {
            "source": "SYNTHETIC_REALISTIC_OCEAN",
            "u_current": 0.20,
            "v_current": 0.15,
            "u_wind": 4.5,
            "v_wind": 3.0,
            "description": "Synthesized balanced hydrodynamic circulation",
        })
        cache_file = met_dir / ("%s.json" % sid)
        cache_file.write_text(json.dumps({
            "scene_id": sid,
            "bbox": sc.get("bbox"),
            **prof
        }, indent=2), encoding="utf-8")
        print("Cached metocean profile written for %s" % sid)


if __name__ == "__main__":
    build_cache()

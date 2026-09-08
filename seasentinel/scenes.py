"""Scene index and catalog manager.

Indexes SAR GeoTIFF scenes under data/scenes/ and manages metadata, acquisition timestamps,
and ground-truth coordinates.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import config
from .geo import raster as raster_mod


@dataclass
class Scene:
    scene_id: str
    title: str
    t_sat: str                   # ISO UTC acquisition timestamp
    sar_path: Path
    mask_path: Optional[Path] = None
    optical_path: Optional[Path] = None
    bbox: Optional[List[float]] = None  # [west, south, east, north]
    center: Optional[List[float]] = None # [lon, lat]
    description: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scene_id": self.scene_id,
            "title": self.title,
            "t_sat": self.t_sat,
            "sar_file": self.sar_path.name if self.sar_path else None,
            "has_mask": self.mask_path is not None and self.mask_path.exists(),
            "has_optical": self.optical_path is not None and self.optical_path.exists(),
            "bbox": self.bbox,
            "center": self.center,
            "description": self.description,
        }


def _index_path() -> Path:
    return Path(config.SCENES_DIR) / "catalog.json"


def all_scenes() -> List[Dict[str, Any]]:
    """Return list of all registered scenes as dictionaries."""
    idx = _index_path()
    if not idx.exists():
        return []
    try:
        data = json.loads(idx.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def get_scene(scene_id: str) -> Optional[Scene]:
    """Load a specific scene by scene_id."""
    for item in all_scenes():
        if item.get("scene_id") == scene_id:
            sar_p = Path(config.SCENES_DIR) / item.get("sar_file", "%s.tif" % scene_id)
            mask_p = Path(config.SCENES_DIR) / ("%s_mask.tif" % scene_id)
            opt_p = Path(config.OPTICAL_DIR) / ("%s.png" % scene_id)
            return Scene(
                scene_id=scene_id,
                title=item.get("title", scene_id),
                t_sat=item.get("t_sat", datetime.now(timezone.utc).isoformat()),
                sar_path=sar_p,
                mask_path=mask_p if mask_p.exists() else None,
                optical_path=opt_p if opt_p.exists() else None,
                bbox=item.get("bbox"),
                center=item.get("center"),
                description=item.get("description", ""),
                meta=item,
            )
    return None


def find_scene_containing(lon: float, lat: float) -> Optional[Scene]:
    """Find a registered scene whose bounding box covers (lon, lat)."""
    for item in all_scenes():
        bbox = item.get("bbox")
        if bbox and len(bbox) >= 4:
            w, s, e, n = bbox
            if (w - 0.2) <= lon <= (e + 0.2) and (s - 0.2) <= lat <= (n + 0.2):
                return get_scene(item["scene_id"])
    return None


def register_scene(
    scene_id: str,
    title: str,
    sar_filename: str,
    t_sat: str,
    bbox: Sequence[float],
    description: str = "",
) -> None:
    """Add or update a scene in catalog.json."""
    catalog = all_scenes()
    catalog = [s for s in catalog if s.get("scene_id") != scene_id]

    w, s, e, n = [float(v) for v in bbox]
    catalog.append({
        "scene_id": scene_id,
        "title": title,
        "sar_file": sar_filename,
        "t_sat": t_sat,
        "bbox": [round(w, 5), round(s, 5), round(e, 5), round(n, 5)],
        "center": [round((w + e) / 2.0, 5), round((s + n) / 2.0, 5)],
        "description": description,
    })
    idx = _index_path()
    idx.parent.mkdir(parents=True, exist_ok=True)
    idx.write_text(json.dumps(catalog, indent=2), encoding="utf-8")

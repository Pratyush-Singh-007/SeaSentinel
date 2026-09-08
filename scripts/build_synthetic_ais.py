"""CLI tool to build and populate synthetic AIS traffic for scenes."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seasentinel import config, scenes as scenes_mod
from seasentinel.ais import sim as ais_sim


def build_ais_for_scene(scene_id: str = None, n_vessels: int = 50):
    scenes = scenes_mod.all_scenes()
    if not scenes:
        print("No scenes found in catalog. Run scripts/prepare_scenes.py first.")
        return

    target_scenes = [s for s in scenes if scene_id is None or s["scene_id"] == scene_id]

    all_rows = []
    all_truth_records = []

    for sc in target_scenes:
        sid = sc["scene_id"]
        bbox = sc["bbox"]
        t_sat = datetime.fromisoformat(sc["t_sat"].replace("Z", "+00:00"))

        # Origin is near center, offset slightly by 4-6 hours of drift
        origin_lon = sc["center"][0] - 0.04
        origin_lat = sc["center"][1] - 0.03
        t_origin = datetime.fromtimestamp(t_sat.timestamp() - 5.5 * 3600, tz=timezone.utc)

        print("Simulating traffic for scene %s around (%.3f, %.3f)..." % (sid, origin_lon, origin_lat))
        sim_res = ais_sim.build(
            bbox=bbox,
            t_center=t_sat,
            origin_lon=origin_lon,
            origin_lat=origin_lat,
            t_origin=t_origin,
            hours=72,
            step_seconds=180,
            n_vessels=n_vessels,
            with_gap=True,
        )
        all_rows.extend(sim_res["rows"])
        all_truth_records.append(sim_res["ground_truth"])

    # Write out combined database
    truth_combined = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "scenes": all_truth_records,
    }
    res = ais_sim.write(all_rows, truth_combined, replace=True)
    print("AIS generation complete: %d rows ingested into %s" % (res["rows_ingested"], config.AIS_SQLITE))
    print("Database summary: %d vessels, %d rows across [%s to %s]" % (
        res["store"]["vessels"], res["store"]["rows"],
        res["store"]["t_start"], res["store"]["t_end"]
    ))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate synthetic AIS maritime traffic.")
    parser.add_argument("--scene", type=str, default=None, help="Target specific scene ID")
    parser.add_argument("--vessels", type=int, default=45, help="Number of vessels per scene")
    args = parser.parse_args()
    build_ais_for_scene(args.scene, args.vessels)

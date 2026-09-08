"""FastAPI application server and entrypoint for SeaSentinel."""
from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from seasentinel import config, scenes as scenes_mod
from seasentinel.ais import ingest as ais_ingest
from seasentinel.api import attribution, drift, health, jobs, report
from seasentinel.drift import fields as fields_mod


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-initialize sample scenes, AIS database, and metocean cache on startup."""
    # 1. Ensure demo scenes exist
    if not scenes_mod.all_scenes():
        print("[SeaSentinel Startup] Initializing demo SAR scenes...")
        from scripts.prepare_scenes import build_default_scenes

        build_default_scenes()

    # 2. Ensure metocean cache exists
    if not fields_mod.list_cached():
        print("[SeaSentinel Startup] Initializing metocean cache...")
        from scripts.build_metocean_cache import build_cache

        build_cache()

    # 3. Ensure AIS database is populated
    try:
        st = ais_ingest.stats()
        if st.rows == 0:
            print("[SeaSentinel Startup] Initializing synthetic AIS maritime traffic...")
            from scripts.build_synthetic_ais import build_ais_for_scene

            build_ais_for_scene(n_vessels=45)
    except Exception as exc:
        print("[SeaSentinel Startup] Notice on AIS store: %s" % exc)

    yield


app = FastAPI(
    title=config.UI_TITLE,
    version=config.VERSION,
    description="Automated Satellite SAR/EO Oil Spill Detection, Lagrangian Hindcasting/Forecasting, and AIS Attribution Intelligence Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(health.router)
app.include_router(jobs.router)
app.include_router(drift.router)
app.include_router(attribution.router)
app.include_router(report.router)

# Cache Static Mount (rendered map overlay PNGs)
config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/cache", StaticFiles(directory=str(config.CACHE_DIR)), name="cache")

# Web Interface Static Mount
web_dir = Path(__file__).resolve().parent / "web"
web_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")


def main():
    parser = argparse.ArgumentParser(description="SeaSentinel Marine Oil Spill Detection & AIS Attribution Server")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address")
    parser.add_argument("--port", type=int, default=8000, help="Port number")
    parser.add_argument("--run", type=str, default=None, help="Run headless analysis on a scene_id and exit")
    args = parser.parse_args()

    if args.run:
        from seasentinel import pipeline

        print("Executing headless pipeline on scene %s..." % args.run)
        res = pipeline.run(scene_id=args.run)
        print("Completed! Job ID: %s" % res["job_id"])
        print("Oil Polygons Detected: %d" % len(res["detection"]["polygons"]))
        if res.get("attribution") and res["attribution"].get("top_culprit"):
            top = res["attribution"]["top_culprit"]
            print("Top Culprit Identified: MMSI %s (%s, %s) with suspicion score %.1f%%" % (
                top["mmsi"], top["name"], top["type"], top["score"]
            ))
        return

    print("=" * 72)
    print("  %s" % config.UI_TITLE)
    print("  Version: %s | SIH ID: %s" % (config.VERSION, config.SIH_ID))
    print("  Serving Visual Interface at: http://localhost:%d" % args.port)
    print("=" * 72)
    uvicorn.run("main:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()

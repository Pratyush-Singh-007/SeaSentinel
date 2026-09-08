"""Zenodo Sentinel-1 SAR Oil Spill Dataset downloader utility.

Dataset Reference:
  Zenodo Record: "Sentinel-1 SAR Oil Spill Dataset"
  https://zenodo.org/record/5142143 or 5221908
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from seasentinel import config


def info():
    print("""
========================================================================
Zenodo Sentinel-1 SAR Oil Spill Dataset Utility
========================================================================
Dataset comprises:
  - Synthetic Aperture Radar (SAR) Sentinel-1 IW mode GRD chips
  - Sigma0 backscatter calibrated in decibels (dB)
  - Pixel-level ground-truth annotations:
      Class 0: Sea surface background
      Class 1: Look-alikes (biogenic slicks, low-wind cells, shear zones)
      Class 2: Mineral oil spills (anthropogenic / vessel discharges)

Official Zenodo links:
  Part 1: https://zenodo.org/record/5142143
  Part 2: https://zenodo.org/record/5221908

SeaSentinel includes built-in georeferenced Sentinel-1 SAR demo scenes in:
  %s

To prepare built-in demo scenes, run:
  python3 scripts/prepare_scenes.py
========================================================================
""" % config.SCENES_DIR)


if __name__ == "__main__":
    info()

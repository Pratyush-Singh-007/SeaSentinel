"""Inference engine for satellite SAR oil spill detection.

Executes either deep learning U-Net inference or adaptive Sigma0 baseline thresholding
with morphological and contrast-based look-alike discrimination.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from .. import config
from ..geo import raster as raster_mod
from ..geo.geometry import binary_closing, label_components, component_slices
from . import model as model_mod

_MODEL = None
_MODEL_ERROR = None
_MODEL_TRIED = False


def model_error() -> Optional[str]:
    return _MODEL_ERROR


def get_model():
    """Lazy loader for neural network weights."""
    global _MODEL, _MODEL_ERROR, _MODEL_TRIED
    if _MODEL_TRIED:
        return _MODEL
    _MODEL_TRIED = True

    if not model_mod._HAVE_TORCH:
        _MODEL_ERROR = "PyTorch is not installed in the environment."
        return None

    path = Path(config.MODEL_PATH)
    if not path.exists():
        _MODEL_ERROR = "Checkpoint %s not found on disk." % path.name
        return None

    try:
        import torch

        net = model_mod.build_model(n_channels=1, n_classes=3)
        dev = "cuda" if torch.cuda.is_available() else ("mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu")
        weights = torch.load(path, map_location=dev)
        net.load_state_dict(weights)
        net.to(dev)
        net.eval()
        _MODEL = (net, dev)
        _MODEL_ERROR = None
        return _MODEL
    except Exception as exc:
        _MODEL_ERROR = "Failed to load model weights: %s" % exc
        return None


def detect(
    sar: raster_mod.Raster,
    prefer_model: bool = True,
    threshold_db: float = -22.0,
    min_pixels: int = 150,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Segment SAR imagery into (class_mask, prob_map, sigma0_db).

    Classes:
        0 = sea / background
        1 = look_alike
        2 = mineral_oil
    """
    img_data = sar.array
    if img_data.ndim == 3:
        plane = img_data[0]
    else:
        plane = img_data

    sigma0_db = raster_mod.to_db(plane)
    h, w = sigma0_db.shape

    m = get_model() if prefer_model else None
    if m is not None:
        try:
            return _infer_unet(m, sigma0_db)
        except Exception:
            pass  # Degrade gracefully to baseline

    return _detect_baseline(sigma0_db, threshold_db=threshold_db, min_pixels=min_pixels)


def _infer_unet(model_tuple, sigma0_db: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Tiled sliding window inference with U-Net."""
    import torch

    net, dev = model_tuple
    h, w = sigma0_db.shape

    # Normalization: typical SAR Sigma0 ranges between -30dB and 0dB
    norm = np.clip((sigma0_db - (-25.0)) / 15.0, -2.5, 2.5)
    norm = np.nan_to_num(norm, nan=-2.0)

    tile_size = 512
    step = 384
    prob_accum = np.zeros((3, h, w), dtype=np.float32)
    weight_accum = np.zeros((h, w), dtype=np.float32)

    # Window weight mask (cosine taper for smooth stitching)
    w_tile = np.outer(np.sin(np.linspace(0.1, np.pi - 0.1, tile_size)),
                      np.sin(np.linspace(0.1, np.pi - 0.1, tile_size))).astype(np.float32)

    for y in range(0, max(1, h - tile_size + step), step):
        y0 = min(y, max(0, h - tile_size))
        y1 = min(y0 + tile_size, h)
        th = y1 - y0
        for x in range(0, max(1, w - tile_size + step), step):
            x0 = min(x, max(0, w - tile_size))
            x1 = min(x0 + tile_size, w)
            tw = x1 - x0

            patch = np.zeros((1, 1, tile_size, tile_size), dtype=np.float32)
            patch[0, 0, :th, :tw] = norm[y0:y1, x0:x1]

            with torch.no_grad():
                inp = torch.from_numpy(patch).to(dev)
                logits = net(inp)
                probs = torch.softmax(logits, dim=1).cpu().numpy()[0]  # (3, 512, 512)

            sub_w = w_tile[:th, :tw]
            prob_accum[:, y0:y1, x0:x1] += probs[:, :th, :tw] * sub_w
            weight_accum[y0:y1, x0:x1] += sub_w

    weight_accum = np.maximum(weight_accum, 1e-6)
    probs = prob_accum / weight_accum
    class_mask = np.argmax(probs, axis=0).astype(np.int32)
    prob_map = np.max(probs, axis=0)

    return class_mask, prob_map, sigma0_db


def _detect_baseline(
    sigma0_db: np.ndarray,
    threshold_db: float = -22.0,
    min_pixels: int = 150,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Adaptive dark patch thresholding with look-alike discrimination."""
    h, w = sigma0_db.shape
    finite = sigma0_db[np.isfinite(sigma0_db)]
    if finite.size == 0:
        return np.zeros((h, w), dtype=np.int32), np.zeros((h, w), dtype=np.float32), sigma0_db

    sea_median = float(np.median(finite))
    # Adaptive threshold: detect dark formations at least 4.2 dB below median sea, bounded by threshold_db
    cut = max(float(threshold_db), sea_median - 4.2)

    dark = (sigma0_db <= cut) & np.isfinite(sigma0_db)
    cleaned = binary_closing(dark, size=3)
    labels, n = label_components(cleaned)

    class_mask = np.zeros((h, w), dtype=np.int32)
    prob_map = np.zeros((h, w), dtype=np.float32)

    boxes = component_slices(labels, n)
    for lab in range(1, n + 1):
        box = boxes[lab - 1] if lab - 1 < len(boxes) else None
        if box is None:
            continue
        sub = labels[box] == lab
        count = int(sub.sum())
        if count < min_pixels:
            continue

        patch_vals = sigma0_db[box][sub]
        mean_patch = float(np.mean(patch_vals))
        contrast = sea_median - mean_patch

        # Morphological aspect: bounding box elongation
        r_len = box[0].stop - box[0].start
        c_len = box[1].stop - box[1].start
        aspect = max(r_len, c_len) / max(1, min(r_len, c_len))

        # Look-alike vs Oil decision:
        # High contrast (>= 6.0 dB) with characteristic damping = mineral oil
        # Moderate contrast (4.0 - 6.0 dB) or massive diffuse patch = natural look-alike
        if contrast >= 6.0 and count < (h * w * 0.15):
            assigned_class = 2  # Mineral oil
            conf = min(0.98, max(0.65, 0.5 + contrast * 0.04))
        else:
            assigned_class = 1  # Look-alike
            conf = 0.58

        class_mask[box][sub] = assigned_class
        prob_map[box][sub] = conf

    return class_mask, prob_map, sigma0_db

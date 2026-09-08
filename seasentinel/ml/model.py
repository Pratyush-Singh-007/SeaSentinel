"""U-Net architecture for SAR oil spill segmentation.

Operates on normalized Sentinel-1 Sigma0 radar backscatter (dB) and predicts:
  Class 0: Sea / water background
  Class 1: Look-alike (low wind, biogenic film, internal waves)
  Class 2: Mineral oil spill (anthropogenic discharge)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .. import config

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    _HAVE_TORCH = True
except ImportError:
    _HAVE_TORCH = False


if _HAVE_TORCH:
    class DoubleConv(nn.Module):
        """(convolution => [BN] => ReLU) * 2"""

        def __init__(self, in_channels: int, out_channels: int):
            super().__init__()
            self.double_conv = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
                nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True),
            )

        def forward(self, x):
            return self.double_conv(x)


    class UNet(nn.Module):
        """Lightweight U-Net for SAR chip segmentation."""

        def __init__(self, n_channels: int = 1, n_classes: int = 3):
            super().__init__()
            self.n_channels = n_channels
            self.n_classes = n_classes

            self.inc = DoubleConv(n_channels, 32)
            self.down1 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(32, 64))
            self.down2 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(64, 128))
            self.down3 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(128, 256))

            self.up1 = nn.ConvTranspose2d(256, 128, kernel_size=2, stride=2)
            self.conv_up1 = DoubleConv(256, 128)

            self.up2 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2)
            self.conv_up2 = DoubleConv(128, 64)

            self.up3 = nn.ConvTranspose2d(64, 32, kernel_size=2, stride=2)
            self.conv_up3 = DoubleConv(64, 32)

            self.outc = nn.Conv2d(32, n_classes, kernel_size=1)

        def forward(self, x):
            x1 = self.inc(x)
            x2 = self.down1(x1)
            x3 = self.down2(x2)
            x4 = self.down3(x3)

            x = self.up1(x4)
            x = self.conv_up1(torch.cat([x, x3], dim=1))
            x = self.up2(x)
            x = self.conv_up2(torch.cat([x, x2], dim=1))
            x = self.up3(x)
            x = self.conv_up3(torch.cat([x, x1], dim=1))
            logits = self.outc(x)
            return logits

else:  # Fallback stub when torch is missing
    class UNet:
        def __init__(self, *args, **kwargs):
            pass


def status() -> Dict[str, Any]:
    """Check PyTorch status and model weights availability."""
    if not _HAVE_TORCH:
        return {
            "torch": False,
            "cuda": False,
            "mps": False,
            "device": "none",
            "weights_exist": False,
            "weights_path": str(config.MODEL_PATH),
        }

    cuda = torch.cuda.is_available()
    mps = hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    dev = "cuda" if cuda else ("mps" if mps else "cpu")
    weights_exist = Path(config.MODEL_PATH).exists()
    return {
        "torch": True,
        "cuda": cuda,
        "mps": mps,
        "device": dev,
        "weights_exist": weights_exist,
        "weights_path": str(config.MODEL_PATH),
    }


def build_model(n_channels: int = 1, n_classes: int = 3) -> Any:
    if not _HAVE_TORCH:
        return None
    return UNet(n_channels=n_channels, n_classes=n_classes)

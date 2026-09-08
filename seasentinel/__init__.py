"""SeaSentinel — Satellite Oil Spill Detection & AIS Attribution Intelligence Platform.

SIH26143 / NTRO Problem Statement Implementation.
"""

__version__ = "2.0.0"
__codename__ = "SeaSentinel"

from . import config, pipeline, schemas, scenes

__all__ = ["config", "pipeline", "schemas", "scenes", "__version__", "__codename__"]


"""Declarative manifest engine — GitOps for infra-pilot.

Define your infrastructure as an ``infra.yaml`` file committed to a Git
repository.  The engine reads the desired state, diffs it against
current state, and reconciles any drift automatically.
"""

from .engine import DriftEntry, DriftReport, ManifestEngine
from .schema import InfraFile, InfraInstance, InfraNetwork, InfraStorage

__all__ = [
    "InfraFile",
    "InfraInstance",
    "InfraNetwork",
    "InfraStorage",
    "ManifestEngine",
    "DriftReport",
    "DriftEntry",
]

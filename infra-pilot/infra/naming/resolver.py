"""Provider/region/SKU token resolution helpers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import yaml

_BASE_MAP_PATH = Path(__file__).with_name("provider_map.yaml")
_OVERRIDE_ENV = "PROVIDER_CONFIG_OVERRIDE"
_ENV_NAME = "TEST_ENV"


def _load_yaml_file(path: Optional[Path]) -> dict[str, str]:
    """Load a YAML mapping from ``path`` and return an empty map on errors."""
    if path is None or not path.exists():
        return {}

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError, UnicodeDecodeError):
        return {}

    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def _load_base_map() -> dict[str, Any]:
    """Load the built-in provider naming map."""
    return _load_yaml_file(_BASE_MAP_PATH)


def _load_overrides_from_path(path: Optional[Path]) -> dict[str, Any]:
    """Load provider-map overrides from an optional YAML path."""
    return _load_yaml_file(path)


def _default_overrides_path() -> Path:
    """Return the default per-environment provider-map override path."""
    return Path.cwd() / "provider_map.yaml"


def _merge_maps(base: Optional[dict[str, Any]], overrides: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Merge base and override maps, with overrides taking precedence."""
    merged: dict[str, Any] = {}
    if base:
        merged.update(base)
    if overrides:
        merged.update(overrides)
    return merged


def load_map() -> dict[str, Any]:
    """Load the effective provider naming map."""
    override_path = Path(os.environ[_OVERRIDE_ENV]) if os.environ.get(_OVERRIDE_ENV) else _default_overrides_path()
    return _merge_maps(_load_base_map(), _load_overrides_from_path(override_path))


def refresh_map() -> None:
    """Reload the module-level naming map."""
    global _MAP
    _MAP = load_map()


def resolve_provider(token: Optional[str]) -> Optional[str]:
    """Resolve a provider token to its configured concrete value."""
    if not token:
        return token
    return _MAP.get(token, token)


def current_env() -> str:
    """Return the current test/deployment environment name."""
    return os.environ.get(_ENV_NAME, "local")


_MAP = load_map()

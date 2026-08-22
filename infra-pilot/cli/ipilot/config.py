"""Configuration management for the Infra Pilot CLI."""

import json
import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

CONFIG_DIR = os.path.expanduser("~/.ipilot")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

ENV_API_URL = "IPILOT_API_URL"
ENV_TOKEN = "IPILOT_TOKEN"
ENV_OUTPUT = "IPILOT_OUTPUT"

DEFAULT_API_URL = "http://localhost:3001"

DEFAULT_CONFIG: Dict[str, Any] = {
    "api_url": os.environ.get(ENV_API_URL, DEFAULT_API_URL),
    "api_key": None,
    "token": None,
    "output_format": "table",
    "profile": None,
}


def ensure_config_dir():
    """Create the config directory if it doesn't exist."""
    os.makedirs(CONFIG_DIR, exist_ok=True)


def load_config(profile: Optional[str] = None) -> Dict[str, Any]:
    """Load configuration from disk, merged with defaults and env vars.

    Args:
        profile: Optional profile name to load.

    Returns:
        A dictionary of configuration values.
    """
    ensure_config_dir()
    config: Dict[str, Any] = dict(DEFAULT_CONFIG)

    config_path = _profile_path(None)
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                config.update(json.load(f))
        except (json.JSONDecodeError, IOError) as exc:
            logger.warning("Failed to load config from %s: %s", config_path, exc)

    profile = profile or config.get("profile")
    if profile:
        config["profile"] = profile
        profile_path = _profile_path(profile)
        if os.path.exists(profile_path):
            try:
                with open(profile_path, "r") as f:
                    config.update(json.load(f))
                config["profile"] = profile
            except (json.JSONDecodeError, IOError) as exc:
                logger.warning("Failed to load profile %s: %s", profile, exc)

    if os.environ.get(ENV_API_URL):
        config["api_url"] = os.environ[ENV_API_URL]
    if os.environ.get(ENV_TOKEN):
        config["token"] = os.environ[ENV_TOKEN]
    if os.environ.get(ENV_OUTPUT):
        config["output_format"] = os.environ[ENV_OUTPUT]

    return config


def save_config(config: Dict[str, Any]):
    """Save configuration to disk.

    Args:
        config: The configuration dictionary to persist.
    """
    ensure_config_dir()
    profile = config.pop("profile", None)
    path = _profile_path(profile)
    try:
        with open(path, "w") as f:
            json.dump(config, f, indent=2)
    except IOError as exc:
        logger.error("Failed to save config to %s: %s", path, exc)
    if profile:
        config["profile"] = profile


def get(key: str, profile: Optional[str] = None) -> Any:
    """Get a single configuration value.

    Args:
        key: The config key to retrieve.
        profile: Optional profile name.

    Returns:
        The value for the given key, or ``None``.
    """
    return load_config(profile=profile).get(key)


def set_key(key: str, value: Any, profile: Optional[str] = None):
    """Set a configuration key and persist to disk.

    Args:
        key: The key to set.
        value: The value to assign.
        profile: Optional profile name.
    """
    config = load_config(profile=profile)
    config[key] = value
    save_config(config)


def unset_key(key: str, profile: Optional[str] = None):
    """Remove a configuration key.

    Args:
        key: The key to remove.
        profile: Optional profile name.
    """
    config = load_config(profile=profile)
    config.pop(key, None)
    save_config(config)


def list_profiles() -> list:
    """List all available configuration profiles.

    Returns:
        A list of profile names.
    """
    ensure_config_dir()
    profiles = []
    try:
        for fname in os.listdir(CONFIG_DIR):
            if fname.startswith("config-") and fname.endswith(".json"):
                profiles.append(fname[7:-5])
    except OSError as exc:
        logger.error("Failed to list profiles: %s", exc)
    return profiles


def delete_profile(profile: str):
    """Delete a configuration profile from disk.

    Args:
        profile: The profile name to delete.
    """
    path = _profile_path(profile)
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError as exc:
        logger.error("Failed to delete profile %s: %s", profile, exc)


def _profile_path(profile: Optional[str]) -> str:
    """Build the filesystem path for a profile's config file.

    Args:
        profile: Profile name or ``None`` for the default config.

    Returns:
        The absolute file path.
    """
    if profile:
        return os.path.join(CONFIG_DIR, f"config-{profile}.json")
    return CONFIG_FILE


__all__ = [
    "load_config",
    "save_config",
    "get",
    "set_key",
    "unset_key",
    "list_profiles",
    "delete_profile",
]

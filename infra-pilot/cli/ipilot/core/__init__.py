"""Core CLI utilities."""

from typing import Any

from .command_registry import attach_to_app, discover_commands, get_registry, register
from .exceptions import (
    APIError,
    AuthenticationError,
    CLIError,
    CommandNotFoundError,
    ConfigError,
    ConnectionError,
    ValidationError,
)


def __getattr__(name: str) -> Any:
    if name in {"create_app", "get_client"}:
        from . import cli

        return getattr(cli, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "create_app",
    "get_client",
    "register",
    "discover_commands",
    "attach_to_app",
    "get_registry",
    "CLIError",
    "APIError",
    "ConfigError",
    "CommandNotFoundError",
    "AuthenticationError",
    "ConnectionError",
    "ValidationError",
]

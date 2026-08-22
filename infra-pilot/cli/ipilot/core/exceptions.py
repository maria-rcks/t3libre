"""Custom exceptions for the Infra Pilot CLI."""

import logging

logger = logging.getLogger(__name__)


class CLIError(Exception):
    """Base exception for all CLI errors."""


class APIError(CLIError):
    """Raised when an API request fails."""


class ConfigError(CLIError):
    """Raised when there is a configuration error."""


class CommandNotFoundError(CLIError):
    """Raised when a command is not found."""


class AuthenticationError(CLIError):
    """Raised when authentication fails."""


class ConnectionError(CLIError):
    """Raised when a connection to the API fails."""


class ValidationError(CLIError):
    """Raised when input validation fails."""


__all__ = [
    "CLIError",
    "APIError",
    "ConfigError",
    "CommandNotFoundError",
    "AuthenticationError",
    "ConnectionError",
    "ValidationError",
]

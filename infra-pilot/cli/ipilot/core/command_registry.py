"""Command auto-discovery and registration for the CLI."""

import importlib
import logging
import pkgutil
from typing import Dict, Tuple

import typer

logger = logging.getLogger(__name__)

_registry: Dict[str, Tuple[typer.Typer, str]] = {}


def register(name: str, help_text: str = ""):
    """Decorator to register a Typer sub-app for auto-attachment.

    Args:
        name: The command name to register under.
        help_text: Optional help text for the command.

    Returns:
        A decorator that registers the app and returns it.
    """

    def decorator(app: typer.Typer):
        _registry[name] = (app, help_text)
        return app

    return decorator


def discover_commands(package_path: str = "ipilot.commands"):
    """Discover command modules and register their Typer apps.

    Walks the given package path looking for modules with a ``typer.Typer``
    instance named ``app`` and registers them in the global registry.

    Args:
        package_path: Dotted path to the commands package.
    """
    try:
        pkg = importlib.import_module(package_path)
    except ImportError:
        logger.warning("Commands package %s not found", package_path)
        return

    for importer, modname, ispkg in pkgutil.walk_packages(
        pkg.__path__, prefix=f"{package_path}."
    ):
        if ispkg:
            continue
        try:
            mod = importlib.import_module(modname)
            if hasattr(mod, "app") and isinstance(mod.app, typer.Typer):
                base = package_path.split(".")
                parts = modname.split(".")[len(base):]
                name = "_".join(parts) if len(parts) > 1 else parts[0]
                _registry[name] = (mod.app, mod.app.info.help or "")
        except Exception:
            logger.exception("Failed to discover command module: %s", modname)


def attach_to_app(app: typer.Typer):
    """Attach all discovered sub-apps to a parent Typer app.

    Args:
        app: The parent Typer app to attach sub-apps to.
    """
    for name, (sub_app, _) in _registry.items():
        app.add_typer(sub_app, name=name)


def get_registry() -> Dict[str, typer.Typer]:
    """Return a dict mapping command names to their Typer apps.

    Returns:
        A dictionary of command name to Typer app.
    """
    return {k: v[0] for k, v in _registry.items()}


__all__ = [
    "register",
    "discover_commands",
    "attach_to_app",
    "get_registry",
]

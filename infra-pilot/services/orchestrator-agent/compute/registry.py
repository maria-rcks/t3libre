"""Provider registry — a plugin system for compute back-ends.

Providers self-register via the ``@provider`` decorator or by
calling ``ProviderRegistry.register()``.  Selection is done by name
so that manifests can specify ``provider: docker``, ``provider: proxmox``,
etc. without the core knowing about specific implementations.
"""

import logging
from typing import Dict, Optional, Type

from .base import ComputeProvider

logger = logging.getLogger(__name__)


class ProviderRegistry:
    """Global registry of available compute providers."""

    _providers: Dict[str, Type[ComputeProvider]] = {}
    _instances: Dict[str, ComputeProvider] = {}

    @classmethod
    def register(cls, provider_cls: Type[ComputeProvider]) -> Type[ComputeProvider]:
        """Register a provider class (also usable as a decorator)."""
        name = getattr(provider_cls, "name", None)
        if name is None:
            try:
                name = provider_cls().name
            except Exception:
                name = provider_cls.__name__.lower()
        if name in cls._providers:
            logger.warning("Overwriting existing provider: %s", name)
        cls._providers[name] = provider_cls
        logger.info("Registered compute provider: %s (%s)", name, provider_cls.__name__)
        return provider_cls

    @classmethod
    def get(cls, name: str, **kwargs) -> Optional[ComputeProvider]:
        """Return a singleton provider instance by name."""
        if name in cls._instances:
            return cls._instances[name]
        provider_cls = cls._providers.get(name)
        if not provider_cls:
            logger.error(
                "Unknown compute provider: %s (available: %s)",
                name,
                list(cls._providers),
            )
            return None
        try:
            instance = provider_cls(**kwargs)
            cls._instances[name] = instance
            return instance
        except Exception as exc:
            logger.error("Failed to instantiate provider %s: %s", name, exc)
            return None

    @classmethod
    def list_providers(cls) -> Dict[str, str]:
        """Return ``{name: qualname}`` for every registered provider."""
        return {
            n: f"{c.__module__}.{c.__qualname__}" for n, c in cls._providers.items()
        }

    @classmethod
    def clear(cls) -> None:
        """Reset registry (useful in tests)."""
        cls._providers.clear()
        cls._instances.clear()


provider = ProviderRegistry.register

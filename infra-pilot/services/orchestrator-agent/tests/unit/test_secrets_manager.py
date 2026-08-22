"""Tests for secrets manager backend selection and dispatch."""

from typing import Any, Dict, List, Optional

import pytest
from secrets_manager import (
    AWSSecretsManagerBackend,
    AzureKeyVaultBackend,
    SecretsBackend,
    SecretsManager,
    VaultBackend,
    get_secrets_manager,
    init_secrets_manager,
)


class InMemoryBackend(SecretsBackend):
    """Fake backend so the dispatch logic is tested without cloud SDKs."""

    def __init__(self):
        self.store: Dict[str, Dict[str, Any]] = {}

    def get_secret(self, path: str, key: Optional[str] = None) -> Any:
        data = self.store.get(path, {})
        return data.get(key) if key else data

    def set_secret(self, path: str, data: Dict) -> bool:
        self.store[path] = data
        return True

    def delete_secret(self, path: str) -> bool:
        return self.store.pop(path, None) is not None

    def list_secrets(self, path: str) -> List[str]:
        return [k for k in self.store if k.startswith(path)]


class TestSecretsManager:
    def test_dispatch_get_set_delete_list(self):
        backend = InMemoryBackend()
        manager = SecretsManager(backend=backend)
        assert manager.set("apps/webhook", {"token": "abc"}) is True
        assert manager.get("apps/webhook", "token") == "abc"
        assert manager.get("apps/webhook") == {"token": "abc"}
        assert manager.list("apps/") == ["apps/webhook"]
        assert manager.delete("apps/webhook") is True
        assert manager.get("apps/webhook") == {}

    def test_delete_missing_secret_returns_false(self):
        manager = SecretsManager(backend=InMemoryBackend())
        assert manager.delete("nope") is False

    def test_unknown_backend_type_raises(self):
        with pytest.raises(ValueError, match="Unknown backend type"):
            SecretsManager(backend_type="bogus")

    def test_init_and_get_singleton(self):
        init_secrets_manager(backend=InMemoryBackend())
        manager = get_secrets_manager()
        assert isinstance(manager, SecretsManager)
        assert manager.set("k", {"v": 1}) is True
        assert get_secrets_manager() is manager

    def test_get_before_init_raises(self):
        import secrets_manager as module

        original = module._manager
        module._manager = None
        try:
            with pytest.raises(RuntimeError, match="not initialized"):
                get_secrets_manager()
        finally:
            module._manager = original


class TestBackendSelection:
    def test_default_backend_is_vault(self, monkeypatch):
        monkeypatch.setattr(VaultBackend, "_connect", lambda self: None)
        monkeypatch.setattr(VaultBackend, "check_connection", lambda self: False)
        manager = SecretsManager(backend_type="vault")
        assert isinstance(manager.backend, VaultBackend)

    def test_aws_and_azure_backend_types(self):
        with pytest.raises(RuntimeError, match="Not connected"):
            SecretsManager(backend_type="aws").get("path")
        with pytest.raises(RuntimeError, match="Not connected"):
            SecretsManager(backend_type="azure").get("path")

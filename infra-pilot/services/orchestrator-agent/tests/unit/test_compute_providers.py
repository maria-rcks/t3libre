"""Tests for the compute provider abstraction layer."""

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pytest
from compute.base import (
    ComputeProvider,
    InstanceInfo,
    InstanceNotFoundError,
    InstancePowerState,
    InstanceSpec,
    InstanceStats,
    ProviderCapabilities,
    ProviderError,
)
from compute.registry import ProviderRegistry, provider


# ---------------------------------------------------------------------------
# Stub provider for testing the registry / interface contract
# ---------------------------------------------------------------------------
@provider
class StubProvider(ComputeProvider):
    name = "stub"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(supports_snapshots=True, regions=["us-east-1"])

    async def create(self, spec: InstanceSpec) -> InstanceInfo:
        return InstanceInfo(
            id="stub-1",
            name=spec.name,
            provider="stub",
            status=InstancePowerState.RUNNING,
            spec=spec,
            created_at=datetime.now(),
            host="stub.example.com",
        )

    async def get(self, instance_id: str) -> InstanceInfo:
        if instance_id != "stub-1":
            raise InstanceNotFoundError(instance_id)
        return InstanceInfo(
            id="stub-1",
            name="test",
            provider="stub",
            status=InstancePowerState.RUNNING,
            spec=InstanceSpec(
                name="test", image="ubuntu", cpu_cores=1, memory_mb=512, storage_gb=10
            ),
            created_at=datetime.now(),
            host="stub.example.com",
        )

    async def list(self) -> List[InstanceInfo]:
        return [await self.get("stub-1")]

    async def start(self, instance_id: str) -> bool:
        return True

    async def stop(self, instance_id: str) -> bool:
        return True

    async def restart(self, instance_id: str) -> bool:
        return True

    async def delete(self, instance_id: str) -> bool:
        return True

    async def update(self, instance_id: str, spec: InstanceSpec) -> bool:
        return True

    async def stats(self, instance_id: str) -> Optional[InstanceStats]:
        return None

    async def execute_command(self, instance_id: str, command: str) -> Tuple[bool, str]:
        return True, "ok"


class TestProviderRegistry:
    def setup_method(self):
        ProviderRegistry.clear()

    def test_register_and_list(self):
        ProviderRegistry.register(StubProvider)
        providers = ProviderRegistry.list_providers()
        assert "stub" in providers

    def test_get(self):
        ProviderRegistry.register(StubProvider)
        p = ProviderRegistry.get("stub")
        assert p is not None
        assert p.name == "stub"

    def test_get_unknown(self):
        assert ProviderRegistry.get("nonexistent") is None

    def test_singleton(self):
        a = ProviderRegistry.get("stub")
        b = ProviderRegistry.get("stub")
        assert a is b


class TestStubProvider:
    def setup_method(self):
        ProviderRegistry.clear()
        ProviderRegistry.register(StubProvider)
        self.prov = ProviderRegistry.get("stub")

    @pytest.mark.asyncio
    async def test_create(self):
        spec = InstanceSpec(
            name="hello", image="ubuntu", cpu_cores=2, memory_mb=1024, storage_gb=20
        )
        info = await self.prov.create(spec)
        assert info.status == InstancePowerState.RUNNING
        assert info.spec.cpu_cores == 2

    @pytest.mark.asyncio
    async def test_get_not_found(self):
        with pytest.raises(InstanceNotFoundError):
            await self.prov.get("does-not-exist")

    @pytest.mark.asyncio
    async def test_lifecycle(self):
        assert await self.prov.start("stub-1")
        assert await self.prov.stop("stub-1")
        assert await self.prov.restart("stub-1")
        assert await self.prov.delete("stub-1")

    @pytest.mark.asyncio
    async def test_execute(self):
        ok, out = await self.prov.execute_command("stub-1", "echo hi")
        assert ok
        assert out == "ok"

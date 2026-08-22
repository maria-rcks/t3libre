"""Tests for the declarative manifest engine (GitOps core)."""

import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pytest
import yaml
from compute.base import (
    ComputeProvider,
    InstanceInfo,
    InstancePowerState,
    InstanceSpec,
    ProviderCapabilities,
)
from compute.registry import ProviderRegistry
from manifest.engine import ManifestEngine
from manifest.schema import InfraFile, InfraInstance


@pytest.fixture(autouse=True)
def clean_registry():
    ProviderRegistry.clear()
    yield
    ProviderRegistry.clear()


# A test provider that stores instances in-memory for verification
class MemoryProvider(ComputeProvider):
    name = "memory"

    def __init__(self):
        self._instances: Dict[str, InstanceInfo] = {}

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities()

    async def create(self, spec: InstanceSpec) -> InstanceInfo:
        info = InstanceInfo(
            id=f"mem-{len(self._instances)}",
            name=spec.name,
            provider="memory",
            status=InstancePowerState.RUNNING,
            spec=spec,
            created_at=datetime.now(),
            host="localhost",
        )
        self._instances[spec.name] = info
        return info

    async def get(self, instance_id: str) -> InstanceInfo:
        for info in self._instances.values():
            if info.id == instance_id:
                return info
        raise LookupError(instance_id)

    async def list(self) -> List[InstanceInfo]:
        return list(self._instances.values())

    async def start(self, instance_id: str) -> bool:
        return True

    async def stop(self, instance_id: str) -> bool:
        return True

    async def restart(self, instance_id: str) -> bool:
        return True

    async def delete(self, instance_id: str) -> bool:
        for name, info in list(self._instances.items()):
            if info.id == instance_id:
                del self._instances[name]
                return True
        return False

    async def update(self, instance_id: str, spec: InstanceSpec) -> bool:
        for info in self._instances.values():
            if info.id == instance_id:
                info.spec = spec
                return True
        return False

    async def stats(self, instance_id: str) -> None:
        return None

    async def execute_command(self, instance_id: str, command: str) -> Tuple[bool, str]:
        return True, "ok"


SAMPLE_MANIFEST = {
    "api_version": "v1",
    "kind": "InfraFile",
    "metadata": {"name": "test-infra", "region": "us-east-1"},
    "spec": {
        "instances": [
            {
                "name": "web-01",
                "provider": "memory",
                "image": "nginx:latest",
                "cpu": 1,
                "memory_mb": 512,
                "storage_gb": 10,
                "ports": {"80/tcp": "8080"},
                "labels": {"app": "web"},
            }
        ]
    },
}


class TestManifestParsing:
    def test_from_dict(self):
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        assert infra.metadata.name == "test-infra"
        assert len(infra.spec.instances) == 1
        assert infra.spec.instances[0].name == "web-01"
        assert infra.spec.instances[0].cpu == 1

    def test_round_trip(self):
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        restored = InfraFile.from_dict(infra.to_dict())
        assert restored.metadata.name == infra.metadata.name
        assert restored.spec.instances[0].name == infra.spec.instances[0].name

    def test_load_yaml(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            yaml.dump(SAMPLE_MANIFEST, f)
            path = f.name
        try:
            infra = ManifestEngine.load_yaml(path)
            assert infra.metadata.name == "test-infra"
        finally:
            Path(path).unlink(missing_ok=True)


class TestDriftDetection:
    @pytest.mark.asyncio
    async def test_no_drift(self):
        ProviderRegistry.register(MemoryProvider)
        prov = ProviderRegistry.get("memory")
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        spec = InstanceSpec(
            name="web-01",
            image="nginx:latest",
            cpu_cores=1,
            memory_mb=512,
            storage_gb=10,
        )
        await prov.create(spec)
        current = await prov.list()
        current_map = {i.name: i for i in current}

        engine = ManifestEngine()
        report = await engine.detect_drift(infra, current_map)
        assert report.drifted_instances == 0

    @pytest.mark.asyncio
    async def test_missing_instance(self):
        ProviderRegistry.register(MemoryProvider)
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        engine = ManifestEngine()
        report = await engine.detect_drift(infra, {})
        assert report.drifted_instances == 1
        assert "does not exist" in report.entries[0].message

    @pytest.mark.asyncio
    async def test_cpu_drift(self):
        ProviderRegistry.register(MemoryProvider)
        prov = ProviderRegistry.get("memory")
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        spec = InstanceSpec(
            name="web-01",
            image="nginx:latest",
            cpu_cores=4,
            memory_mb=512,
            storage_gb=10,
        )
        await prov.create(spec)
        current = await prov.list()
        current_map = {i.name: i for i in current}

        engine = ManifestEngine()
        report = await engine.detect_drift(infra, current_map)
        assert report.drifted_instances == 1
        assert any(e.field == "cpu_cores" for e in report.entries)


class TestReconciliation:
    @pytest.mark.asyncio
    async def test_create_missing(self):
        ProviderRegistry.register(MemoryProvider)
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        engine = ManifestEngine(dry_run=False)
        result = await engine.reconcile(infra)
        assert result.instances_created == 1
        assert result.instances_unchanged == 0

    @pytest.mark.asyncio
    async def test_dry_run(self):
        ProviderRegistry.register(MemoryProvider)
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        engine = ManifestEngine(dry_run=True)
        result = await engine.reconcile(infra)
        assert result.instances_created == 1
        assert result.dry_run

    @pytest.mark.asyncio
    async def test_no_changes(self):
        ProviderRegistry.register(MemoryProvider)
        prov = ProviderRegistry.get("memory")
        infra = InfraFile.from_dict(SAMPLE_MANIFEST)
        spec = InstanceSpec(
            name="web-01",
            image="nginx:latest",
            cpu_cores=1,
            memory_mb=512,
            storage_gb=10,
        )
        await prov.create(spec)

        engine = ManifestEngine(dry_run=False)
        result = await engine.reconcile(infra)
        assert result.instances_created == 0
        assert result.instances_updated == 0

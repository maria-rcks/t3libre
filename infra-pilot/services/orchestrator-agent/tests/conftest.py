import pathlib
import sys
from dataclasses import dataclass

import pytest

SERVICE_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


@pytest.fixture(autouse=True)
def no_database(monkeypatch):
    """Stub database access so unit tests are hermetic and fast.

    ``vps_manager`` falls back to JSON-file persistence when the database
    is unreachable; stubbing the connection helpers exercises exactly that
    production resilience path without real connection timeouts.
    """

    async def no_pool():
        raise RuntimeError("database disabled in unit tests")

    def no_sync_connection():
        raise RuntimeError("database disabled in unit tests")

    monkeypatch.setattr("db.get_pool", no_pool)
    monkeypatch.setattr("db.get_sync_connection", no_sync_connection)


@dataclass
class MockImage:
    id: str = "image-1"


@dataclass
class MockContainer:
    id: str = "container-1"
    name: str = "mock-container"
    status: str = "running"
    stopped: bool = False
    removed: bool = False
    started: bool = False
    restarted: bool = False
    updated: bool = False

    def stop(self):
        self.stopped = True
        self.status = "stopped"

    def remove(self):
        self.removed = True

    def start(self):
        self.started = True
        self.status = "running"

    def restart(self):
        self.restarted = True
        self.status = "running"

    def update(self, **kwargs):
        self.updated = True
        self.update_kwargs = kwargs

    def commit(self, repository="", **kwargs):
        return MockImage(id=f"{repository}-img-1")

    def stats(self, stream=False):
        return {
            "cpu_stats": {"cpu_usage": {"total_usage": 300}, "system_cpu_usage": 1000},
            "precpu_stats": {
                "cpu_usage": {"total_usage": 100},
                "system_cpu_usage": 500,
            },
            "memory_stats": {"usage": 128, "limit": 512},
            "networks": {"eth0": {"rx_bytes": 10, "tx_bytes": 20}},
        }


class MockContainerCollection:
    def __init__(self):
        self.created = []
        self.by_id = {"container-1": MockContainer()}

    def run(self, **kwargs):
        container = MockContainer(id=f"container-{len(self.created) + 1}")
        self.created.append((container, kwargs))
        self.by_id[container.id] = container
        return container

    def get(self, container_id):
        if container_id not in self.by_id:
            raise KeyError(container_id)
        return self.by_id[container_id]

    def list(self):
        return list(self.by_id.values())


class MockDockerClient:
    def __init__(self):
        self.containers = MockContainerCollection()

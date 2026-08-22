"""Abstract base class for all compute providers.

Providers translate generic operations (create, start, stop, etc.)
into hypervisor-specific API calls.  New providers register themselves
via ``ProviderRegistry`` and are selected by the ``provider`` field
in a server's manifest.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class InstancePowerState(Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    PAUSED = "paused"
    UNKNOWN = "unknown"


class ProviderError(Exception):
    """Generic provider-level failure."""


class InstanceNotFoundError(ProviderError):
    """Requested instance does not exist."""


@dataclass
class InstanceSpec:
    """Desired state of a compute instance."""

    name: str
    image: str
    cpu_cores: float
    memory_mb: int
    storage_gb: int
    ports: Dict[str, str] = field(default_factory=dict)
    env_vars: Dict[str, str] = field(default_factory=dict)
    labels: Dict[str, str] = field(default_factory=dict)
    region: str = ""
    ssh_keys: List[str] = field(default_factory=list)
    user_data: str = ""
    network_id: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class InstanceInfo:
    """Reported state of an existing instance."""

    id: str
    name: str
    provider: str
    status: InstancePowerState
    spec: InstanceSpec
    created_at: datetime
    host: str
    private_ips: List[str] = field(default_factory=list)
    public_ips: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class InstanceStats:
    """Live resource usage snapshot."""

    cpu_percent: float
    memory_percent: float
    memory_used_bytes: int
    memory_total_bytes: int
    network_rx_bytes: int
    network_tx_bytes: int
    disk_percent: float
    collected_at: datetime


@dataclass
class ProviderCapabilities:
    """What a provider can do."""

    supports_snapshots: bool = False
    supports_backups: bool = False
    supports_live_migration: bool = False
    supports_resize: bool = False
    supports_firewall: bool = False
    supports_load_balancer: bool = False
    max_instances: int = 0
    regions: List[str] = field(default_factory=list)


class ComputeProvider(ABC):
    """Every provider must implement this interface."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Short unique identifier, e.g. ``docker``, ``proxmox``, ``aws``."""

    @property
    @abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        """Declare what this provider supports."""

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    @abstractmethod
    async def create(self, spec: InstanceSpec) -> InstanceInfo:
        """Provision a new instance."""

    @abstractmethod
    async def get(self, instance_id: str) -> InstanceInfo:
        """Return current info (raise InstanceNotFoundError if missing)."""

    @abstractmethod
    async def list(self) -> List[InstanceInfo]:
        """Return all instances managed by this provider."""

    @abstractmethod
    async def start(self, instance_id: str) -> bool:
        """Power on an instance."""

    @abstractmethod
    async def stop(self, instance_id: str) -> bool:
        """Power off an instance."""

    @abstractmethod
    async def restart(self, instance_id: str) -> bool:
        """Reboot an instance."""

    @abstractmethod
    async def delete(self, instance_id: str) -> bool:
        """Destroy an instance."""

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------
    @abstractmethod
    async def update(self, instance_id: str, spec: InstanceSpec) -> bool:
        """Apply new resource limits / config."""

    # ------------------------------------------------------------------
    # Monitoring
    # ------------------------------------------------------------------
    @abstractmethod
    async def stats(self, instance_id: str) -> Optional[InstanceStats]:
        """Return live resource usage or None."""

    # ------------------------------------------------------------------
    # Snapshots / Backups
    # ------------------------------------------------------------------
    async def create_snapshot(
        self, instance_id: str, name: Optional[str] = None
    ) -> Optional[str]:
        raise NotImplementedError

    async def list_snapshots(self, instance_id: str) -> List[Dict[str, Any]]:
        raise NotImplementedError

    async def restore_snapshot(self, instance_id: str, snapshot_id: str) -> bool:
        raise NotImplementedError

    async def create_backup(
        self, instance_id: str, retention_type: str = "daily"
    ) -> Optional[str]:
        raise NotImplementedError

    async def list_backups(self, instance_id: str) -> List[Dict[str, Any]]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Networking helpers
    # ------------------------------------------------------------------
    async def get_public_ip(self, instance_id: str) -> Optional[str]:
        info = await self.get(instance_id)
        return info.public_ips[0] if info.public_ips else None

    async def execute_command(self, instance_id: str, command: str) -> Tuple[bool, str]:
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    async def health(self) -> Dict[str, Any]:
        """Return provider-level health (connection, resource usage)."""
        return {"status": "unknown"}

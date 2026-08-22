"""Docker compute provider — wraps the existing VPSManager.

This is the built-in default provider.  It translates the generic
``ComputeProvider`` interface into Docker API calls via the existing
``VPSManager`` that was already in the codebase.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .base import (
    ComputeProvider,
    InstanceInfo,
    InstanceNotFoundError,
    InstancePowerState,
    InstanceSpec,
    InstanceStats,
    ProviderCapabilities,
    ProviderError,
)
from .registry import provider

logger = logging.getLogger(__name__)

# Lazy import to avoid circular deps and keep Docker optional
_VPS_MANAGER: Optional[Any] = None


def _get_manager():
    global _VPS_MANAGER
    if _VPS_MANAGER is None:
        from vps_manager import VPSConfig, VPSManager

        _VPS_MANAGER = VPSManager()
    return _VPS_MANAGER


@provider
class DockerProvider(ComputeProvider):
    """Provider that manages Docker containers as instances."""

    name = "docker"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supports_snapshots=True,
            supports_backups=True,
            supports_resize=True,
            max_instances=0,
            regions=["default"],
        )

    async def create(self, spec: InstanceSpec) -> InstanceInfo:
        mgr = _get_manager()
        cfg = mgr.VPSConfig(
            cpu_limit=spec.cpu_cores,
            memory_limit=spec.memory_mb,
            storage_limit=spec.storage_gb,
            image=spec.image,
            ports=spec.ports,
            env_vars=spec.env_vars,
        )
        container_id = await mgr.create_vps("provider", cfg)
        if not container_id:
            raise ProviderError(f"Failed to create container from image {spec.image}")
        return await self.get(container_id)

    async def get(self, instance_id: str) -> InstanceInfo:
        mgr = _get_manager()
        try:
            container = mgr.client.containers.get(instance_id)
        except Exception as exc:
            raise InstanceNotFoundError(str(exc)) from exc

        info = mgr.vps_instances.get(instance_id, {})
        cfg = info.get("config", {})
        ips = []
        try:
            net_settings = container.attrs.get("NetworkSettings", {})
            networks = net_settings.get("Networks", {})
            for net_name, net_cfg in networks.items():
                ip = net_cfg.get("IPAddress", "")
                if ip:
                    ips.append(ip)
        except Exception:
            pass

        created = info.get("created_at", "")
        try:
            created_dt = datetime.fromisoformat(created) if created else datetime.now()
        except Exception:
            created_dt = datetime.now()

        return InstanceInfo(
            id=container.id,
            name=container.name,
            provider="docker",
            status=_map_status(container.status),
            spec=InstanceSpec(
                name=container.name,
                image=container.image.tags[0] if container.image.tags else "unknown",
                cpu_cores=cfg.get("cpu_limit", 1.0),
                memory_mb=cfg.get("memory_limit", 512),
                storage_gb=cfg.get("storage_limit", 10),
                ports=cfg.get("ports", {}),
                env_vars=cfg.get("env_vars", {}),
                labels=container.labels or {},
            ),
            created_at=created_dt,
            host=info.get("host", "localhost"),
            private_ips=ips,
            metadata=info,
        )

    async def list(self) -> List[InstanceInfo]:
        mgr = _get_manager()
        results = []
        for cid in list(mgr.vps_instances.keys()):
            try:
                results.append(await self.get(cid))
            except InstanceNotFoundError:
                continue
        return results

    async def start(self, instance_id: str) -> bool:
        return await _get_manager().start_vps(instance_id)

    async def stop(self, instance_id: str) -> bool:
        return await _get_manager().stop_vps(instance_id)

    async def restart(self, instance_id: str) -> bool:
        return await _get_manager().restart_vps(instance_id)

    async def delete(self, instance_id: str) -> bool:
        return await _get_manager().delete_vps(instance_id)

    async def update(self, instance_id: str, spec: InstanceSpec) -> bool:
        mgr = _get_manager()
        cfg = mgr.VPSConfig(
            cpu_limit=spec.cpu_cores,
            memory_limit=spec.memory_mb,
            storage_limit=spec.storage_gb,
            image=spec.image,
            ports=spec.ports,
            env_vars=spec.env_vars,
        )
        return await mgr.update_vps_config(instance_id, cfg)

    async def stats(self, instance_id: str) -> Optional[InstanceStats]:
        mgr = _get_manager()
        raw = await mgr.get_vps_stats(instance_id)
        if not raw:
            return None
        return InstanceStats(
            cpu_percent=raw.get("cpu_usage", 0.0),
            memory_percent=raw.get("memory_usage", 0.0),
            memory_used_bytes=0,
            memory_total_bytes=0,
            network_rx_bytes=raw.get("network", {}).get("rx_bytes", 0),
            network_tx_bytes=raw.get("network", {}).get("tx_bytes", 0),
            disk_percent=0.0,
            collected_at=datetime.now(),
        )

    async def create_snapshot(
        self, instance_id: str, name: Optional[str] = None
    ) -> Optional[str]:
        return await _get_manager().create_snapshot(instance_id, name)

    async def list_snapshots(self, instance_id: str) -> List[Dict[str, Any]]:
        return await _get_manager().list_snapshots(instance_id)

    async def restore_snapshot(self, instance_id: str, snapshot_id: str) -> bool:
        return await _get_manager().restore_snapshot(instance_id, snapshot_id)

    async def create_backup(
        self, instance_id: str, retention_type: str = "daily"
    ) -> Optional[str]:
        return await _get_manager().create_backup(instance_id, retention_type)

    async def list_backups(self, instance_id: str) -> List[Dict[str, Any]]:
        return await _get_manager().list_backups(instance_id)

    async def execute_command(self, instance_id: str, command: str) -> Tuple[bool, str]:
        mgr = _get_manager()
        try:
            container = mgr.client.containers.get(instance_id)
            return mgr._exec_in_container(container, command)
        except Exception as exc:
            return False, str(exc)

    async def health(self) -> Dict[str, Any]:
        mgr = _get_manager()
        try:
            mgr.client.ping()
            return {
                "status": "ok",
                "containers": len(mgr.client.containers.list(all=True)),
            }
        except Exception as exc:
            return {"status": "unreachable", "error": str(exc)}


def _map_status(docker_status: str) -> InstancePowerState:
    mapping = {
        "running": InstancePowerState.RUNNING,
        "exited": InstancePowerState.STOPPED,
        "paused": InstancePowerState.PAUSED,
        "created": InstancePowerState.STOPPED,
        "restarting": InstancePowerState.RUNNING,
        "removing": InstancePowerState.STOPPED,
        "dead": InstancePowerState.STOPPED,
    }
    return mapping.get(docker_status, InstancePowerState.UNKNOWN)

"""Reconciliation engine — the heart of GitOps.

Read a desired ``InfraFile`` manifest, query the current state from
the compute providers, compute a diff, and apply changes to converge.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

import docker
import yaml
from compute.base import ComputeProvider, InstanceInfo, InstanceSpec, ProviderError
from compute.registry import ProviderRegistry
from manifest.schema import InfraFile, InfraInstance, InfraNetwork, InfraStorage

logger = logging.getLogger(__name__)


class DriftSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class DriftEntry:
    """A single drift item — a difference between desired and actual state."""

    instance_name: str
    field: str
    expected: Any
    actual: Any
    severity: DriftSeverity = DriftSeverity.WARNING
    message: str = ""


@dataclass
class DriftReport:
    """Complete drift analysis for a manifest."""

    manifest_name: str
    total_instances: int
    drifted_instances: int
    entries: List[DriftEntry] = field(default_factory=list)
    scanned_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ReconcileResult:
    """Outcome of a reconciliation run."""

    manifest_name: str
    instances_created: int = 0
    instances_updated: int = 0
    instances_deleted: int = 0
    instances_unchanged: int = 0
    errors: List[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    dry_run: bool = False


class ManifestEngine:
    """Reads an InfraFile manifest and reconciles infrastructure state."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self._docker = None

    def _docker_client(self):
        """Lazily connect to the Docker daemon.

        Returns ``None`` when the daemon is unreachable so that the
        provider-based drift/reconcile logic still works without it;
        docker-only concerns (networks, volumes) are then skipped.
        """
        if self._docker is None:
            try:
                client = docker.from_env()
                client.ping()
                self._docker = client
            except Exception as exc:
                logger.warning("Docker daemon unavailable: %s", exc)
        return self._docker

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------
    @staticmethod
    def load_yaml(path: str) -> InfraFile:
        """Load an InfraFile from a YAML file on disk."""
        with open(path) as f:
            raw = yaml.safe_load(f)
        return InfraFile.from_dict(raw)

    @staticmethod
    def load_dict(data: Dict[str, Any]) -> InfraFile:
        """Load an InfraFile from an in-memory dictionary."""
        return InfraFile.from_dict(data)

    # ------------------------------------------------------------------
    # Drift detection
    # ------------------------------------------------------------------
    async def detect_drift(
        self, desired: InfraFile, current_instances: Dict[str, InstanceInfo]
    ) -> DriftReport:
        """Compare desired instances against current state."""
        entries: List[DriftEntry] = []
        desired_names: Set[str] = {i.name for i in desired.spec.instances}
        current_names: Set[str] = set(current_instances.keys())

        for inst in desired.spec.instances:
            actual = current_instances.get(inst.name)
            if actual is None:
                entries.append(
                    DriftEntry(
                        instance_name=inst.name,
                        field="exists",
                        expected=True,
                        actual=False,
                        severity=DriftSeverity.ERROR,
                        message=f"Instance '{inst.name}' is defined but does not exist",
                    )
                )
                continue

            # Check provider
            if actual.provider != inst.provider:
                entries.append(
                    DriftEntry(
                        instance_name=inst.name,
                        field="provider",
                        expected=inst.provider,
                        actual=actual.provider,
                        severity=DriftSeverity.WARNING,
                    )
                )

            # Check CPU
            if abs(actual.spec.cpu_cores - inst.cpu) > 0.1:
                entries.append(
                    DriftEntry(
                        instance_name=inst.name,
                        field="cpu_cores",
                        expected=inst.cpu,
                        actual=actual.spec.cpu_cores,
                        severity=DriftSeverity.WARNING,
                    )
                )

            # Check memory
            if actual.spec.memory_mb != inst.memory_mb:
                entries.append(
                    DriftEntry(
                        instance_name=inst.name,
                        field="memory_mb",
                        expected=inst.memory_mb,
                        actual=actual.spec.memory_mb,
                        severity=DriftSeverity.WARNING,
                    )
                )

            # Check image
            if actual.spec.image != inst.image:
                entries.append(
                    DriftEntry(
                        instance_name=inst.name,
                        field="image",
                        expected=inst.image,
                        actual=actual.spec.image,
                        severity=DriftSeverity.WARNING,
                    )
                )

        # Check networks
        docker_client = self._docker_client()
        if docker_client is not None:
            existing_networks = {n.name for n in docker_client.networks.list()}
            for net in desired.spec.networks:
                if net.name not in existing_networks:
                    entries.append(
                        DriftEntry(
                            instance_name=net.name,
                            field="network_exists",
                            expected=True,
                            actual=False,
                            severity=DriftSeverity.ERROR,
                            message=f"Network '{net.name}' is defined but does not exist",
                        )
                    )

        # Check storage volumes
        if docker_client is not None:
            existing_volumes = {v.name for v in docker_client.volumes.list()}
            for vol in desired.spec.storage:
                if vol.name not in existing_volumes:
                    entries.append(
                        DriftEntry(
                            instance_name=vol.name,
                            field="volume_exists",
                            expected=True,
                            actual=False,
                            severity=DriftSeverity.ERROR,
                            message=f"Volume '{vol.name}' is defined but does not exist",
                        )
                    )
                else:
                    # Check size
                    vol_info = docker_client.volumes.get(vol.name)
                    labels = getattr(vol_info, "labels", {}) or {}
                    desired_size = labels.get("size_gb")
                    if desired_size and str(vol.size_gb) != desired_size:
                        entries.append(
                            DriftEntry(
                                instance_name=vol.name,
                                field="volume_size_gb",
                                expected=vol.size_gb,
                                actual=int(desired_size),
                                severity=DriftSeverity.WARNING,
                            )
                        )

        # Instances that exist but are not in the manifest
        for name in current_names - desired_names:
            entries.append(
                DriftEntry(
                    instance_name=name,
                    field="exists",
                    expected=False,
                    actual=True,
                    severity=DriftSeverity.WARNING,
                    message=f"Instance '{name}' exists but is not in the manifest",
                )
            )

        return DriftReport(
            manifest_name=desired.metadata.name,
            total_instances=len(desired.spec.instances),
            drifted_instances=len({e.instance_name for e in entries}),
            entries=entries,
        )

    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------
    async def reconcile(self, desired: InfraFile) -> ReconcileResult:
        """Converge actual infrastructure toward the desired manifest."""
        result = ReconcileResult(
            manifest_name=desired.metadata.name,
            dry_run=self.dry_run,
        )

        # Index current instances by name across all providers
        current: Dict[str, InstanceInfo] = {}
        provider_map: Dict[str, ComputeProvider] = {}

        for inst in desired.spec.instances:
            prov = ProviderRegistry.get(inst.provider)
            if prov is None:
                result.errors.append(
                    f"Provider '{inst.provider}' not found for {inst.name}"
                )
                continue
            provider_map[inst.provider] = prov
            try:
                all_instances = await prov.list()
                for info in all_instances:
                    current[info.name] = info
            except Exception as exc:
                logger.warning(
                    "Failed to list instances from %s: %s", inst.provider, exc
                )

        desired_names: Set[str] = {i.name for i in desired.spec.instances}

        for inst in desired.spec.instances:
            prov = provider_map.get(inst.provider)
            if prov is None:
                continue

            spec = InstanceSpec(
                name=inst.name,
                image=inst.image,
                cpu_cores=inst.cpu,
                memory_mb=inst.memory_mb,
                storage_gb=inst.storage_gb,
                ports=inst.ports,
                env_vars=inst.env,
                labels=inst.labels,
                region=inst.region or desired.metadata.region,
            )

            try:
                existing = current.get(inst.name)

                if existing is None:
                    # Create
                    if not self.dry_run:
                        await prov.create(spec)
                    result.instances_created += 1
                    logger.info(
                        "Would create%s instance: %s",
                        " (dry-run)" if self.dry_run else "",
                        inst.name,
                    )
                else:
                    # Update if drifted
                    needs_update = (
                        abs(existing.spec.cpu_cores - inst.cpu) > 0.1
                        or existing.spec.memory_mb != inst.memory_mb
                        or existing.spec.image != inst.image
                    )
                    if needs_update:
                        if not self.dry_run:
                            await prov.update(existing.id, spec)
                        result.instances_updated += 1
                        logger.info(
                            "Would update%s instance: %s",
                            " (dry-run)" if self.dry_run else "",
                            inst.name,
                        )
                    else:
                        result.instances_unchanged += 1
            except Exception as exc:
                msg = f"Failed to reconcile {inst.name}: {exc}"
                result.errors.append(msg)
                logger.error(msg)

        # Reconcile networks
        docker_client = self._docker_client()
        if docker_client is not None:
            for net in desired.spec.networks:
                try:
                    existing = docker_client.networks.list(names=[net.name])
                    if not existing:
                        if not self.dry_run:
                            ipam = (
                                docker.types.IPAMConfig(
                                    driver="default",
                                    config=[{"subnet": net.cidr}],
                                )
                                if net.cidr
                                else None
                            )
                            docker_client.networks.create(
                                net.name,
                                driver="bridge",
                                ipam=ipam,
                                labels={
                                    "region": net.region,
                                    "manifest": desired.metadata.name,
                                },
                            )
                            logger.info("Created network: %s", net.name)
                    # else: network exists — could validate subnet but Docker doesn't easily expose IPAM config
                except Exception as exc:
                    msg = f"Failed to reconcile network {net.name}: {exc}"
                    result.errors.append(msg)
                    logger.error(msg)

        # Reconcile storage volumes
        if docker_client is not None:
            for vol in desired.spec.storage:
                try:
                    existing = docker_client.volumes.list()
                    found = any(v.name == vol.name for v in existing)
                    if not found:
                        if not self.dry_run:
                            docker_client.volumes.create(
                                vol.name,
                                driver=vol.driver,
                                labels={
                                    "size_gb": str(vol.size_gb),
                                    "region": vol.region,
                                    "manifest": desired.metadata.name,
                                },
                            )
                            logger.info("Created volume: %s", vol.name)
                except Exception as exc:
                    msg = f"Failed to reconcile volume {vol.name}: {exc}"
                    result.errors.append(msg)
                    logger.error(msg)

        result.completed_at = datetime.now(timezone.utc)
        return result

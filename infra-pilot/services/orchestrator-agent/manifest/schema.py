"""Data models for the InfraFile declarative manifest format.

Example ``infra.yaml``::

    api_version: v1
    kind: InfraFile
    metadata:
      name: my-infra
      region: us-east-1
    spec:
      instances:
        - name: web-01
          provider: docker
          image: nginx:latest
          cpu: 1
          memory_mb: 512
          storage_gb: 10
          ports:
            "80/tcp": "8080"
          labels:
            app: web
          health_check:
            type: http
            target: http://localhost:80/health
      networks:
        - name: internal
          cidr: 10.0.0.0/24
      storage:
        - name: data-volume
          size_gb: 50
          driver: local
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class HealthCheckType(str, Enum):
    PING = "ping"
    PORT = "port"
    PROCESS = "process"
    HTTP = "http"
    TCP = "tcp"


@dataclass
class HealthCheckSpec:
    type: HealthCheckType = HealthCheckType.HTTP
    target: str = "http://localhost:80/health"
    interval_seconds: int = 30
    timeout_seconds: int = 10
    retries: int = 3


@dataclass
class InfraInstance:
    name: str
    provider: str = "docker"
    image: str = "ubuntu:22.04"
    cpu: float = 1.0
    memory_mb: int = 512
    storage_gb: int = 10
    ports: Dict[str, str] = field(default_factory=dict)
    env: Dict[str, str] = field(default_factory=dict)
    labels: Dict[str, str] = field(default_factory=dict)
    region: str = ""
    ssh_keys: List[str] = field(default_factory=list)
    user_data: str = ""
    network: str = ""
    health_check: Optional[HealthCheckSpec] = None
    auto_remediate: bool = True
    min_replicas: int = 1
    max_replicas: int = 1
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class InfraNetwork:
    name: str
    cidr: str = "10.0.0.0/24"
    gateway: str = ""
    dns: List[str] = field(default_factory=list)
    vlan_id: Optional[int] = None
    provider: str = "docker"
    region: str = ""


@dataclass
class InfraStorage:
    name: str
    size_gb: int = 10
    driver: str = "local"
    mount_point: str = "/data"
    provider: str = "docker"
    region: str = ""
    replication: int = 1


@dataclass
class InfraFileSpec:
    instances: List[InfraInstance] = field(default_factory=list)
    networks: List[InfraNetwork] = field(default_factory=list)
    storage: List[InfraStorage] = field(default_factory=list)


@dataclass
class InfraFileMetadata:
    name: str = "default"
    region: str = "default"
    project: str = "default"
    environment: str = "production"
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class InfraFile:
    """Top-level manifest representing desired infrastructure state."""

    api_version: str = "v1"
    kind: str = "InfraFile"
    metadata: InfraFileMetadata = field(default_factory=InfraFileMetadata)
    spec: InfraFileSpec = field(default_factory=InfraFileSpec)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InfraFile":
        """Parse a raw dictionary (from YAML/JSON) into typed models."""
        meta_data = data.get("metadata", {})
        spec_data = data.get("spec", {})

        metadata = InfraFileMetadata(
            name=meta_data.get("name", "default"),
            region=meta_data.get("region", "default"),
            project=meta_data.get("project", "default"),
            environment=meta_data.get("environment", "production"),
            labels=meta_data.get("labels", {}),
        )

        instances = []
        for inst in spec_data.get("instances", []):
            hc = inst.get("health_check")
            health_check = HealthCheckSpec(**hc) if hc else None
            instances.append(
                InfraInstance(
                    name=inst.get("name", ""),
                    provider=inst.get("provider", "docker"),
                    image=inst.get("image", "ubuntu:22.04"),
                    cpu=inst.get("cpu", 1.0),
                    memory_mb=inst.get("memory_mb", 512),
                    storage_gb=inst.get("storage_gb", 10),
                    ports=inst.get("ports", {}),
                    env=inst.get("env", {}),
                    labels=inst.get("labels", {}),
                    region=inst.get("region", ""),
                    ssh_keys=inst.get("ssh_keys", []),
                    user_data=inst.get("user_data", ""),
                    network=inst.get("network", ""),
                    health_check=health_check,
                    auto_remediate=inst.get("auto_remediate", True),
                    min_replicas=inst.get("min_replicas", 1),
                    max_replicas=inst.get("max_replicas", 1),
                    metadata=inst.get("metadata", {}),
                )
            )

        networks = [InfraNetwork(**n) for n in spec_data.get("networks", [])]
        storage = [InfraStorage(**s) for s in spec_data.get("storage", [])]

        return cls(
            api_version=data.get("api_version", "v1"),
            kind=data.get("kind", "InfraFile"),
            metadata=metadata,
            spec=InfraFileSpec(
                instances=instances,
                networks=networks,
                storage=storage,
            ),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize back to a plain dictionary."""
        return {
            "api_version": self.api_version,
            "kind": self.kind,
            "metadata": {
                "name": self.metadata.name,
                "region": self.metadata.region,
                "project": self.metadata.project,
                "environment": self.metadata.environment,
                "labels": self.metadata.labels,
            },
            "spec": {
                "instances": [
                    {
                        "name": i.name,
                        "provider": i.provider,
                        "image": i.image,
                        "cpu": i.cpu,
                        "memory_mb": i.memory_mb,
                        "storage_gb": i.storage_gb,
                        "ports": i.ports,
                        "env": i.env,
                        "labels": i.labels,
                        "region": i.region,
                        "ssh_keys": i.ssh_keys,
                        "user_data": i.user_data,
                        "network": i.network,
                        "health_check": (
                            {
                                "type": (
                                    i.health_check.type.value
                                    if isinstance(i.health_check.type, HealthCheckType)
                                    else i.health_check.type
                                ),
                                "target": i.health_check.target,
                                "interval_seconds": i.health_check.interval_seconds,
                                "timeout_seconds": i.health_check.timeout_seconds,
                                "retries": i.health_check.retries,
                            }
                            if i.health_check
                            else None
                        ),
                        "auto_remediate": i.auto_remediate,
                        "min_replicas": i.min_replicas,
                        "max_replicas": i.max_replicas,
                        "metadata": i.metadata,
                    }
                    for i in self.spec.instances
                ],
                "networks": [
                    {
                        "name": n.name,
                        "cidr": n.cidr,
                        "gateway": n.gateway,
                        "dns": n.dns,
                        "vlan_id": n.vlan_id,
                        "provider": n.provider,
                        "region": n.region,
                    }
                    for n in self.spec.networks
                ],
                "storage": [
                    {
                        "name": s.name,
                        "size_gb": s.size_gb,
                        "driver": s.driver,
                        "mount_point": s.mount_point,
                        "provider": s.provider,
                        "region": s.region,
                        "replication": s.replication,
                    }
                    for s in self.spec.storage
                ],
            },
        }

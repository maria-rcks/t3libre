"""Tests for the InfraFile YAML schema."""

import pytest
import yaml
from manifest.schema import (
    HealthCheckType,
    InfraFile,
    InfraInstance,
    InfraNetwork,
    InfraStorage,
)

SAMPLE_YAML = """
api_version: v1
kind: InfraFile
metadata:
  name: production-infra
  region: eu-west-1
  project: myapp
  environment: staging
spec:
  instances:
    - name: api-01
      provider: docker
      image: myapp/api:latest
      cpu: 2
      memory_mb: 2048
      storage_gb: 50
      ports:
        "3000/tcp": "3000"
      env:
        NODE_ENV: staging
      labels:
        tier: backend
      health_check:
        type: http
        target: http://localhost:3000/health
      auto_remediate: true
      min_replicas: 2
      max_replicas: 4

    - name: web-01
      provider: docker
      image: nginx:alpine
      cpu: 0.5
      memory_mb: 256
      storage_gb: 10
      ports:
        "80/tcp": "80"
        "443/tcp": "443"

  networks:
    - name: internal
      cidr: 10.10.0.0/16
      dns:
        - 8.8.8.8
        - 1.1.1.1

  storage:
    - name: data
      size_gb: 100
      driver: ceph
      mount_point: /mnt/data
      replication: 3
"""


class TestInfraFileParsing:
    def test_full_yaml(self):
        raw = yaml.safe_load(SAMPLE_YAML)
        infra = InfraFile.from_dict(raw)
        assert infra.api_version == "v1"
        assert infra.kind == "InfraFile"
        assert infra.metadata.name == "production-infra"
        assert infra.metadata.region == "eu-west-1"
        assert infra.metadata.project == "myapp"
        assert infra.metadata.environment == "staging"

    def test_instances(self):
        raw = yaml.safe_load(SAMPLE_YAML)
        infra = InfraFile.from_dict(raw)
        assert len(infra.spec.instances) == 2

        api = infra.spec.instances[0]
        assert api.name == "api-01"
        assert api.provider == "docker"
        assert api.cpu == 2
        assert api.memory_mb == 2048
        assert api.storage_gb == 50
        assert api.ports == {"3000/tcp": "3000"}
        assert api.env == {"NODE_ENV": "staging"}
        assert api.labels == {"tier": "backend"}
        assert api.auto_remediate is True
        assert api.min_replicas == 2
        assert api.max_replicas == 4
        assert api.health_check is not None
        assert api.health_check.type == HealthCheckType.HTTP
        assert api.health_check.target == "http://localhost:3000/health"

        web = infra.spec.instances[1]
        assert web.name == "web-01"
        assert web.cpu == 0.5

    def test_networks(self):
        raw = yaml.safe_load(SAMPLE_YAML)
        infra = InfraFile.from_dict(raw)
        assert len(infra.spec.networks) == 1
        net = infra.spec.networks[0]
        assert net.name == "internal"
        assert net.cidr == "10.10.0.0/16"
        assert net.dns == ["8.8.8.8", "1.1.1.1"]

    def test_storage(self):
        raw = yaml.safe_load(SAMPLE_YAML)
        infra = InfraFile.from_dict(raw)
        assert len(infra.spec.storage) == 1
        st = infra.spec.storage[0]
        assert st.name == "data"
        assert st.size_gb == 100
        assert st.driver == "ceph"
        assert st.mount_point == "/mnt/data"
        assert st.replication == 3

    def test_minimal_instance(self):
        inst = InfraInstance(name="test")
        assert inst.name == "test"
        assert inst.provider == "docker"
        assert inst.cpu == 1.0
        assert inst.memory_mb == 512
        assert inst.storage_gb == 10

    def test_round_trip(self):
        raw = yaml.safe_load(SAMPLE_YAML)
        infra = InfraFile.from_dict(raw)
        restored = InfraFile.from_dict(infra.to_dict())
        assert restored.metadata.name == infra.metadata.name
        assert len(restored.spec.instances) == len(infra.spec.instances)
        assert restored.spec.instances[0].name == infra.spec.instances[0].name
        assert restored.spec.instances[0].health_check is not None

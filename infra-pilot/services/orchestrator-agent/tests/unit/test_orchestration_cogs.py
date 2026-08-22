"""Tests for actual orchestrator cogs and utilities."""

from datetime import datetime

import pytest
from config import Config
from vps_manager import SAFE_CONTAINER_PATTERN, VPSConfig, VPSManager


class TestVPSConfig:
    def test_vps_config_creation(self):
        cfg = VPSConfig(
            cpu_limit=2.0,
            memory_limit=2048,
            storage_limit=50,
            image="ubuntu:22.04",
            ports={"22/tcp": "2222"},
            env_vars={"FOO": "bar"},
        )
        assert cfg.cpu_limit == 2.0
        assert cfg.memory_limit == 2048
        assert cfg.storage_limit == 50
        assert cfg.image == "ubuntu:22.04"

    def test_vps_config_minimal(self):
        cfg = VPSConfig(
            cpu_limit=0.5,
            memory_limit=512,
            storage_limit=10,
            image="nginx:latest",
            ports={},
            env_vars={},
        )
        assert cfg.cpu_limit == 0.5


class TestSafeContainerName:
    def test_valid_names(self):
        assert SAFE_CONTAINER_PATTERN.fullmatch("my-container")
        assert SAFE_CONTAINER_PATTERN.fullmatch("test123")
        assert SAFE_CONTAINER_PATTERN.fullmatch("a.b_c")

    def test_invalid_names(self):
        assert not SAFE_CONTAINER_PATTERN.fullmatch("-invalid")
        assert not SAFE_CONTAINER_PATTERN.fullmatch("")
        assert not SAFE_CONTAINER_PATTERN.fullmatch("name with spaces")
        assert not SAFE_CONTAINER_PATTERN.fullmatch("a" * 200)


class TestConfigDefaults:
    def test_default_db_port_is_postgresql(self):
        c = Config()
        assert c.DB_PORT == 5432

    def test_default_db_user(self):
        c = Config()
        assert c.DB_USER == "infra_pilot"

    def test_resource_limits(self):
        c = Config()
        assert c.RESOURCE_LIMITS["min_cpu"] == 0.5
        assert c.RESOURCE_LIMITS["max_cpu"] == 4.0
        assert c.RESOURCE_LIMITS["max_memory_mb"] == 8192

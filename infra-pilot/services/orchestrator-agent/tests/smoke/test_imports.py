import importlib


def test_vps_manager_imports():
    module = importlib.import_module("vps_manager")
    assert hasattr(module, "VPSManager")
    assert hasattr(module, "VPSConfig")


def test_config_imports():
    module = importlib.import_module("config")
    assert hasattr(module, "Config")
    assert hasattr(module, "config")


def test_db_module_imports():
    module = importlib.import_module("db")
    assert hasattr(module, "DatabasePool")
    assert hasattr(module, "get_pool")
    assert hasattr(module, "get_sync_connection")


def test_compute_base_imports():
    module = importlib.import_module("compute.base")
    assert hasattr(module, "ComputeProvider")
    assert hasattr(module, "InstanceSpec")


def test_manifest_schema_imports():
    module = importlib.import_module("manifest.schema")
    assert hasattr(module, "InfraFile")


def test_rbac_engine_imports():
    module = importlib.import_module("rbac.engine")
    assert hasattr(module, "RBACEngine")

import os
from pathlib import Path
from unittest.mock import patch, mock_open
import pytest
import yaml


@pytest.fixture(autouse=True)
def clear_map_cache():
    from infra.naming import resolver
    resolver._MAP = resolver.load_map()
    yield


class TestLoadYamlFile:
    def test_load_yaml_file_returns_dict(self, tmp_path):
        from infra.naming.resolver import _load_yaml_file
        p = tmp_path / "test.yaml"
        p.write_text("key: value\nnested: {a: 1}")
        result = _load_yaml_file(p)
        assert result == {"key": "value"}

    def test_load_yaml_file_skips_non_string_values(self, tmp_path):
        from infra.naming.resolver import _load_yaml_file
        p = tmp_path / "test.yaml"
        p.write_text("flag: true\ncount: 3\nlist: [a, b]\nok: fine")
        result = _load_yaml_file(p)
        assert result == {"ok": "fine"}

    def test_load_yaml_file_nonexistent(self):
        from infra.naming.resolver import _load_yaml_file
        assert _load_yaml_file(Path("/nonexistent/file.yaml")) == {}

    def test_load_yaml_file_invalid_yaml(self):
        from infra.naming.resolver import _load_yaml_file
        from io import StringIO
        with patch("builtins.open", return_value=StringIO("{invalid: yaml: :broken")):
            p = Path("/tmp/fake.yaml")
            with patch.object(Path, "exists", return_value=True):
                assert _load_yaml_file(p) == {}

    def test_load_yaml_file_none_path(self):
        from infra.naming.resolver import _load_yaml_file
        assert _load_yaml_file(None) == {}

    def test_load_yaml_file_empty_file(self, tmp_path):
        from infra.naming.resolver import _load_yaml_file
        p = tmp_path / "empty.yaml"
        p.write_text("")
        result = _load_yaml_file(p)
        assert result == {}


class TestLoadBaseMap:
    def test_load_base_map_returns_dict(self):
        from infra.naming.resolver import _load_base_map
        result = _load_base_map()
        assert isinstance(result, dict)
        assert result.get("PROVIDER_MOCK") == "mock-provider"

    def test_load_base_map_file_not_found(self):
        from infra.naming.resolver import _load_base_map, _BASE_MAP_PATH
        with patch.object(Path, "exists", return_value=False):
            assert _load_base_map() == {}

    def test_load_base_map_invalid_yaml(self):
        from infra.naming.resolver import _load_base_map
        with patch("builtins.open", mock_open(read_data="{invalid: yaml: :")) as m:
            with patch.object(Path, "exists", return_value=True):
                assert _load_base_map() == {}


class TestLoadOverrides:
    def test_load_overrides_from_path_returns_dict(self, tmp_path):
        from infra.naming.resolver import _load_overrides_from_path
        p = tmp_path / "overrides.yaml"
        p.write_text("PROVIDER_MOCK: override-provider")
        result = _load_overrides_from_path(Path(str(p)))
        assert result == {"PROVIDER_MOCK": "override-provider"}

    def test_load_overrides_nonexistent_path(self):
        from infra.naming.resolver import _load_overrides_from_path
        assert _load_overrides_from_path(Path("/nonexistent/path.yaml")) == {}

    def test_load_overrides_invalid_yaml(self):
        from infra.naming.resolver import _load_overrides_from_path
        from io import StringIO
        with patch("builtins.open", return_value=StringIO(""""unbalanced quote & invalid: [""")):
            p = Path("/tmp/fake.yaml")
            with patch.object(Path, "exists", return_value=True):
                result = _load_overrides_from_path(p)
                assert result == {}, f"Expected empty dict, got: {result}"

    def test_load_overrides_none_path(self):
        from infra.naming.resolver import _load_overrides_from_path
        assert _load_overrides_from_path(None) == {}


class TestDefaultOverridesPath:
    def test_default_overrides_path_resolves(self):
        from infra.naming.resolver import _default_overrides_path
        path = _default_overrides_path()
        assert isinstance(path, Path)
        assert path.name == "provider_map.yaml"


class TestMergeMaps:
    def test_merge_maps_base_precedence(self):
        from infra.naming.resolver import _merge_maps
        base = {"a": 1, "b": 2}
        overrides = {"b": 3, "c": 4}
        result = _merge_maps(base, overrides)
        assert result == {"a": 1, "b": 3, "c": 4}

    def test_merge_maps_empty_base(self):
        from infra.naming.resolver import _merge_maps
        result = _merge_maps(None, {"a": 1})
        assert result == {"a": 1}

    def test_merge_maps_empty_overrides(self):
        from infra.naming.resolver import _merge_maps
        result = _merge_maps({"a": 1}, None)
        assert result == {"a": 1}

    def test_merge_maps_both_empty(self):
        from infra.naming.resolver import _merge_maps
        assert _merge_maps(None, None) == {}


class TestLoadMap:
    def test_load_map_uses_env_override(self, tmp_path):
        from infra.naming.resolver import load_map
        p = tmp_path / "env_override.yaml"
        p.write_text("PROVIDER_MOCK: env-override")
        with patch.dict(os.environ, {"PROVIDER_CONFIG_OVERRIDE": str(p)}):
            result = load_map()
            assert result.get("PROVIDER_MOCK") == "env-override"

    def test_load_map_default_path(self):
        from infra.naming.resolver import load_map
        result = load_map()
        assert isinstance(result, dict)
        assert "PROVIDER_MOCK" in result


class TestRefreshMap:
    def test_refresh_map_reloads(self):
        from infra.naming import resolver
        old = resolver._MAP
        with patch.object(resolver, "load_map", return_value={"key": "refreshed"}):
            resolver.refresh_map()
            assert resolver._MAP == {"key": "refreshed"}


class TestResolveProvider:
    def test_resolve_known_token(self):
        from infra.naming.resolver import resolve_provider
        assert resolve_provider("PROVIDER_MOCK") == "mock-provider"

    def test_resolve_unknown_token_returns_token(self):
        from infra.naming.resolver import resolve_provider
        assert resolve_provider("UNKNOWN_TOKEN") == "UNKNOWN_TOKEN"

    def test_resolve_empty_token(self):
        from infra.naming.resolver import resolve_provider
        assert resolve_provider("") == ""
        assert resolve_provider(None) is None

    def test_resolve_region_token(self):
        from infra.naming.resolver import resolve_provider
        assert resolve_provider("REGION_MOCK_US_EAST") == "mock-region-us-east"

    def test_resolve_sku_token(self):
        from infra.naming.resolver import resolve_provider
        assert resolve_provider("SKU_MOCK_LARGE") == "mock-sku-large"


class TestCurrentEnv:
    def test_current_env_default(self):
        from infra.naming.resolver import current_env
        assert current_env() == "local"

    def test_current_env_from_env(self):
        from infra.naming.resolver import current_env
        with patch.dict(os.environ, {"TEST_ENV": "ci"}):
            assert current_env() == "ci"

import json
import os
from unittest.mock import patch, mock_open
import pytest


@pytest.fixture(autouse=True)
def clear_env():
    with patch.dict(os.environ, {}, clear=True):
        yield


class TestConfigDefaults:
    def test_default_api_url(self):
        from cli.ipilot.config import DEFAULT_CONFIG

        assert DEFAULT_CONFIG["api_url"] == "http://localhost:3001"

    def test_default_api_url_from_env(self):
        import importlib
        from cli.ipilot import config as cfg

        with patch.dict(
            os.environ, {"IPILOT_API_URL": "http://example.com"}, clear=False
        ):
            importlib.reload(cfg)
            assert cfg.DEFAULT_CONFIG["api_url"] == "http://example.com"
        importlib.reload(cfg)

    def test_default_output_format(self):
        from cli.ipilot.config import DEFAULT_CONFIG

        assert DEFAULT_CONFIG["output_format"] == "table"


class TestLoadConfig:
    def test_load_config_returns_defaults_when_no_file(self, tmp_path):
        config_dir = tmp_path / ".ipilot"
        config_file = config_dir / "config.json"
        with patch("cli.ipilot.config.CONFIG_DIR", str(config_dir)):
            with patch("cli.ipilot.config.CONFIG_FILE", str(config_file)):
                from cli.ipilot.config import load_config

                config = load_config()
                assert config["api_url"] == "http://localhost:3001"

    def test_load_config_merges_with_defaults(self, tmp_path):
        config_dir = tmp_path / ".ipilot"
        config_file = config_dir / "config.json"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps({"api_key": "test-key", "token": "test-token"})
        )
        with patch("cli.ipilot.config.CONFIG_DIR", str(config_dir)):
            with patch("cli.ipilot.config.CONFIG_FILE", str(config_file)):
                from cli.ipilot.config import load_config

                config = load_config()
                assert config["api_key"] == "test-key"
                assert config["token"] == "test-token"
                assert config["api_url"] == "http://localhost:3001"

    def test_load_config_invalid_json(self, tmp_path):
        config_dir = tmp_path / ".ipilot"
        config_file = config_dir / "config.json"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file.write_text("{invalid")
        with patch("cli.ipilot.config.CONFIG_DIR", str(config_dir)):
            with patch("cli.ipilot.config.CONFIG_FILE", str(config_file)):
                from cli.ipilot.config import load_config

                config = load_config()
                assert config["api_url"] == "http://localhost:3001"


class TestSaveConfig:
    def test_save_config_writes_file(self, tmp_path):
        config_dir = tmp_path / ".ipilot"
        config_file = config_dir / "config.json"
        with patch("cli.ipilot.config.CONFIG_DIR", str(config_dir)):
            with patch("cli.ipilot.config.CONFIG_FILE", str(config_file)):
                from cli.ipilot.config import save_config

                save_config({"api_url": "http://test", "api_key": "key"})
                assert config_file.exists()
                data = json.loads(config_file.read_text())
                assert data["api_url"] == "http://test"
                assert data["api_key"] == "key"


class TestGetSetUnset:
    def test_get_returns_value(self):
        with patch("cli.ipilot.config.load_config", return_value={"api_key": "mykey"}):
            from cli.ipilot.config import get

            assert get("api_key") == "mykey"

    def test_get_returns_none_for_missing(self):
        with patch("cli.ipilot.config.load_config", return_value={}):
            from cli.ipilot.config import get

            assert get("nonexistent") is None

    def test_set_key_updates_config(self):
        config = {}

        def fake_save(c):
            config.update(c)

        with patch("cli.ipilot.config.load_config", return_value=config):
            with patch("cli.ipilot.config.save_config", side_effect=fake_save):
                from cli.ipilot.config import set_key

                set_key("api_key", "new-key")
                assert config.get("api_key") == "new-key"

    def test_unset_key_removes_value(self):
        saved = {}
        config = {"api_key": "old-key", "token": "tok"}

        def fake_save(c):
            saved.clear()
            saved.update(c)

        with patch("cli.ipilot.config.load_config", return_value=config):
            with patch("cli.ipilot.config.save_config", side_effect=fake_save):
                from cli.ipilot.config import unset_key

                unset_key("api_key")
                assert "api_key" not in saved
                assert saved["token"] == "tok"

    def test_unset_nonexistent_key_does_nothing(self):
        saved = {}
        config = {"token": "tok"}

        def fake_save(c):
            saved.clear()
            saved.update(c)

        with patch("cli.ipilot.config.load_config", return_value=config):
            with patch("cli.ipilot.config.save_config", side_effect=fake_save):
                from cli.ipilot.config import unset_key

                unset_key("nonexistent")
                assert saved["token"] == "tok"

"""Additional coverage for config profiles, env overrides and error paths."""

import json
import os
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_env():
    with patch.dict(os.environ, {}, clear=True):
        yield


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    directory = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(directory))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(directory / "config.json")
    )
    return directory


class TestLoadConfigProfiles:
    def test_loads_profile_from_file(self, config_dir):
        from cli.ipilot.config import load_config

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config-prod.json").write_text(
            json.dumps({"api_url": "https://prod.example"})
        )
        config = load_config(profile="prod")
        assert config["api_url"] == "https://prod.example"
        assert config["profile"] == "prod"

    def test_profile_set_from_default_config(self, config_dir):
        from cli.ipilot.config import load_config

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config.json").write_text(json.dumps({"profile": "prod"}))
        (config_dir / "config-prod.json").write_text(
            json.dumps({"api_url": "https://prod.example"})
        )
        config = load_config()
        assert config["api_url"] == "https://prod.example"
        assert config["profile"] == "prod"

    def test_missing_profile_file_keeps_defaults(self, config_dir):
        from cli.ipilot.config import load_config

        config = load_config(profile="nope")
        assert config["api_url"] == "http://localhost:3001"
        assert config["profile"] == "nope"

    def test_invalid_profile_json_falls_back(self, config_dir, caplog):
        import logging

        from cli.ipilot.config import load_config

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config-bad.json").write_text("{broken")
        with caplog.at_level(logging.WARNING):
            config = load_config(profile="bad")
        assert config["profile"] == "bad"
        assert "bad" in caplog.text


class TestEnvOverrides:
    def test_env_api_url_overrides_file(self, config_dir):
        from cli.ipilot.config import load_config

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config.json").write_text(
            json.dumps({"api_url": "https://file.example"})
        )
        with patch.dict(os.environ, {"IPILOT_API_URL": "https://env.example"}):
            config = load_config()
        assert config["api_url"] == "https://env.example"

    def test_env_token_and_output_overrides(self, config_dir):
        from cli.ipilot.config import load_config

        with patch.dict(
            os.environ,
            {"IPILOT_TOKEN": "env-token", "IPILOT_OUTPUT": "yaml"},
        ):
            config = load_config()
        assert config["token"] == "env-token"
        assert config["output_format"] == "yaml"


class TestSaveConfigProfiles:
    def test_save_with_profile_writes_profile_file(self, config_dir):
        from cli.ipilot.config import save_config

        save_config({"api_url": "https://x", "token": "t", "profile": "prod"})
        saved = json.loads((config_dir / "config-prod.json").read_text())
        assert saved["api_url"] == "https://x"
        assert "profile" not in saved

    def test_save_preserves_profile_key_in_input(self, config_dir):
        from cli.ipilot.config import save_config

        config = {"api_url": "https://x", "profile": "prod"}
        save_config(config)
        assert config["profile"] == "prod"

    def test_save_io_error_logs(self, config_dir, caplog):
        import logging

        from cli.ipilot.config import save_config

        with patch(
            "cli.ipilot.config.open", side_effect=OSError("denied")
        ), caplog.at_level(logging.ERROR):
            save_config({"api_url": "https://x"})
        assert "Failed to save config" in caplog.text


class TestGetSetUnsetProfiles:
    def test_get_with_profile(self):
        with patch(
            "cli.ipilot.config.load_config",
            return_value={"api_key": "prof-key"},
        ) as mocked:
            from cli.ipilot.config import get

            assert get("api_key", profile="prod") == "prof-key"
            mocked.assert_called_once_with(profile="prod")

    def test_set_key_with_profile_persists(self, config_dir):
        from cli.ipilot.config import set_key

        set_key("api_key", "k", profile="qa")
        saved = json.loads((config_dir / "config-qa.json").read_text())
        assert saved["api_key"] == "k"

    def test_unset_key_with_profile(self, config_dir):
        from cli.ipilot.config import set_key, unset_key

        set_key("api_key", "k", profile="qa")
        unset_key("api_key", profile="qa")
        saved = json.loads((config_dir / "config-qa.json").read_text())
        assert "api_key" not in saved


class TestListAndDeleteProfiles:
    def test_list_profiles(self, config_dir):
        from cli.ipilot.config import list_profiles

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config-prod.json").write_text("{}")
        (config_dir / "config-qa.json").write_text("{}")
        (config_dir / "config.json").write_text("{}")
        (config_dir / "unrelated.txt").write_text("x")
        assert sorted(list_profiles()) == ["prod", "qa"]

    def test_list_profiles_missing_dir_returns_empty(self, config_dir):
        from cli.ipilot.config import list_profiles

        assert list_profiles() == []

    def test_list_profiles_os_error_logs(self, config_dir, caplog):
        import logging
        from unittest.mock import patch

        from cli.ipilot.config import list_profiles

        with patch(
            "cli.ipilot.config.os.listdir", side_effect=OSError("denied")
        ), caplog.at_level(logging.ERROR):
            assert list_profiles() == []
        assert "Failed to list profiles" in caplog.text

    def test_delete_profile_removes_file(self, config_dir):
        from cli.ipilot.config import delete_profile

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config-old.json").write_text("{}")
        delete_profile("old")
        assert not (config_dir / "config-old.json").exists()

    def test_delete_missing_profile_is_noop(self, config_dir):
        from cli.ipilot.config import delete_profile

        delete_profile("ghost")

    def test_delete_profile_os_error(self, config_dir, caplog):
        import logging

        from cli.ipilot.config import delete_profile

        config_dir.mkdir(exist_ok=True)
        (config_dir / "config-prod.json").write_text("{}")
        with patch(
            "cli.ipilot.config.os.remove", side_effect=OSError("denied")
        ), caplog.at_level(logging.ERROR):
            delete_profile("prod")
        assert "Failed to delete profile" in caplog.text


class TestProfilePath:
    def test_profile_path_helpers(self):
        import cli.ipilot.config as cfg

        assert cfg._profile_path(None) == cfg.CONFIG_FILE
        assert cfg._profile_path("x") == cfg._profile_path("x")
        assert cfg._profile_path("x").endswith("config-x.json")

    def test_ensure_config_dir_creates(self, tmp_path, monkeypatch):
        import cli.ipilot.config as cfg

        target = tmp_path / "created-dir"
        monkeypatch.setattr(cfg, "CONFIG_DIR", str(target))
        cfg.ensure_config_dir()
        assert target.is_dir()
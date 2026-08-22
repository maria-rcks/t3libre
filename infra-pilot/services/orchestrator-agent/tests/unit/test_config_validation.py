"""Tests for configuration validation and fail-fast secret checks."""

import logging

import pytest
from config import PLACEHOLDER_SECRETS, Config, config, validate_secrets


class TestValidateSecrets:
    def test_placeholder_db_password_rejected_in_production(self):
        with pytest.raises(RuntimeError, match="DB_PASSWORD"):
            validate_secrets("production", "CHANGE_ME", "real-token")

    def test_placeholder_bot_token_rejected_in_production(self):
        with pytest.raises(RuntimeError, match="DISCORD_BOT_TOKEN"):
            validate_secrets(
                "production", "real-password", "your_discord_bot_token_here"
            )

    def test_missing_db_password_rejected_in_production(self):
        with pytest.raises(RuntimeError, match="DB_PASSWORD"):
            validate_secrets("production", "", "real-token")

    def test_valid_secrets_pass_in_production(self):
        assert validate_secrets("production", "s3cret", "token") == []

    def test_insecure_secrets_only_warn_in_development(self, caplog):
        with caplog.at_level(logging.WARNING, logger="config"):
            insecure = validate_secrets("development", "CHANGE_ME", "")
        assert insecure == ["DB_PASSWORD", "DISCORD_BOT_TOKEN"]
        assert "Insecure or missing secrets" in caplog.text

    def test_all_known_placeholders_are_detected(self):
        for placeholder in PLACEHOLDER_SECRETS:
            with pytest.raises(RuntimeError):
                validate_secrets("production", placeholder, "token")


class TestConfigValidate:
    def test_config_validate_uses_instance_attributes(self, monkeypatch):
        cfg = Config()
        monkeypatch.setattr(cfg, "ENVIRONMENT", "production")
        monkeypatch.setattr(cfg, "DB_PASSWORD", "CHANGE_ME")
        monkeypatch.setattr(cfg, "DISCORD_BOT_TOKEN", "token")
        with pytest.raises(RuntimeError, match="DB_PASSWORD"):
            cfg.validate()

    def test_module_config_validates_in_development_without_raising(self):
        assert isinstance(Config.ENVIRONMENT, str)
        assert isinstance(config.validate(), list)

    def test_config_validate_passes_with_real_values(self, monkeypatch):
        cfg = Config()
        monkeypatch.setattr(cfg, "ENVIRONMENT", "production")
        monkeypatch.setattr(cfg, "DB_PASSWORD", "correct horse battery staple")
        monkeypatch.setattr(cfg, "DISCORD_BOT_TOKEN", "bot-token")
        assert cfg.validate() == []

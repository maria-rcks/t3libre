"""Unit tests for cli.ipilot.core.cli: app creation and client loading."""

from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner


@pytest.fixture
def runner(tmp_path, monkeypatch):
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json")
    )
    yield CliRunner()


class TestCreateApp:
    def test_creates_typer_app_named_ipilot(self):
        from cli.ipilot.core.cli import create_app

        app = create_app()
        assert app.info.name == "ipilot"
        assert "Infra Pilot CLI" in app.info.help

    def test_no_args_shows_help(self, runner):
        from cli.ipilot.core.cli import create_app

        result = runner.invoke(create_app(), [])
        assert "Usage: ipilot" in result.output

    def test_help_exits_zero(self, runner):
        from cli.ipilot.core.cli import create_app

        result = runner.invoke(create_app(), ["--help"])
        assert result.exit_code == 0
        assert "Infra Pilot CLI" in result.output

    def test_callback_sets_output_and_profile(self, runner, monkeypatch):
        import typer

        from cli.ipilot.core.cli import create_app

        app = create_app()

        @app.command()
        def ping(ctx: typer.Context):
            typer.echo(f"output={ctx.obj['output']} profile={ctx.obj['profile']}")

        result = runner.invoke(app, ["--output", "json", "--profile", "prod", "ping"])

        assert result.exit_code == 0
        assert "output=json" in result.output
        assert "profile=prod" in result.output

    def test_callback_defaults_to_configured_output_format(self, runner, tmp_path):
        import json

        import typer

        from cli.ipilot.core.cli import create_app

        config_dir = tmp_path / ".ipilot"
        config_dir.mkdir(exist_ok=True)
        (config_dir / "config.json").write_text(json.dumps({"output_format": "yaml"}))

        app = create_app()

        @app.command()
        def ping(ctx: typer.Context):
            typer.echo(f"output={ctx.obj['output']}")

        result = runner.invoke(app, ["ping"])

        assert result.exit_code == 0
        assert "output=yaml" in result.output


class TestGetClient:
    def test_builds_client_from_config(self, runner, monkeypatch):
        from cli.ipilot.core import cli as core_cli

        captured = {}

        class FakeClient:
            def __init__(self, base_url=None, token=None):
                captured["base_url"] = base_url
                captured["token"] = token

        monkeypatch.setattr("cli.ipilot.core.cli.ApiClient", FakeClient)
        monkeypatch.setattr(
            "cli.ipilot.core.cli.load_config",
            lambda profile=None: {
                "api_url": "https://api.example.com",
                "token": "secret-token",
            },
        )

        ctx = MagicMock()
        ctx.obj.get.return_value = None

        client = core_cli.get_client(ctx)

        assert isinstance(client, FakeClient)
        assert captured["base_url"] == "https://api.example.com"
        assert captured["token"] == "secret-token"

    def test_fallback_url_matches_config_default(self, runner, monkeypatch):
        """The client fallback must never diverge from the config default."""
        from cli.ipilot.config import DEFAULT_API_URL
        from cli.ipilot.core import cli as core_cli

        captured = {}

        class FakeClient:
            def __init__(self, base_url=None, token=None):
                captured["base_url"] = base_url
                captured["token"] = token

        monkeypatch.setattr("cli.ipilot.core.cli.ApiClient", FakeClient)
        monkeypatch.setattr(
            "cli.ipilot.core.cli.load_config",
            lambda profile=None: {},
        )

        ctx = MagicMock()
        ctx.obj.get.return_value = None

        core_cli.get_client(ctx)

        assert captured["base_url"] == DEFAULT_API_URL == "http://localhost:3001"

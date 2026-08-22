"""Unit tests for command auto-discovery and registration."""

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import typer
from typer.testing import CliRunner


@pytest.fixture
def package(tmp_path, monkeypatch):
    """Create an importable package dir with two command modules.

    Returns paths for: package_root, top-level module, nested module.
    """
    root = tmp_path / "fakecmds_x"
    (root / "group").mkdir(parents=True, exist_ok=True)
    (root / "__init__.py").write_text("")
    (root / "simple.py").write_text(
        "import typer\napp = typer.Typer(help='Simple command')\n"
    )
    (root / "group" / "__init__.py").write_text("")
    (root / "group" / "inner.py").write_text("import typer\napp = typer.Typer()\n")
    (root / "plain.py").write_text("NO_APP_HERE = 1\n")
    (root / "broken.py").write_text("raise RuntimeError('boom')\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    return root


class TestRegister:
    def test_register_decorator_stores_app(self):
        from cli.ipilot.core.command_registry import get_registry, register

        app = typer.Typer()
        register("zz_unique_cmd", "help text")(app)
        assert get_registry()["zz_unique_cmd"] is app


class TestDiscoverCommands:
    def _discover(self):
        from cli.ipilot.core.command_registry import discover_commands

        discover_commands("fakecmds_x")
        from cli.ipilot.core.command_registry import get_registry

        return get_registry()

    def test_discovers_top_level_and_nested_apps(self, package):
        registry = self._discover()
        assert "simple" in registry
        assert "group_inner" in registry
        assert "plain" not in registry

    def test_missing_package_logs_warning(self, caplog):
        import logging

        from cli.ipilot.core.command_registry import discover_commands

        with caplog.at_level(logging.WARNING):
            discover_commands("no_such_package_xyz")
        assert "not found" in caplog.text


class TestAttachToApp:
    def test_attaches_discovered_apps(self, package):
        from cli.ipilot.core.command_registry import attach_to_app, discover_commands

        discover_commands("fakecmds_x")
        app = typer.Typer()

        attach_to_app(app)

        result = CliRunner().invoke(app, ["simple", "--help"])
        assert result.exit_code == 0
        assert "Simple command" in result.output

    def test_get_registry_keys_are_typer_apps(self, package):
        from cli.ipilot.core.command_registry import discover_commands, get_registry

        discover_commands("fakecmds_x")
        for name, sub_app in get_registry().items():
            assert isinstance(sub_app, typer.Typer)
            assert name


class TestRegistryWithMainApp:
    def test_main_app_exposes_known_groups(self):
        from cli.ipilot.main import app

        result = CliRunner().invoke(app, ["--help"])
        for command in ("server", "backup", "deploy", "logs", "ssh", "secrets"):
            assert command in result.output
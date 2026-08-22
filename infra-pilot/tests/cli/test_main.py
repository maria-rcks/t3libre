"""Boot smoke test and command-level tests for the ipilot CLI entry point.

The boot smoke test guards against regressions like the historical
``NameError`` at import time (missing ``Optional`` import) that took the
CLI down before it even printed help.
"""

import json

import pytest
from typer.testing import CliRunner

from cli.ipilot.main import app


@pytest.fixture
def runner(tmp_path, monkeypatch):
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json")
    )
    yield CliRunner(), config_dir


class TestBootSmoke:
    def test_app_imports_and_help_exits_zero(self, runner):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["--help"])
        assert result.exit_code == 0
        assert "Infra Pilot CLI" in result.output

    def test_app_exposes_core_commands(self, runner):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["--help"])
        assert result.exit_code == 0
        for command in (
            "login",
            "logout",
            "version",
            "interactive",
            "completion",
            "batch",
            "doctor",
            "benchmark",
            "diagnose",
            "docs",
        ):
            assert command in result.output

    def test_unknown_command_fails(self, runner):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["definitely-not-a-command"])
        assert result.exit_code != 0


class TestVersionCommand:
    def test_version_prints_semver(self, runner):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["version"])
        assert result.exit_code == 0
        assert result.output.startswith("ipilot v")


class TestLogoutCommand:
    def test_logout_clears_persisted_token(self, runner):
        cli_runner, config_dir = runner
        config_dir.mkdir(parents=True, exist_ok=True)
        config_file = config_dir / "config.json"
        config_file.write_text(json.dumps({"token": "abc123"}))

        result = cli_runner.invoke(app, ["logout"])

        assert result.exit_code == 0
        assert "Logged out" in result.output
        persisted = json.loads(config_file.read_text())
        assert "token" not in persisted


class TestLoginCommand:
    def test_login_exchanges_api_key_for_token(self, runner, monkeypatch):
        cli_runner, config_dir = runner

        class FakeClient:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

            def login(self, api_key):
                return {"token": f"token-for-{api_key}"}

        monkeypatch.setattr("cli.ipilot.client.ApiClient", FakeClient)

        result = cli_runner.invoke(app, ["login", "my-api-key"])

        assert result.exit_code == 0
        persisted = json.loads((config_dir / "config.json").read_text())
        assert persisted["token"] == "token-for-my-api-key"

    def test_login_without_api_key_fails(self, runner):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["login"])
        assert result.exit_code != 0


class TestBatchCommand:
    def test_batch_runs_operations_from_yaml(self, runner, tmp_path):
        cli_runner, _ = runner
        batch_file = tmp_path / "batch.yml"
        batch_file.write_text(
            "operations:\n"
            "  - command: version\n"
            "    args: {}\n"
            "  - command: version\n"
            "    args: {}\n"
        )

        result = cli_runner.invoke(app, ["batch", "--file", str(batch_file)])

        assert result.exit_code == 0
        assert result.output.count("Running: ipilot version") == 2

    def test_batch_missing_file_fails_cleanly(self, runner, tmp_path):
        cli_runner, _ = runner
        result = cli_runner.invoke(app, ["batch", "--file", str(tmp_path / "nope.yml")])
        assert result.exit_code == 1
        assert "Error loading batch file" in result.output

    def test_batch_invalid_yaml_fails_cleanly(self, runner, tmp_path):
        cli_runner, _ = runner
        batch_file = tmp_path / "bad.yml"
        batch_file.write_text("operations: [unclosed")

        result = cli_runner.invoke(app, ["batch", "--file", str(batch_file)])

        assert result.exit_code == 1
        assert "Error loading batch file" in result.output


class TestDocsCommand:
    def test_docs_generates_reference_file(self, runner, tmp_path):
        cli_runner, _ = runner
        out_file = tmp_path / "cli-reference.md"

        result = cli_runner.invoke(app, ["docs", "--output", str(out_file)])

        assert result.exit_code == 0
        assert out_file.exists()
        assert "# CLI Reference" in out_file.read_text(encoding="utf-8")


class TestDoctorAliases:
    @staticmethod
    def _install_fake_client(monkeypatch):
        from unittest.mock import MagicMock

        client = MagicMock()
        client.benchmark_server.return_value = {"status": "done"}
        client.benchmark_system.return_value = {"status": "done"}
        client.diagnose_server.return_value = {"status": "done"}
        client.diagnose_system.return_value = {"status": "done"}
        monkeypatch.setattr("cli.ipilot.commands.doctor._get_client", lambda ctx: client)
        return client

    def test_doctor_dispatches_to_doctor_subcommand(self, runner):
        cli_runner, _ = runner

        result = cli_runner.invoke(app, ["doctor", "doctor", "--fix"])

        assert result.exit_code == 0
        assert "Python Version" in result.output

    def test_benchmark_alias_dispatches_to_benchmark_command(self, runner, monkeypatch):
        cli_runner, _ = runner
        client = self._install_fake_client(monkeypatch)

        result = cli_runner.invoke(app, ["benchmark", "--server", "vps-1"])

        assert result.exit_code == 0
        client.benchmark_server.assert_called_once()
        assert "vps-1" in client.benchmark_server.call_args.args

    def test_benchmark_alias_without_server_benchmarks_system(
        self, runner, monkeypatch
    ):
        cli_runner, _ = runner
        client = self._install_fake_client(monkeypatch)

        result = cli_runner.invoke(app, ["benchmark"])

        assert result.exit_code == 0
        client.benchmark_system.assert_called_once()

    def test_diagnose_alias_dispatches_to_diagnose_command(self, runner, monkeypatch):
        cli_runner, _ = runner
        client = self._install_fake_client(monkeypatch)

        result = cli_runner.invoke(app, ["diagnose", "--issue", "disk"])

        assert result.exit_code == 0
        client.diagnose_system.assert_called_once()
        assert client.diagnose_system.call_args.kwargs == {"issue": "disk"}

    def test_diagnose_alias_with_server(self, runner, monkeypatch):
        cli_runner, _ = runner
        client = self._install_fake_client(monkeypatch)

        result = cli_runner.invoke(app, ["diagnose", "--server", "vps-1"])

        assert result.exit_code == 0
        client.diagnose_server.assert_called_once()
        assert client.diagnose_server.call_args.kwargs == {"issue": None}

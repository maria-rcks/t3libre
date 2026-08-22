"""Coverage for interactive mode, completion, batch edge cases and docs."""

import json

import pytest
from typer.testing import CliRunner


@pytest.fixture
def runner(tmp_path, monkeypatch):
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json")
    )
    return CliRunner()


@pytest.fixture
def invoke(runner):
    from cli.ipilot.main import app

    return lambda args, **kwargs: runner.invoke(app, args, **kwargs)


class TestInteractive:
    def test_interactive_exits_on_quit(self, invoke, monkeypatch):
        answers = iter(["version", "q"])
        monkeypatch.setattr(
            "rich.prompt.Prompt.ask", lambda prompt, **kwargs: next(answers)
        )
        result = invoke(["interactive"])
        assert result.exit_code == 0
        assert "ipilot v" in result.output

    def test_interactive_handles_keyboard_interrupt(self, invoke, monkeypatch):
        def ask(prompt, **kwargs):
            raise KeyboardInterrupt()

        monkeypatch.setattr("rich.prompt.Prompt.ask", ask)
        result = invoke(["interactive"])
        assert result.exit_code == 0


class TestCompletion:
    def test_prints_completion_script(self, runner):
        from cli.ipilot.main import app

        result = runner.invoke(app, ["completion", "bash"])
        assert result.exit_code == 0
        assert "_IPILOT_COMPLETE" in result.output

    def test_auto_shell_defaults_to_bash(self, runner):
        from cli.ipilot.main import app

        result = runner.invoke(app, ["completion"])
        assert result.exit_code == 0
        assert "_IPILOT_COMPLETE" in result.output

    def test_install_calls_installer(self, invoke, monkeypatch):
        from unittest.mock import MagicMock

        fake_install = MagicMock(return_value=("zsh", "path"))
        monkeypatch.setattr("typer.completion.install", fake_install)

        result = invoke(["completion", "--install", "zsh"])

        assert result.exit_code == 0
        fake_install.assert_called_once_with("zsh", prog_name="ipilot")


class TestBatchEdgeCases:
    def test_batch_empty_operations_is_noop(self, invoke, tmp_path):
        batch_file = tmp_path / "empty.yml"
        batch_file.write_text("operations: []\n")
        result = invoke(["batch", "--file", str(batch_file)])
        assert result.exit_code == 0
        assert "Running:" not in result.output

    def test_batch_null_yaml_fails_cleanly(self, invoke, tmp_path):
        batch_file = tmp_path / "null.yml"
        batch_file.write_text("---\n")
        result = invoke(["batch", "--file", str(batch_file)])
        assert result.exit_code == 1
        assert "No operations found" in result.output


class TestDocsCommand:
    def test_docs_creates_output_dir(self, runner, tmp_path):
        from cli.ipilot.main import app

        out_dir = tmp_path / "nested" / "docs"
        out_file = out_dir / "reference.md"
        result = runner.invoke(app, ["docs", "--output", str(out_file)])
        assert result.exit_code == 0
        assert out_file.exists()
        content = out_file.read_text(encoding="utf-8")
        assert "# CLI Reference" in content
        assert "```" in content
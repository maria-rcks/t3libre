"""Unit tests for the gitops command group."""

from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner


@pytest.fixture
def client():
    return MagicMock()


@pytest.fixture
def runner(client, monkeypatch, tmp_path):
    from cli.ipilot.commands import gitops

    monkeypatch.setattr(gitops, "_get_client", lambda ctx: client)
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr("cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json"))
    return CliRunner()


@pytest.fixture
def invoke(runner):
    from cli.ipilot.main import app as main_app

    return lambda args, **kwargs: runner.invoke(main_app, args, **kwargs)


def test_export_writes_yaml_file(client, invoke, tmp_path):
    client.list_servers.return_value = [{"id": "srv-1", "name": "web"}]
    client.list_backups.return_value = []
    client.dns_zones.return_value = []
    target = tmp_path / "config.yaml"
    result = invoke(["gitops", "export", "--output", str(target)])
    assert result.exit_code == 0
    assert target.exists()
    content = target.read_text(encoding="utf-8")
    assert "apiVersion: ipilot.io/v1" in content
    assert "srv-1" in content


def test_export_filters_by_server(client, invoke, tmp_path):
    client.list_servers.return_value = [
        {"id": "srv-1", "name": "web"},
        {"id": "srv-2", "name": "db"},
    ]
    client.list_backups.return_value = []
    client.dns_zones.return_value = []
    target = tmp_path / "config.yaml"
    result = invoke(["gitops", "export", "--output", str(target), "--server", "web"])
    assert result.exit_code == 0
    content = target.read_text(encoding="utf-8")
    assert "srv-1" in content
    assert "srv-2" not in content


def test_export_includes_dns_records(client, invoke, tmp_path):
    client.list_servers.return_value = []
    client.list_backups.return_value = []
    client.dns_zones.return_value = [{"id": "zone-1", "name": "example.com"}]
    client.dns_records.return_value = {"records": [{"name": "www"}]}
    target = tmp_path / "config.yaml"
    result = invoke(["gitops", "export", "--output", str(target)])
    assert result.exit_code == 0
    assert "www" in target.read_text(encoding="utf-8")


def test_plan_detects_create_update_delete(client, invoke, tmp_path):
    client.list_servers.return_value = [
        {"name": "existing", "type": "old-type"},
        {"name": "to-remove"},
    ]
    config_file = tmp_path / "plan.yaml"
    config_file.write_text(
        "spec:\n  servers:\n    - name: existing\n      type: new-type\n"
        "    - name: brand-new\n      type: standard\n",
        encoding="utf-8",
    )
    result = invoke(["gitops", "plan", "--file", str(config_file)])
    assert result.exit_code == 0
    out = result.output
    assert "create" in out and "brand-new" in out
    assert "update" in out and "existing" in out
    assert "delete" in out and "to-remove" in out


def test_plan_no_changes(client, invoke, tmp_path):
    client.list_servers.return_value = [{"name": "web", "type": "standard"}]
    config_file = tmp_path / "plan.yaml"
    config_file.write_text("spec:\n  servers:\n    - name: web\n      type: standard\n")
    result = invoke(["gitops", "plan", "--file", str(config_file)])
    assert result.exit_code == 0
    assert "No changes detected" in result.output


def test_plan_missing_file_exits_1(client, invoke, tmp_path):
    result = invoke(["gitops", "plan", "--file", str(tmp_path / "nope.yaml")])
    assert result.exit_code == 1


def test_apply_dry_run(client, invoke, tmp_path):
    config_file = tmp_path / "apply.yaml"
    config_file.write_text("spec:\n  servers:\n    - name: web\n      type: standard\n")
    result = invoke(["gitops", "apply", "--file", str(config_file), "--dry-run"])
    assert result.exit_code == 0
    assert "would_create" in result.output
    client.create_server.assert_not_called()


def test_apply_auto_approve(client, invoke, tmp_path):
    config_file = tmp_path / "apply.yaml"
    config_file.write_text("spec:\n  servers:\n    - name: web\n      type: standard\n")
    client.create_server.return_value = {"id": "srv-1"}
    client.drift_scan.return_value = {}
    result = invoke(["gitops", "apply", "--file", str(config_file), "--auto-approve"])
    assert result.exit_code == 0
    client.create_server.assert_called_once()


def test_apply_cancelled_on_negative_confirm(client, invoke, tmp_path):
    config_file = tmp_path / "apply.yaml"
    config_file.write_text("spec:\n  servers:\n    - name: web\n")
    result = invoke(["gitops", "apply", "--file", str(config_file)], input="n\n")
    assert result.exit_code == 0
    assert "cancelled" in result.output
    client.create_server.assert_not_called()


def test_drift_scan(client, invoke):
    client.drift_scan.return_value = {"drift": []}
    result = invoke(["gitops", "drift", "--scan"])
    assert result.exit_code == 0


def test_drift_list(client, invoke):
    client.drift_list.return_value = {"drift": []}
    result = invoke(["gitops", "drift"])
    assert result.exit_code == 0

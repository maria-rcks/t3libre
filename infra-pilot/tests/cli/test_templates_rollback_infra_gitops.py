"""Unit tests for templates, rollback, server/deploy/logs/backup, inventory and gitops extras."""

import importlib
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

MODULES = [
    "templates",
    "rollback",
    "gitops",
    "inventory",
]


@pytest.fixture
def client():
    return MagicMock()


@pytest.fixture
def runner(client, monkeypatch, tmp_path):
    for mod_name in MODULES:
        module = importlib.import_module(f"cli.ipilot.commands.{mod_name}")
        monkeypatch.setattr(module, "_get_client", lambda ctx: client)
    for mod_name in ("server", "deployment", "logs", "backup"):
        module = importlib.import_module(
            f"cli.ipilot.commands.infrastructure.{mod_name}"
        )
        monkeypatch.setattr(module, "_get_client", lambda ctx: client)
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json")
    )
    return CliRunner()


@pytest.fixture
def invoke(runner):
    from cli.ipilot.main import app as main_app

    return lambda args, **kwargs: runner.invoke(main_app, args, **kwargs)


class TestTemplates:
    def test_list(self, client, invoke):
        client.list_templates.return_value = {"templates": []}
        result = invoke(["templates", "list", "--type", "node"])
        assert result.exit_code == 0
        client.list_templates.assert_called_once_with(template_type="node")

    def test_list_list_response(self, client, invoke):
        client.list_templates.return_value = []
        result = invoke(["templates", "list"])
        assert result.exit_code == 0

    def test_show(self, client, invoke):
        client.get_template.return_value = {"name": "node"}
        result = invoke(["templates", "show", "node"])
        assert result.exit_code == 0
        client.get_template.assert_called_once_with("node")

    def test_deploy_with_vars(self, client, invoke):
        result = invoke(
            ["templates", "deploy", "node", "myapp", "--vars", '{"PORT":"80"}']
        )
        assert result.exit_code == 0
        client.deploy_template.assert_called_once_with(
            "node",
            "myapp",
            server=None,
            variables={"PORT": "80"},
            dry_run=False,
        )

    def test_deploy_loads_vars_file(self, client, invoke, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        (tmp_path / "ipilot-vars.json").write_text('{"DOMAIN": "x.example"}')
        result = invoke(["templates", "deploy", "node", "myapp"])
        assert result.exit_code == 0
        client.deploy_template.assert_called_once_with(
            "node",
            "myapp",
            server=None,
            variables={"DOMAIN": "x.example"},
            dry_run=False,
        )

    def test_deploy_dry_run_with_server(self, client, invoke):
        result = invoke(
            ["templates", "deploy", "node", "myapp", "--server", "srv-1", "--dry-run"]
        )
        assert result.exit_code == 0
        client.deploy_template.assert_called_once_with(
            "node",
            "myapp",
            server="srv-1",
            variables={},
            dry_run=True,
        )

    def test_init(self, client, invoke):
        result = invoke(
            ["templates", "init", "node", "myapp", "--output", "out/dir"]
        )
        assert result.exit_code == 0
        client.init_template.assert_called_once_with(
            "node", "myapp", output_dir="out/dir"
        )

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.templates.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["templates", "list"])
        assert result.exit_code == 0


class TestRollback:
    def test_list(self, client, invoke):
        client.list_changes.return_value = {"changes": []}
        result = invoke(["rollback", "list", "--resource", "server", "--limit", "5"])
        assert result.exit_code == 0
        client.list_changes.assert_called_once_with(resource="server", limit=5)

    def test_list_list_response(self, client, invoke):
        client.list_changes.return_value = []
        result = invoke(["rollback", "list"])
        assert result.exit_code == 0

    def test_undo(self, client, invoke):
        result = invoke(["rollback", "undo", "c-1", "--dry-run"])
        assert result.exit_code == 0
        client.undo_change.assert_called_once_with("c-1", dry_run=True)

    def test_rollback(self, client, invoke):
        result = invoke(
            ["rollback", "rollback", "server", "srv-1", "--version", "v3"]
        )
        assert result.exit_code == 0
        client.rollback_resource.assert_called_once_with(
            "server", "srv-1", version="v3"
        )

    def test_history(self, client, invoke):
        client.get_change_history.return_value = {"history": []}
        result = invoke(
            ["rollback", "history", "--resource", "server", "--id", "srv-1"]
        )
        assert result.exit_code == 0
        client.get_change_history.assert_called_once_with(
            resource_type="server", resource_id="srv-1"
        )

    def test_history_list_response(self, client, invoke):
        client.get_change_history.return_value = []
        result = invoke(["rollback", "history"])
        assert result.exit_code == 0

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.rollback.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["rollback", "list"])
        assert result.exit_code == 0


class TestServerCommands:
    def test_list(self, client, invoke):
        client.list_servers.return_value = {"servers": []}
        result = invoke(["server", "list", "--output", "json"])
        assert result.exit_code == 0
        client.list_servers.assert_called_once()

    def test_list_list_response(self, client, invoke):
        client.list_servers.return_value = []
        result = invoke(["server", "list"])
        assert result.exit_code == 0

    def test_create(self, client, invoke):
        result = invoke(["server", "create", "web", "--type", "node", "--memory", "512"])
        assert result.exit_code == 0
        client.create_server.assert_called_once_with("web", "node", 512)

    def test_delete(self, client, invoke):
        result = invoke(["server", "delete", "srv-1"])
        assert result.exit_code == 0
        client.delete_server.assert_called_once_with("srv-1")

    def test_status(self, client, invoke):
        client.server_status.return_value = {"status": "running"}
        result = invoke(["server", "status", "srv-1"])
        assert result.exit_code == 0
        client.server_status.assert_called_once_with("srv-1")

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.infrastructure.server.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["server", "list"])
        assert result.exit_code == 0


class TestDeploymentCommands:
    def test_deploy(self, client, invoke):
        result = invoke(
            ["deploy", "deploy", "srv-1", "main", "--repo-url", "https://r.git"]
        )
        assert result.exit_code == 0
        client.deploy.assert_called_once_with("srv-1", "main", "https://r.git")

    def test_deploy_with_template(self, client, invoke):
        result = invoke(
            ["deploy", "deploy", "srv-1", "main", "--template", "node"]
        )
        assert result.exit_code == 0
        client.deploy_template.assert_called_once_with(
            "node",
            "srv-1",
            server="srv-1",
            variables={"branch": "main"},
        )

    def test_list(self, client, invoke):
        client._get.return_value = {"deployments": []}
        result = invoke(["deploy", "list", "--server", "srv-1"])
        assert result.exit_code == 0
        client._get.assert_called_once_with("/deployments")

    def test_list_list_response(self, client, invoke):
        client._get.return_value = []
        result = invoke(["deploy", "list"])
        assert result.exit_code == 0

    def test_status(self, client, invoke):
        client._get.return_value = {"status": "ok"}
        result = invoke(["deploy", "status", "d-1"])
        assert result.exit_code == 0
        client._get.assert_called_once_with("/deployments/d-1")

    def test_rollback(self, client, invoke):
        client._post.return_value = {"rolled_back": True}
        result = invoke(["deploy", "rollback", "d-1"])
        assert result.exit_code == 0
        client._post.assert_called_once_with("/deployments/d-1/rollback", {})

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.infrastructure.deployment.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["deploy", "list"])
        assert result.exit_code == 0


class TestLogsCommands:
    def test_fetch(self, client, invoke):
        client.get_logs.return_value = ["line1"]
        result = invoke(["logs", "fetch", "srv-1", "--lines", "100", "--follow"])
        assert result.exit_code == 0
        client.get_logs.assert_called_once_with("srv-1", 100, True)

    def test_fetch_defaults(self, client, invoke):
        client.get_logs.return_value = []
        result = invoke(["logs", "fetch", "srv-1"])
        assert result.exit_code == 0
        client.get_logs.assert_called_once_with("srv-1", 50, False)

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.infrastructure.logs.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["logs", "fetch", "srv-1"])
        assert result.exit_code == 0


class TestBackupCommands:
    def test_list(self, client, invoke):
        client.list_backups.return_value = {"backups": []}
        result = invoke(["backup", "list", "srv-1"])
        assert result.exit_code == 0
        client.list_backups.assert_called_once_with("srv-1")

    def test_list_list_response(self, client, invoke):
        client.list_backups.return_value = []
        result = invoke(["backup", "list"])
        assert result.exit_code == 0

    def test_create(self, client, invoke):
        result = invoke(["backup", "create", "srv-1", "--s3", "bucket:path"])
        assert result.exit_code == 0
        client.create_backup.assert_called_once_with("srv-1", s3_target="bucket:path")

    def test_schedule(self, client, invoke):
        result = invoke(
            [
                "backup",
                "schedule",
                "srv-1",
                "--interval",
                "hourly",
                "--retention",
                "3",
                "--s3",
                "bucket:x",
            ]
        )
        assert result.exit_code == 0
        client._post.assert_called_once_with(
            "/backup-jobs",
            {
                "app_id": "srv-1",
                "name": "auto-srv-1",
                "schedule_type": "hourly",
                "retention_count": 3,
                "s3_target": "bucket:x",
            },
        )

    def test_snapshots(self, client, invoke):
        client._get.return_value = {"snapshots": []}
        result = invoke(["backup", "snapshots", "srv-1"])
        assert result.exit_code == 0
        client._get.assert_called_once_with("/servers/srv-1/snapshots")

    def test_snapshots_list_response(self, client, invoke):
        client._get.return_value = []
        result = invoke(["backup", "snapshots", "srv-1"])
        assert result.exit_code == 0

    def test_snapshots_create(self, client, invoke):
        result = invoke(["backup", "snapshots", "srv-1", "--create"])
        assert result.exit_code == 0
        client._post.assert_called_once_with("/servers/srv-1/snapshots", {})

    def test_snapshots_restore(self, client, invoke):
        result = invoke(["backup", "snapshots", "srv-1", "--restore", "snap-1"])
        assert result.exit_code == 0
        client._post.assert_called_once_with(
            "/servers/srv-1/snapshots/snap-1/restore", {}
        )

    def test_restore(self, client, invoke):
        result = invoke(["backup", "restore", "bk-1", "--target", "srv-2"])
        assert result.exit_code == 0
        client._post.assert_called_once_with(
            "/backups/bk-1/restore", {"target": "srv-2"}
        )

    def test_restore_default_target(self, client, invoke):
        result = invoke(["backup", "restore", "bk-1"])
        assert result.exit_code == 0
        client._post.assert_called_once_with("/backups/bk-1/restore", {})

    def test_config(self, client, invoke):
        result = invoke(
            [
                "backup",
                "config",
                "--s3-bucket",
                "b",
                "--s3-key",
                "k",
                "--s3-secret",
                "s",
                "--s3-endpoint",
                "https://e",
            ]
        )
        assert result.exit_code == 0
        client._post.assert_called_once_with(
            "/backup/config",
            {
                "s3_bucket": "b",
                "s3_key": "k",
                "s3_secret": "s",
                "s3_endpoint": "https://e",
            },
        )

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.infrastructure.backup.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["backup", "list"])
        assert result.exit_code == 0


class TestInventoryExtras:
    def test_list_all_filters(self, client, invoke):
        client.list_inventory.return_value = []
        result = invoke(
            [
                "inventory",
                "list",
                "--tag",
                "t",
                "--environment",
                "e",
                "--region",
                "r",
                "--owner",
                "o",
                "--provider",
                "p",
            ]
        )
        assert result.exit_code == 0
        client.list_inventory.assert_called_once_with(
            tag="t", environment="e", region="r", owner="o", provider="p"
        )

    def test_update_all_metadata_fields(self, client, invoke):
        result = invoke(
            [
                "inventory",
                "update",
                "srv-1",
                "--environment",
                "prod",
                "--region",
                "eu",
                "--provider",
                "aws",
                "--os",
                "ubuntu",
                "--ssh-key",
                "key-1",
            ]
        )
        assert result.exit_code == 0
        _, metadata = client.update_inventory.call_args.args
        assert metadata == {
            "environment": "prod",
            "region": "eu",
            "provider": "aws",
            "os": "ubuntu",
            "ssh_key": "key-1",
        }

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.inventory.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["inventory", "list"])
        assert result.exit_code == 0


class TestGitopsExtras:
    def test_export_reads_existing_file(self, client, invoke, tmp_path):
        client.list_servers.return_value = []
        client.list_backups.return_value = []
        client.dns_zones.return_value = []
        target = tmp_path / "config.yaml"
        target.write_text("old: content\n", encoding="utf-8")
        result = invoke(["gitops", "export", "--output", str(target)])
        assert result.exit_code == 0
        assert target.exists()

    def test_export_dict_server_response(self, client, invoke, tmp_path):
        client.list_servers.return_value = {"servers": [{"id": "srv-1", "name": "web"}]}
        client.list_backups.return_value = {"backups": []}
        client.dns_zones.return_value = []
        target = tmp_path / "config.yaml"
        result = invoke(["gitops", "export", "--output", str(target)])
        assert result.exit_code == 0
        assert "srv-1" in target.read_text(encoding="utf-8")

    def test_plan_invalid_config(self, client, invoke, tmp_path):
        config_file = tmp_path / "bad.yaml"
        config_file.write_text("not: a config\n")
        result = invoke(["gitops", "plan", "--file", str(config_file)])
        assert result.exit_code == 1
        assert "Invalid config file" in result.output

    def test_plan_dict_server_response(self, client, invoke, tmp_path):
        client.list_servers.return_value = {"servers": []}
        config_file = tmp_path / "plan.yaml"
        config_file.write_text(
            "spec:\n  servers:\n    - name: web\n      type: standard\n"
        )
        result = invoke(["gitops", "plan", "--file", str(config_file)])
        assert result.exit_code == 0
        assert "create" in result.output

    def test_apply_missing_file(self, client, invoke, tmp_path):
        result = invoke(["gitops", "apply", "--file", str(tmp_path / "nope.yaml")])
        assert result.exit_code == 1
        assert "Config file not found" in result.output

    def test_apply_invalid_config(self, client, invoke, tmp_path):
        config_file = tmp_path / "bad.yaml"
        config_file.write_text("x: 1\n")
        result = invoke(["gitops", "apply", "--file", str(config_file)])
        assert result.exit_code == 1
        assert "Invalid config file" in result.output

    def test_apply_reports_create_errors(self, client, invoke, tmp_path):
        config_file = tmp_path / "apply.yaml"
        config_file.write_text(
            "spec:\n  servers:\n    - name: web\n      type: standard\n"
        )
        client.create_server.side_effect = [RuntimeError("quota exceeded")]
        client.drift_scan.return_value = {"error": "nope"}
        result = invoke(["gitops", "apply", "--file", str(config_file), "--auto-approve"])
        assert result.exit_code == 0
        assert "error" in result.output

    def test_import_config_delegates_to_export(self, client, invoke, tmp_path):
        client.list_servers.return_value = []
        client.list_backups.return_value = []
        client.dns_zones.return_value = []
        target = tmp_path / "imported.yaml"
        result = invoke(["gitops", "import-config", str(target)])
        assert result.exit_code == 0
        assert target.exists()

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "cli.ipilot.commands.gitops.ApiClient",
            lambda *a, **k: MagicMock(),
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot")
        )
        monkeypatch.setattr(
            "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
        )
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["gitops", "drift"])
        assert result.exit_code == 0
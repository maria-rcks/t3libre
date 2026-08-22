"""Unit tests for the secrets, ssh, plugins, webhooks and apikeys command groups."""

import importlib
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

MODULES = [
    "secrets",
    "ssh",
    "plugins",
    "webhooks",
    "apikeys",
    "templates",
    "rollback",
]


@pytest.fixture
def client():
    return MagicMock()


@pytest.fixture
def runner(client, monkeypatch, tmp_path):
    for mod_name in MODULES:
        module = importlib.import_module(f"cli.ipilot.commands.{mod_name}")
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


def _real_path_invoke(monkeypatch, tmp_path, module, args):
    """Invoke a command without the patched _get_client, covering the real one."""
    monkeypatch.setattr(
        f"cli.ipilot.commands.{module}.ApiClient", lambda *a, **k: MagicMock()
    )
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot"))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
    )
    from cli.ipilot.main import app as main_app

    return CliRunner().invoke(main_app, args)


class TestSecrets:
    def test_list_no_path(self, client, invoke):
        client.list_secrets.return_value = {"secrets": []}
        result = invoke(["secrets", "list"])
        assert result.exit_code == 0
        client.list_secrets.assert_called_once_with(path=None)

    def test_list_with_path_and_list_response(self, client, invoke):
        client.list_secrets.return_value = [{"key": "k1"}]
        result = invoke(["secrets", "list", "--path", "/app/"])
        assert result.exit_code == 0
        client.list_secrets.assert_called_once_with(path="/app/")

    def test_get(self, client, invoke):
        client.get_secret.return_value = {"key": "k1"}
        result = invoke(["secrets", "get", "k1", "--version", "3"])
        assert result.exit_code == 0
        client.get_secret.assert_called_once_with("k1", version=3)

    def test_set(self, client, invoke):
        client.set_secret.return_value = {"key": "k1"}
        result = invoke(
            ["secrets", "set", "k1", "val", "--rotate", "--rotation-days", "30"]
        )
        assert result.exit_code == 0
        client.set_secret.assert_called_once_with(
            "k1", "val", rotate=True, rotation_days=30
        )

    def test_set_defaults(self, client, invoke):
        client.set_secret.return_value = {"key": "k1"}
        result = invoke(["secrets", "set", "k1", "val"])
        assert result.exit_code == 0
        client.set_secret.assert_called_once_with(
            "k1", "val", rotate=False, rotation_days=90
        )

    def test_delete(self, client, invoke):
        client.delete_secret.return_value = {"deleted": True}
        result = invoke(["secrets", "delete", "k1"])
        assert result.exit_code == 0
        client.delete_secret.assert_called_once_with("k1")

    def test_versions(self, client, invoke):
        client.list_secret_versions.return_value = {"versions": [{"v": 1}]}
        result = invoke(["secrets", "versions", "k1"])
        assert result.exit_code == 0
        client.list_secret_versions.assert_called_once_with("k1")

    def test_rotate_key(self, client, invoke):
        client.rotate_secret.return_value = {"rotated": True}
        result = invoke(["secrets", "rotate", "--key", "k1"])
        assert result.exit_code == 0
        client.rotate_secret.assert_called_once_with("k1")

    def test_rotate_all(self, client, invoke):
        client.rotate_all_secrets.return_value = {"rotated": 3}
        result = invoke(["secrets", "rotate", "--all"])
        assert result.exit_code == 0
        client.rotate_all_secrets.assert_called_once()

    def test_rotate_due(self, client, invoke):
        client.list_secrets_due_for_rotation.return_value = [{"key": "k1"}]
        result = invoke(["secrets", "rotate"])
        assert result.exit_code == 0
        client.list_secrets_due_for_rotation.assert_called_once()

    def test_roles_grant(self, client, invoke):
        client.grant_secret_access.return_value = {"granted": True}
        result = invoke(["secrets", "roles", "k1", "--grant", "admin"])
        assert result.exit_code == 0
        client.grant_secret_access.assert_called_once_with("k1", "admin")

    def test_roles_revoke(self, client, invoke):
        client.revoke_secret_access.return_value = {"revoked": True}
        result = invoke(["secrets", "roles", "k1", "--revoke", "admin"])
        assert result.exit_code == 0
        client.revoke_secret_access.assert_called_once_with("k1", "admin")

    def test_roles_list(self, client, invoke):
        client.list_secret_access.return_value = {"roles": ["admin"]}
        result = invoke(["secrets", "roles", "k1"])
        assert result.exit_code == 0
        client.list_secret_access.assert_called_once_with("k1")

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, "secrets", ["secrets", "list"])
        assert result.exit_code == 0


class TestSsh:
    def test_list(self, client, invoke):
        client.list_ssh_sessions.return_value = {"sessions": []}
        result = invoke(["ssh", "list", "--status", "active"])
        assert result.exit_code == 0
        client.list_ssh_sessions.assert_called_once_with(status="active")

    def test_list_list_response(self, client, invoke):
        client.list_ssh_sessions.return_value = [{"id": "s1"}]
        result = invoke(["ssh", "list"])
        assert result.exit_code == 0

    def test_connect(self, client, invoke):
        client.ssh_connect.return_value = {"connected": True}
        result = invoke(
            [
                "ssh",
                "connect",
                "srv-1",
                "--user",
                "admin",
                "--jump",
                "j1",
                "--port",
                "2222",
            ]
        )
        assert result.exit_code == 0
        client.ssh_connect.assert_called_once_with(
            "srv-1", user="admin", jump_host="j1", port=2222
        )

    def test_connect_defaults(self, client, invoke):
        client.ssh_connect.return_value = {}
        result = invoke(["ssh", "connect", "srv-1"])
        assert result.exit_code == 0
        client.ssh_connect.assert_called_once_with(
            "srv-1", user="root", jump_host=None, port=22
        )

    def test_jump_hosts_create(self, client, invoke):
        client.create_jump_host.return_value = {"id": "j1"}
        result = invoke(
            ["ssh", "jump-hosts", "--create", "j1", "--host", "j.host", "--user", "root"]
        )
        assert result.exit_code == 0
        client.create_jump_host.assert_called_once_with("j1", "j.host", "root")

    def test_jump_hosts_create_defaults(self, client, invoke):
        client.create_jump_host.return_value = {"id": "j1"}
        result = invoke(["ssh", "jump-hosts", "--create", "j1"])
        assert result.exit_code == 0
        client.create_jump_host.assert_called_once_with("j1", "j1", "root")

    def test_jump_hosts_list(self, client, invoke):
        client.list_jump_hosts.return_value = []
        result = invoke(["ssh", "jump-hosts"])
        assert result.exit_code == 0
        client.list_jump_hosts.assert_called_once()

    def test_keys_add_from_file(self, client, invoke, tmp_path):
        key_file = tmp_path / "id_rsa.pub"
        key_file.write_text("ssh-rsa AAAABBBB")
        result = invoke(["ssh", "keys", "--add", str(key_file), "--name", "work"])
        assert result.exit_code == 0
        client.add_ssh_key.assert_called_once_with("work", "ssh-rsa AAAABBBB")

    def test_keys_add_inline(self, client, invoke):
        result = invoke(["ssh", "keys", "--add", "ssh-rsa INLINE"])
        assert result.exit_code == 0
        client.add_ssh_key.assert_called_once_with("default", "ssh-rsa INLINE")

    def test_keys_delete(self, client, invoke):
        result = invoke(["ssh", "keys", "--delete", "key-1"])
        assert result.exit_code == 0
        client.delete_ssh_key.assert_called_once_with("key-1")

    def test_keys_list(self, client, invoke):
        client.list_ssh_keys.return_value = []
        result = invoke(["ssh", "keys"])
        assert result.exit_code == 0
        client.list_ssh_keys.assert_called_once()

    def test_record(self, client, invoke):
        client.get_session_recording.return_value = "recording"
        result = invoke(["ssh", "record", "s-1"])
        assert result.exit_code == 0
        client.get_session_recording.assert_called_once_with("s-1")

    def test_saved_add_with_port(self, client, invoke):
        result = invoke(["ssh", "saved", "--add", "web@web.example:2222"])
        assert result.exit_code == 0
        client.save_ssh_host.assert_called_once_with("web", "web.example", 2222)

    def test_saved_add_default_port(self, client, invoke):
        result = invoke(["ssh", "saved", "--add", "web@web.example"])
        assert result.exit_code == 0
        client.save_ssh_host.assert_called_once_with("web", "web.example", 22)

    def test_saved_add_no_at(self, client, invoke):
        result = invoke(["ssh", "saved", "--add", "web"])
        assert result.exit_code == 0
        client.save_ssh_host.assert_called_once_with("web", "web", 22)

    def test_saved_delete(self, client, invoke):
        result = invoke(["ssh", "saved", "--delete", "h-1"])
        assert result.exit_code == 0
        client.delete_saved_host.assert_called_once_with("h-1")

    def test_saved_list(self, client, invoke):
        client.list_saved_hosts.return_value = []
        result = invoke(["ssh", "saved", "--list"])
        assert result.exit_code == 0
        client.list_saved_hosts.assert_called_once()

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, "ssh", ["ssh", "list"])
        assert result.exit_code == 0


class TestPlugins:
    def test_list(self, client, invoke):
        client.list_plugins.return_value = {"plugins": []}
        result = invoke(["plugins", "list", "--installed"])
        assert result.exit_code == 0
        client.list_plugins.assert_called_once_with(installed_only=True)

    def test_list_list_response(self, client, invoke):
        client.list_plugins.return_value = []
        result = invoke(["plugins", "list"])
        assert result.exit_code == 0

    def test_install(self, client, invoke):
        result = invoke(
            ["plugins", "install", "grafana", "--source", "x.zip", "--version", "1.0"]
        )
        assert result.exit_code == 0
        client.install_plugin.assert_called_once_with(
            "grafana", source="x.zip", version="1.0"
        )

    def test_uninstall(self, client, invoke):
        result = invoke(["plugins", "uninstall", "grafana"])
        assert result.exit_code == 0
        client.uninstall_plugin.assert_called_once_with("grafana")

    def test_update_named(self, client, invoke):
        result = invoke(["plugins", "update", "--name", "grafana"])
        assert result.exit_code == 0
        client.update_plugin.assert_called_once_with("grafana")

    def test_update_all(self, client, invoke):
        result = invoke(["plugins", "update", "--all"])
        assert result.exit_code == 0
        client.update_all_plugins.assert_called_once()

    def test_update_lists_updates(self, client, invoke):
        client.list_plugin_updates.return_value = []
        result = invoke(["plugins", "update"])
        assert result.exit_code == 0
        client.list_plugin_updates.assert_called_once()

    def test_info(self, client, invoke):
        result = invoke(["plugins", "info", "grafana"])
        assert result.exit_code == 0
        client.get_plugin_info.assert_called_once_with("grafana")

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, "plugins", ["plugins", "list"])
        assert result.exit_code == 0


class TestWebhooks:
    def test_list(self, client, invoke):
        client.list_webhooks.return_value = {"webhooks": []}
        result = invoke(["webhooks", "list"])
        assert result.exit_code == 0
        client.list_webhooks.assert_called_once()

    def test_list_list_response(self, client, invoke):
        client.list_webhooks.return_value = []
        result = invoke(["webhooks", "list"])
        assert result.exit_code == 0

    def test_create_default_events(self, client, invoke):
        result = invoke(["webhooks", "create", "wh", "https://x/hook"])
        assert result.exit_code == 0
        client.create_webhook.assert_called_once_with(
            name="wh",
            url="https://x/hook",
            events=["deploy", "backup", "alert"],
            secret=None,
        )

    def test_create_custom_events_and_secret(self, client, invoke):
        result = invoke(
            [
                "webhooks",
                "create",
                "wh",
                "https://x/hook",
                "--events",
                "a, b",
                "--secret",
                "s",
            ]
        )
        assert result.exit_code == 0
        client.create_webhook.assert_called_once_with(
            name="wh", url="https://x/hook", events=["a", "b"], secret="s"
        )

    def test_delete(self, client, invoke):
        result = invoke(["webhooks", "delete", "wh-1"])
        assert result.exit_code == 0
        client.delete_webhook.assert_called_once_with("wh-1")

    def test_test_with_id(self, client, invoke):
        result = invoke(["webhooks", "test", "--id", "wh-1", "--event", "deploy"])
        assert result.exit_code == 0
        client.test_webhook.assert_called_once_with("wh-1", event="deploy")

    def test_test_default(self, client, invoke):
        result = invoke(["webhooks", "test"])
        assert result.exit_code == 0
        client.test_webhook.assert_called_once_with(None, event="test")

    def test_logs_with_id(self, client, invoke):
        result = invoke(["webhooks", "logs", "--id", "wh-1"])
        assert result.exit_code == 0
        client.get_webhook_logs.assert_called_once_with("wh-1")

    def test_logs_default(self, client, invoke):
        client.get_webhook_logs.return_value = {"logs": []}
        result = invoke(["webhooks", "logs"])
        assert result.exit_code == 0
        client.get_webhook_logs.assert_called_once_with(None)

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, "webhooks", ["webhooks", "list"])
        assert result.exit_code == 0


class TestApiKeys:
    def test_list(self, client, invoke):
        client.list_api_keys.return_value = {"api_keys": []}
        result = invoke(["apikeys", "list"])
        assert result.exit_code == 0
        client.list_api_keys.assert_called_once()

    def test_list_list_response(self, client, invoke):
        client.list_api_keys.return_value = []
        result = invoke(["apikeys", "list"])
        assert result.exit_code == 0

    def test_create_defaults(self, client, invoke):
        result = invoke(["apikeys", "create", "bot"])
        assert result.exit_code == 0
        client.create_api_key.assert_called_once_with(
            name="bot", role="user", expire_days=None
        )

    def test_create_with_options_shows_key_warning(self, client, invoke):
        client.create_api_key.return_value = {"key": "sk-live-1", "name": "bot"}
        result = invoke(
            ["apikeys", "create", "bot", "--role", "admin", "--expire", "7"]
        )
        assert result.exit_code == 0
        client.create_api_key.assert_called_once_with(
            name="bot", role="admin", expire_days=7
        )
        assert "will not be shown again" in result.output
        assert "sk-live-1" in result.output

    def test_revoke(self, client, invoke):
        result = invoke(["apikeys", "revoke", "key-1"])
        assert result.exit_code == 0
        client.revoke_api_key.assert_called_once_with("key-1")

    def test_get_client_real_path(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, "apikeys", ["apikeys", "list"])
        assert result.exit_code == 0
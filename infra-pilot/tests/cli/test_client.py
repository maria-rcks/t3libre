"""Full coverage unit tests for the ApiClient."""

import json

import pytest
import requests

from cli.ipilot.client import API_PREFIX, ApiClient


class FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(
        self, status_code=200, payload=None, content=b"{}", json_error=None
    ):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self._json_error = json_error

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        return self._payload if self._payload is not None else json.loads(self.content)


@pytest.fixture
def client():
    return ApiClient("http://test.local/")


@pytest.fixture
def session_calls(client, monkeypatch):
    calls = []

    def fake_request(method, url, json=None, timeout=None):
        calls.append((method, url, json, timeout))
        return FakeResponse(payload={"ok": True})

    monkeypatch.setattr(client.session, "request", fake_request)
    return calls


class TestInit:
    def test_strips_trailing_slash(self):
        assert ApiClient("http://x.local/").base_url == "http://x.local"

    def test_sets_default_headers(self, client):
        assert client.session.headers["Content-Type"] == "application/json"
        assert client.session.headers["Accept"] == "application/json"

    def test_sets_auth_header_when_token_given(self):
        client = ApiClient("http://x.local", token="tok123")
        assert client.session.headers["Authorization"] == "Bearer tok123"

    def test_no_auth_header_without_token(self, client):
        assert "Authorization" not in client.session.headers

    def test_headers_returns_copy(self, client):
        headers = client._headers()
        headers["X-Custom"] = "nope"
        assert "X-Custom" not in client.session.headers


class TestRequestSuccess:
    def test_returns_parsed_json(self, client, session_calls):
        result = client._request("GET", "/health")
        assert result == {"ok": True}
        verb, url, body, timeout = session_calls[0]
        assert verb == "GET"
        assert url == "http://test.local/api/health"
        assert body is None
        assert timeout == 30

    def test_sends_json_body(self, client, session_calls):
        client._request("POST", "/apps", {"name": "web"})
        _, _, body, _ = session_calls[0]
        assert body == {"name": "web"}

    def test_empty_content_returns_empty_dict(self, client, monkeypatch):
        monkeypatch.setattr(
            client.session, "request", lambda *a, **k: FakeResponse(content=b"")
        )
        assert client._request("GET", "/health") == {}

    def test_helpers_use_http_verbs(self, client, session_calls):
        client._get("/a")
        client._post("/b", {"x": 1})
        client._put("/c", {"y": 2})
        client._delete("/d")
        verbs = [c[0] for c in session_calls]
        assert verbs == ["GET", "POST", "PUT", "DELETE"]
        assert session_calls[1][1].endswith("/api/b")
        assert session_calls[2][2] == {"y": 2}
        assert session_calls[3][1].endswith("/api/d")

    def test_api_prefix_constant(self):
        assert API_PREFIX == "/api"


class TestRequestErrors:
    @pytest.mark.parametrize(
        "status,payload,expected_fragment",
        [
            (404, {"message": "nope"}, "Not found"),
            (501, {"message": "nope"}, "Not implemented"),
            (500, {"message": "boom"}, "boom"),
        ],
    )
    def test_http_error_returns_error_dict(
        self, client, monkeypatch, status, payload, expected_fragment
    ):
        monkeypatch.setattr(
            client.session,
            "request",
            lambda *a, **k: FakeResponse(status_code=status, payload=payload),
        )
        result = client._request("GET", "/x")
        assert "error" in result
        assert expected_fragment in result["error"]

    def test_http_error_without_json_message(self, client, monkeypatch):
        monkeypatch.setattr(
            client.session,
            "request",
            lambda *a, **k: FakeResponse(
                status_code=500, json_error=json.JSONDecodeError("x", "doc", 0)
            ),
        )
        result = client._request("GET", "/x")
        assert "error" in result

    def test_connection_error(self, client, monkeypatch):
        def boom(*a, **k):
            raise requests.ConnectionError("refused")

        monkeypatch.setattr(client.session, "request", boom)
        result = client._request("GET", "/x")
        assert result["error"].startswith("Connection failed:")

    def test_timeout(self, client, monkeypatch):
        def boom(*a, **k):
            raise requests.Timeout()

        monkeypatch.setattr(client.session, "request", boom)
        result = client._request("GET", "/x")
        assert result["error"] == "Request timed out"


ENDPOINT_CASES = [
    ("login", ("k1",), "POST", "/auth/login", {"api_key": "k1"}),
    ("logout", (), "POST", "/auth/logout", None),
    ("list_servers", (), "GET", "/apps", None),
    ("get_server", ("srv-1",), "GET", "/apps/srv-1", None),
    (
        "create_server",
        ("web", "node", 512),
        "POST",
        "/apps",
        {"name": "web", "type": "node", "memory": 512},
    ),
    ("delete_server", ("srv-1",), "DELETE", "/apps/srv-1", None),
    ("server_status", ("srv-1",), "GET", "/apps/srv-1/status", None),
    (
        "get_logs",
        ("srv-1", 100, True),
        "GET",
        "/apps/srv-1/logs?lines=100&follow=True",
        None,
    ),
    ("list_backups", (), "GET", "/backup-jobs", None),
    ("list_backups", ("srv-1",), "GET", "/backup-jobs?app_id=srv-1", None),
    (
        "create_backup",
        ("srv-1",),
        "POST",
        "/backup-jobs",
        {"app_id": "srv-1", "name": "backup-srv-1", "schedule_type": "manual"},
    ),
    (
        "create_backup",
        ("srv-1", "bucket:path"),
        "POST",
        "/backup-jobs",
        {
            "app_id": "srv-1",
            "name": "backup-srv-1",
            "schedule_type": "manual",
            "s3_target": "bucket:path",
        },
    ),
    (
        "deploy",
        ("srv-1", "main"),
        "POST",
        "/deployments",
        {
            "name": "deploy-srv-1",
            "repoUrl": "srv-1",
            "branch": "main",
            "containerId": "srv-1",
        },
    ),
    (
        "deploy",
        ("srv-1", "dev", "https://repo.example/x.git"),
        "POST",
        "/deployments",
        {
            "name": "deploy-srv-1",
            "repoUrl": "https://repo.example/x.git",
            "branch": "dev",
            "containerId": "srv-1",
        },
    ),
    ("health_check", (), "GET", "/health", None),
    ("dns_zones", (), "GET", "/dns-zones", None),
    ("dns_records", ("zone-1",), "GET", "/dns-zones/zone-1/records", None),
    ("drift_scan", (), "POST", "/drift/scan", None),
    ("drift_list", (), "GET", "/drift/list", None),
    ("list_ssh_sessions", (), "GET", "/ssh/sessions", None),
    ("list_ssh_sessions", ("active",), "GET", "/ssh/sessions?status=active", None),
    (
        "ssh_connect",
        ("srv-1",),
        "POST",
        "/ssh/connect",
        {"server": "srv-1", "user": "root", "port": 22},
    ),
    (
        "ssh_connect",
        ("srv-1", "admin", "jump-1", 2222),
        "POST",
        "/ssh/connect",
        {"server": "srv-1", "user": "admin", "port": 2222, "jump_host": "jump-1"},
    ),
    ("list_jump_hosts", (), "GET", "/ssh/jump-hosts", None),
    (
        "create_jump_host",
        ("j1", "j.example.com", "root"),
        "POST",
        "/ssh/jump-hosts",
        {"name": "j1", "host": "j.example.com", "user": "root"},
    ),
    ("list_ssh_keys", (), "GET", "/ssh/keys", None),
    (
        "add_ssh_key",
        ("my-key", "ssh-rsa AAA"),
        "POST",
        "/ssh/keys",
        {"name": "my-key", "key": "ssh-rsa AAA"},
    ),
    ("delete_ssh_key", ("key-1",), "DELETE", "/ssh/keys/key-1", None),
    ("get_session_recording", ("s-1",), "GET", "/ssh/sessions/s-1/recording", None),
    ("list_saved_hosts", (), "GET", "/ssh/saved-hosts", None),
    (
        "save_ssh_host",
        ("web", "web.example.com", 22),
        "POST",
        "/ssh/saved-hosts",
        {"name": "web", "host": "web.example.com", "port": 22},
    ),
    ("delete_saved_host", ("h-1",), "DELETE", "/ssh/saved-hosts/h-1", None),
    ("list_inventory", (), "GET", "/inventory", None),
    ("get_inventory", ("srv-1",), "GET", "/inventory/srv-1", None),
    (
        "update_inventory",
        ("srv-1", {"owner": "team"}),
        "PATCH",
        "/inventory/srv-1",
        {"owner": "team"},
    ),
    (
        "add_inventory_tag",
        ("srv-1", "prod"),
        "POST",
        "/inventory/srv-1/tags",
        {"tag": "prod"},
    ),
    ("remove_inventory_tag", ("srv-1", "prod"), "DELETE", "/inventory/srv-1/tags/prod", None),
    ("get_inventory_tags", ("srv-1",), "GET", "/inventory/srv-1/tags", None),
    ("list_inventory_tags", (), "GET", "/inventory/tags", None),
    ("list_secrets", (), "GET", "/secrets", None),
    ("list_secrets", ("/app/",), "GET", "/secrets?path=/app/", None),
    ("get_secret", ("my-key",), "GET", "/secrets/my-key", None),
    ("get_secret", ("my-key", 3), "GET", "/secrets/my-key?version=3", None),
    (
        "set_secret",
        ("my-key", "v1", True, 30),
        "POST",
        "/secrets",
        {"key": "my-key", "value": "v1", "rotate": True, "rotation_days": 30},
    ),
    ("delete_secret", ("my-key",), "DELETE", "/secrets/my-key", None),
    ("list_secret_versions", ("my-key",), "GET", "/secrets/my-key/versions", None),
    ("rotate_secret", ("my-key",), "POST", "/secrets/my-key/rotate", None),
    ("rotate_all_secrets", (), "POST", "/secrets/rotate-all", None),
    ("list_secrets_due_for_rotation", (), "GET", "/secrets/due-for-rotation", None),
    (
        "grant_secret_access",
        ("my-key", "admin"),
        "POST",
        "/secrets/my-key/access",
        {"role": "admin"},
    ),
    ("revoke_secret_access", ("my-key", "admin"), "DELETE", "/secrets/my-key/access/admin", None),
    ("list_secret_access", ("my-key",), "GET", "/secrets/my-key/access", None),
    ("list_webhooks", (), "GET", "/webhooks", None),
    (
        "create_webhook",
        ("wh", "https://x/hook", ["deploy"]),
        "POST",
        "/webhooks",
        {"name": "wh", "url": "https://x/hook", "events": ["deploy"]},
    ),
    (
        "create_webhook",
        ("wh", "https://x/hook", ["deploy"], "s3cret"),
        "POST",
        "/webhooks",
        {"name": "wh", "url": "https://x/hook", "events": ["deploy"], "secret": "s3cret"},
    ),
    ("delete_webhook", ("wh-1",), "DELETE", "/webhooks/wh-1", None),
    ("test_webhook", (), "POST", "/webhooks/test", {"event": "test"}),
    ("test_webhook", ("wh-1", "deploy"), "POST", "/webhooks/wh-1/test", {"event": "deploy"}),
    ("get_webhook_logs", (), "GET", "/webhooks/logs", None),
    ("get_webhook_logs", ("wh-1",), "GET", "/webhooks/wh-1/logs", None),
    ("list_api_keys", (), "GET", "/api-keys", None),
    (
        "create_api_key",
        ("deploy-bot",),
        "POST",
        "/api-keys",
        {"name": "deploy-bot", "role": "user"},
    ),
    (
        "create_api_key",
        ("deploy-bot", "admin", 30),
        "POST",
        "/api-keys",
        {"name": "deploy-bot", "role": "admin", "expire_days": 30},
    ),
    ("revoke_api_key", ("key-1",), "DELETE", "/api-keys/key-1", None),
    ("list_plugins", (), "GET", "/plugins", None),
    ("list_plugins", (True,), "GET", "/plugins?installed=true", None),
    ("install_plugin", ("grafana",), "POST", "/plugins/install", {"name": "grafana"}),
    (
        "install_plugin",
        ("grafana", "https://x/grafana.zip", "1.2.3"),
        "POST",
        "/plugins/install",
        {"name": "grafana", "source": "https://x/grafana.zip", "version": "1.2.3"},
    ),
    ("uninstall_plugin", ("grafana",), "POST", "/plugins/grafana/uninstall", None),
    ("update_plugin", ("grafana",), "POST", "/plugins/grafana/update", None),
    ("update_all_plugins", (), "POST", "/plugins/update-all", None),
    ("list_plugin_updates", (), "GET", "/plugins/updates", None),
    ("get_plugin_info", ("grafana",), "GET", "/plugins/grafana", None),
    ("list_templates", (), "GET", "/templates", None),
    ("list_templates", ("node",), "GET", "/templates?type=node", None),
    ("get_template", ("node",), "GET", "/templates/node", None),
    (
        "deploy_template",
        ("node", "myapp"),
        "POST",
        "/templates/deploy",
        {"template": "node", "name": "myapp"},
    ),
    (
        "deploy_template",
        ("node", "myapp", "srv-1", {"PORT": "80"}, True),
        "POST",
        "/templates/deploy",
        {
            "template": "node",
            "name": "myapp",
            "server": "srv-1",
            "variables": {"PORT": "80"},
            "dry_run": True,
        },
    ),
    (
        "init_template",
        ("node", "myapp", "out"),
        "POST",
        "/templates/init",
        {"template": "node", "name": "myapp", "output_dir": "out"},
    ),
    (
        "benchmark_server",
        ("srv-1", 5),
        "POST",
        "/doctor/benchmark/srv-1",
        {"duration": 5},
    ),
    ("benchmark_system", (5,), "POST", "/doctor/benchmark", {"duration": 5}),
    ("diagnose_server", ("srv-1",), "POST", "/doctor/diagnose/srv-1", {}),
    (
        "diagnose_server",
        ("srv-1", "disk"),
        "POST",
        "/doctor/diagnose/srv-1",
        {"issue": "disk"},
    ),
    ("diagnose_system", (), "POST", "/doctor/diagnose", {}),
    ("diagnose_system", ("perf",), "POST", "/doctor/diagnose", {"issue": "perf"}),
    ("list_changes", (), "GET", "/changes?limit=20", None),
    ("list_changes", ("server", 5), "GET", "/changes?limit=5&resource=server", None),
    ("undo_change", ("c-1",), "POST", "/changes/c-1/undo", {"dry_run": False}),
    ("undo_change", ("c-1", True), "POST", "/changes/c-1/undo", {"dry_run": True}),
    (
        "rollback_resource",
        ("server", "srv-1"),
        "POST",
        "/rollback",
        {"resource_type": "server", "resource_id": "srv-1"},
    ),
    (
        "rollback_resource",
        ("server", "srv-1", "v3"),
        "POST",
        "/rollback",
        {"resource_type": "server", "resource_id": "srv-1", "version": "v3"},
    ),
    ("get_change_history", (), "GET", "/changes/history", None),
    (
        "get_change_history",
        ("server", "srv-1"),
        "GET",
        "/changes/history?resource_type=server&resource_id=srv-1",
        None,
    ),
]


class TestEndpoints:
    @pytest.mark.parametrize(
        "method,args,verb,path,body", ENDPOINT_CASES, ids=lambda v: str(v)[:60]
    )
    def test_endpoint(self, client, session_calls, method, args, verb, path, body):
        result = getattr(client, method)(*args)
        assert result == {"ok": True}
        (call_verb, call_url, call_body, _) = session_calls[0]
        assert call_verb == verb
        assert call_url == f"http://test.local{API_PREFIX}{path}"
        assert call_body == body

    def test_list_inventory_filters_skip_falsy(self, client, session_calls):
        client.list_inventory(tag="prod", environment=None, region="")
        _, url, _, _ = session_calls[0]
        assert url == f"http://test.local{API_PREFIX}/inventory?tag=prod"

    def test_list_inventory_multiple_filters(self, client, session_calls):
        client.list_inventory(tag="a", owner="b")
        _, url, _, _ = session_calls[0]
        assert url == f"http://test.local{API_PREFIX}/inventory?tag=a&owner=b"
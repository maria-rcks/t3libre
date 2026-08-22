"""HTTP API client for the Infra Pilot backend.

Provides the ``ApiClient`` class with full coverage of all API endpoints.
"""

import json
import logging
from typing import Any, Dict, List, Optional

import requests

from .core.exceptions import APIError, AuthenticationError, ConnectionError

logger = logging.getLogger(__name__)

API_PREFIX = "/api"
DEFAULT_TIMEOUT = 30


class ApiClient:
    """HTTP API client for Infra Pilot backend.

    Maintains full backward compatibility with existing ``cmd_*`` functions
    while adding session management and better error handling.

    Args:
        base_url: The base URL of the API server.
        token: Optional bearer token for authenticated requests.
    """

    def __init__(self, base_url: str, token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"

    def _headers(self) -> Dict[str, str]:
        """Return a copy of the current session headers.

        Returns:
            A dictionary of HTTP headers.
        """
        return dict(self.session.headers)

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Send an HTTP request to the API.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE, PATCH).
            path: API endpoint path (appended to ``/api``).
            data: Optional JSON-serialisable request body.

        Returns:
            The parsed JSON response, or an error dict on failure.
        """
        url = f"{self.base_url}{API_PREFIX}{path}"
        try:
            resp = self.session.request(method, url, json=data, timeout=DEFAULT_TIMEOUT)
            resp.raise_for_status()
            if resp.content:
                return resp.json()
            return {}
        except requests.HTTPError as exc:
            status = exc.response.status_code
            try:
                msg = exc.response.json().get("message", str(exc))
            except (json.JSONDecodeError, AttributeError):
                msg = str(exc)
            if status == 404:
                logger.warning(
                    "Endpoint not found (404): %s – this endpoint may not be implemented yet",
                    path,
                )
                msg = (
                    f"Not found: {path} – the backend does not implement this endpoint"
                )
            elif status == 501:
                logger.warning(
                    "Not implemented (501): %s – the backend received your request but does not support it",
                    path,
                )
                msg = f"Not implemented: {path} – the backend does not support this operation"
            else:
                logger.warning("HTTP error %s on %s: %s", status, path, msg)
            return {"error": msg}
        except requests.ConnectionError as exc:
            logger.warning("Connection failed: %s", exc)
            return {"error": f"Connection failed: {exc}"}
        except requests.Timeout:
            logger.warning("Request timed out: %s %s", method, path)
            return {"error": "Request timed out"}

    def _get(self, path: str) -> Any:
        """Send a GET request.

        Args:
            path: API endpoint path.

        Returns:
            The parsed JSON response.
        """
        return self._request("GET", path)

    def _post(self, path: str, data: Optional[Dict[str, Any]] = None) -> Any:
        """Send a POST request.

        Args:
            path: API endpoint path.
            data: Optional JSON payload.

        Returns:
            The parsed JSON response.
        """
        return self._request("POST", path, data)

    def _put(self, path: str, data: Optional[Dict[str, Any]] = None) -> Any:
        """Send a PUT request.

        Args:
            path: API endpoint path.
            data: Optional JSON payload.

        Returns:
            The parsed JSON response.
        """
        return self._request("PUT", path, data)

    def _delete(self, path: str) -> Any:
        """Send a DELETE request.

        Args:
            path: API endpoint path.

        Returns:
            The parsed JSON response.
        """
        return self._request("DELETE", path)

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def login(self, api_key: str) -> Any:
        """Authenticate with an API key.

        Args:
            api_key: The API key to authenticate with.

        Returns:
            Response data containing a ``token`` on success.
        """
        return self._request("POST", "/auth/login", {"api_key": api_key})

    def logout(self) -> Any:
        """Invalidate the current session.

        Returns:
            Response data.
        """
        return self._request("POST", "/auth/logout")

    # ------------------------------------------------------------------
    # Server management
    # ------------------------------------------------------------------

    def list_servers(self) -> Any:
        """List all servers."""
        return self._request("GET", "/apps")

    def get_server(self, server_id: str) -> Any:
        """Get details for a specific server.

        Args:
            server_id: The server ID.

        Returns:
            Server details.
        """
        return self._request("GET", f"/apps/{server_id}")

    def create_server(
        self,
        name: str,
        server_type: str,
        memory: Optional[int] = None,
    ) -> Any:
        """Create a new server.

        Args:
            name: Server name.
            server_type: Server type identifier.
            memory: Optional memory limit in MB.

        Returns:
            Created server details.
        """
        return self._request(
            "POST",
            "/apps",
            {"name": name, "type": server_type, "memory": memory},
        )

    def delete_server(self, server_id: str) -> Any:
        """Delete a server.

        Args:
            server_id: The server ID.
        """
        return self._request("DELETE", f"/apps/{server_id}")

    def server_status(self, server_id: str) -> Any:
        """Get server status.

        Args:
            server_id: The server ID.
        """
        return self._request("GET", f"/apps/{server_id}/status")

    def get_logs(self, server_id: str, lines: int = 50, follow: bool = False) -> Any:
        """Fetch server logs.

        Args:
            server_id: The server ID.
            lines: Number of log lines to return.
            follow: Whether to follow (stream) log output.
        """
        return self._request(
            "GET",
            f"/apps/{server_id}/logs?lines={lines}&follow={follow}",
        )

    def list_backups(self, server_id: Optional[str] = None) -> Any:
        """List backups for a server or all backups.

        Args:
            server_id: Optional server ID to filter by.
        """
        path = f"/backup-jobs?app_id={server_id}" if server_id else "/backup-jobs"
        return self._request("GET", path)

    def create_backup(self, server_id: str, s3_target: Optional[str] = None) -> Any:
        """Create a backup of a server.

        Args:
            server_id: The server ID.
            s3_target: Optional S3/Backblaze target for offsite storage.
        """
        data: Dict[str, Any] = {
            "app_id": server_id,
            "name": f"backup-{server_id}",
            "schedule_type": "manual",
        }
        if s3_target:
            data["s3_target"] = s3_target
        return self._request("POST", "/backup-jobs", data)

    def deploy(
        self, server_id: str, branch: str, repo_url: Optional[str] = None
    ) -> Any:
        """Deploy a branch to a server.

        Args:
            server_id: The server ID.
            branch: The branch name to deploy.
            repo_url: Optional git repository URL (fallback to server ID).
        """
        return self._request(
            "POST",
            "/deployments",
            {
                "name": f"deploy-{server_id}",
                "repoUrl": repo_url or server_id,
                "branch": branch,
                "containerId": server_id,
            },
        )

    def health_check(self) -> Any:
        """Check API health."""
        return self._request("GET", "/health")

    def dns_zones(self) -> Any:
        """List DNS zones."""
        return self._request("GET", "/dns-zones")

    def dns_records(self, zone_id: str) -> Any:
        """List DNS records for a zone.

        Args:
            zone_id: The DNS zone ID.
        """
        return self._request("GET", f"/dns-zones/{zone_id}/records")

    def drift_scan(self) -> Any:
        """Run a new configuration drift scan."""
        return self._request("POST", "/drift/scan")

    def drift_list(self) -> Any:
        """List detected configuration drift."""
        return self._request("GET", "/drift/list")

    # ------------------------------------------------------------------
    # SSH Session Management
    # ------------------------------------------------------------------

    def list_ssh_sessions(self, status: Optional[str] = None) -> Any:
        """List SSH sessions."""
        path = "/ssh/sessions"
        if status:
            path += f"?status={status}"
        return self._request("GET", path)

    def ssh_connect(
        self,
        server: str,
        user: str = "root",
        jump_host: Optional[str] = None,
        port: int = 22,
    ) -> Any:
        """Connect to a server via SSH."""
        data = {"server": server, "user": user, "port": port}
        if jump_host:
            data["jump_host"] = jump_host
        return self._request("POST", "/ssh/connect", data)

    def list_jump_hosts(self) -> Any:
        """List SSH jump hosts."""
        return self._request("GET", "/ssh/jump-hosts")

    def create_jump_host(self, name: str, host: str, user: str) -> Any:
        """Create a jump host entry."""
        return self._request(
            "POST", "/ssh/jump-hosts", {"name": name, "host": host, "user": user}
        )

    def list_ssh_keys(self) -> Any:
        """List SSH keys."""
        return self._request("GET", "/ssh/keys")

    def add_ssh_key(self, name: str, key: str) -> Any:
        """Add an SSH key."""
        return self._request("POST", "/ssh/keys", {"name": name, "key": key})

    def delete_ssh_key(self, key_id: str) -> Any:
        """Delete an SSH key."""
        return self._request("DELETE", f"/ssh/keys/{key_id}")

    def get_session_recording(self, session_id: str) -> Any:
        """Get SSH session recording."""
        return self._request("GET", f"/ssh/sessions/{session_id}/recording")

    def list_saved_hosts(self) -> Any:
        """List saved SSH hosts."""
        return self._request("GET", "/ssh/saved-hosts")

    def save_ssh_host(self, name: str, host: str, port: int = 22) -> Any:
        """Save an SSH host."""
        return self._request(
            "POST", "/ssh/saved-hosts", {"name": name, "host": host, "port": port}
        )

    def delete_saved_host(self, host_id: str) -> Any:
        """Delete a saved SSH host."""
        return self._request("DELETE", f"/ssh/saved-hosts/{host_id}")

    # ------------------------------------------------------------------
    # Server Inventory
    # ------------------------------------------------------------------

    def list_inventory(self, **filters) -> Any:
        """List server inventory with filters."""
        params = "&".join(f"{k}={v}" for k, v in filters.items() if v)
        path = f"/inventory?{params}" if params else "/inventory"
        return self._request("GET", path)

    def get_inventory(self, server_id: str) -> Any:
        """Get inventory metadata for a server."""
        return self._request("GET", f"/inventory/{server_id}")

    def update_inventory(self, server_id: str, metadata: Dict[str, Any]) -> Any:
        """Update server inventory metadata."""
        return self._request("PATCH", f"/inventory/{server_id}", metadata)

    def add_inventory_tag(self, server_id: str, tag: str) -> Any:
        """Add a tag to a server."""
        return self._request("POST", f"/inventory/{server_id}/tags", {"tag": tag})

    def remove_inventory_tag(self, server_id: str, tag: str) -> Any:
        """Remove a tag from a server."""
        return self._request("DELETE", f"/inventory/{server_id}/tags/{tag}")

    def get_inventory_tags(self, server_id: str) -> Any:
        """Get tags for a server."""
        return self._request("GET", f"/inventory/{server_id}/tags")

    def list_inventory_tags(self) -> Any:
        """List all inventory tags in use."""
        return self._request("GET", "/inventory/tags")

    # ------------------------------------------------------------------
    # Secret Management
    # ------------------------------------------------------------------

    def list_secrets(self, path: Optional[str] = None) -> Any:
        """List secrets."""
        p = f"/secrets?path={path}" if path else "/secrets"
        return self._request("GET", p)

    def get_secret(self, key: str, version: Optional[int] = None) -> Any:
        """Get a secret value."""
        p = f"/secrets/{key}"
        if version is not None:
            p += f"?version={version}"
        return self._request("GET", p)

    def set_secret(
        self, key: str, value: str, rotate: bool = False, rotation_days: int = 90
    ) -> Any:
        """Set a secret value."""
        return self._request(
            "POST",
            "/secrets",
            {
                "key": key,
                "value": value,
                "rotate": rotate,
                "rotation_days": rotation_days,
            },
        )

    def delete_secret(self, key: str) -> Any:
        """Delete a secret."""
        return self._request("DELETE", f"/secrets/{key}")

    def list_secret_versions(self, key: str) -> Any:
        """List versions of a secret."""
        return self._request("GET", f"/secrets/{key}/versions")

    def rotate_secret(self, key: str) -> Any:
        """Rotate a secret."""
        return self._request("POST", f"/secrets/{key}/rotate")

    def rotate_all_secrets(self) -> Any:
        """Rotate all secrets due for rotation."""
        return self._request("POST", "/secrets/rotate-all")

    def list_secrets_due_for_rotation(self) -> Any:
        """List secrets due for rotation."""
        return self._request("GET", "/secrets/due-for-rotation")

    def grant_secret_access(self, key: str, role: str) -> Any:
        """Grant role access to a secret."""
        return self._request("POST", f"/secrets/{key}/access", {"role": role})

    def revoke_secret_access(self, key: str, role: str) -> Any:
        """Revoke role access from a secret."""
        return self._request("DELETE", f"/secrets/{key}/access/{role}")

    def list_secret_access(self, key: str) -> Any:
        """List roles with access to a secret."""
        return self._request("GET", f"/secrets/{key}/access")

    # ------------------------------------------------------------------
    # Webhook Management
    # ------------------------------------------------------------------

    def list_webhooks(self) -> Any:
        """List webhooks."""
        return self._request("GET", "/webhooks")

    def create_webhook(
        self, name: str, url: str, events: List[str], secret: Optional[str] = None
    ) -> Any:
        """Create a webhook."""
        data = {"name": name, "url": url, "events": events}
        if secret:
            data["secret"] = secret
        return self._request("POST", "/webhooks", data)

    def delete_webhook(self, webhook_id: str) -> Any:
        """Delete a webhook."""
        return self._request("DELETE", f"/webhooks/{webhook_id}")

    def test_webhook(
        self, webhook_id: Optional[str] = None, event: str = "test"
    ) -> Any:
        """Test a webhook."""
        path = f"/webhooks/{webhook_id}/test" if webhook_id else "/webhooks/test"
        return self._request("POST", path, {"event": event})

    def get_webhook_logs(self, webhook_id: Optional[str] = None) -> Any:
        """Get webhook delivery logs."""
        path = f"/webhooks/{webhook_id}/logs" if webhook_id else "/webhooks/logs"
        return self._request("GET", path)

    # ------------------------------------------------------------------
    # API Key Management
    # ------------------------------------------------------------------

    def list_api_keys(self) -> Any:
        """List API keys."""
        return self._request("GET", "/api-keys")

    def create_api_key(
        self, name: str, role: str = "user", expire_days: Optional[int] = None
    ) -> Any:
        """Create an API key."""
        data = {"name": name, "role": role}
        if expire_days:
            data["expire_days"] = expire_days
        return self._request("POST", "/api-keys", data)

    def revoke_api_key(self, key_id: str) -> Any:
        """Revoke an API key."""
        return self._request("DELETE", f"/api-keys/{key_id}")

    # ------------------------------------------------------------------
    # Plugin Management
    # ------------------------------------------------------------------

    def list_plugins(self, installed_only: bool = False) -> Any:
        """List plugins."""
        path = "/plugins?installed=true" if installed_only else "/plugins"
        return self._request("GET", path)

    def install_plugin(
        self, name: str, source: Optional[str] = None, version: Optional[str] = None
    ) -> Any:
        """Install a plugin."""
        data = {"name": name}
        if source:
            data["source"] = source
        if version:
            data["version"] = version
        return self._request("POST", "/plugins/install", data)

    def uninstall_plugin(self, name: str) -> Any:
        """Uninstall a plugin."""
        return self._request("POST", f"/plugins/{name}/uninstall")

    def update_plugin(self, name: str) -> Any:
        """Update a plugin."""
        return self._request("POST", f"/plugins/{name}/update")

    def update_all_plugins(self) -> Any:
        """Update all plugins."""
        return self._request("POST", "/plugins/update-all")

    def list_plugin_updates(self) -> Any:
        """List available plugin updates."""
        return self._request("GET", "/plugins/updates")

    def get_plugin_info(self, name: str) -> Any:
        """Get plugin info."""
        return self._request("GET", f"/plugins/{name}")

    # ------------------------------------------------------------------
    # Deployment Templates
    # ------------------------------------------------------------------

    def list_templates(self, template_type: Optional[str] = None) -> Any:
        """List deployment templates."""
        path = f"/templates?type={template_type}" if template_type else "/templates"
        return self._request("GET", path)

    def get_template(self, template: str) -> Any:
        """Get template details."""
        return self._request("GET", f"/templates/{template}")

    def deploy_template(
        self,
        template: str,
        name: str,
        server: Optional[str] = None,
        variables: Optional[Dict[str, Any]] = None,
        dry_run: bool = False,
    ) -> Any:
        """Deploy a template."""
        data = {"template": template, "name": name}
        if server:
            data["server"] = server
        if variables:
            data["variables"] = variables
        if dry_run:
            data["dry_run"] = True
        return self._request("POST", "/templates/deploy", data)

    def init_template(self, template: str, name: str, output_dir: str = ".") -> Any:
        """Initialize a project from a template."""
        return self._request(
            "POST",
            "/templates/init",
            {"template": template, "name": name, "output_dir": output_dir},
        )

    # ------------------------------------------------------------------
    # Doctor / Benchmark / Diagnose
    # ------------------------------------------------------------------

    def benchmark_server(self, server: str, duration: int = 10) -> Any:
        """Benchmark a server."""
        return self._request(
            "POST", f"/doctor/benchmark/{server}", {"duration": duration}
        )

    def benchmark_system(self, duration: int = 10) -> Any:
        """Benchmark the local system."""
        return self._request("POST", "/doctor/benchmark", {"duration": duration})

    def diagnose_server(self, server: str, issue: Optional[str] = None) -> Any:
        """Diagnose a server."""
        data = {}
        if issue:
            data["issue"] = issue
        return self._request("POST", f"/doctor/diagnose/{server}", data)

    def diagnose_system(self, issue: Optional[str] = None) -> Any:
        """Diagnose the local system."""
        data = {}
        if issue:
            data["issue"] = issue
        return self._request("POST", "/doctor/diagnose", data)

    # ------------------------------------------------------------------
    # Rollback / Change History
    # ------------------------------------------------------------------

    def list_changes(self, resource: Optional[str] = None, limit: int = 20) -> Any:
        """List recent changes."""
        params = f"?limit={limit}"
        if resource:
            params += f"&resource={resource}"
        return self._request("GET", f"/changes{params}")

    def undo_change(self, change_id: str, dry_run: bool = False) -> Any:
        """Undo a change."""
        return self._request("POST", f"/changes/{change_id}/undo", {"dry_run": dry_run})

    def rollback_resource(
        self, resource_type: str, resource_id: str, version: Optional[str] = None
    ) -> Any:
        """Rollback a resource."""
        data = {"resource_type": resource_type, "resource_id": resource_id}
        if version:
            data["version"] = version
        return self._request("POST", "/rollback", data)

    def get_change_history(
        self, resource_type: Optional[str] = None, resource_id: Optional[str] = None
    ) -> Any:
        """Get change history."""
        params = []
        if resource_type:
            params.append(f"resource_type={resource_type}")
        if resource_id:
            params.append(f"resource_id={resource_id}")
        qs = "&".join(params)
        path = f"/changes/history?{qs}" if qs else "/changes/history"
        return self._request("GET", path)

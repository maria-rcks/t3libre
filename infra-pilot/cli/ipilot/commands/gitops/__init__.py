"""Infrastructure as Code (GitOps) - YAML configs, apply, plan, drift detection."""

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import typer
import yaml

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Infrastructure as Code (GitOps) commands")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def export(
    ctx: typer.Context,
    output: str = typer.Option(
        "ipilot-config.yaml", "--output", "-o", help="Output YAML file"
    ),
    server: Optional[str] = typer.Option(
        None, "--server", "-s", help="Export specific server"
    ),
):
    """Export all infrastructure config as YAML (GitOps)."""
    client = _get_client(ctx)
    config_data: Dict[str, Any] = {
        "apiVersion": "ipilot.io/v1",
        "kind": "InfrastructureConfig",
        "metadata": {
            "generated": datetime.utcnow().isoformat(),
            "tool": "ipilot",
        },
        "spec": {
            "servers": [],
            "backups": [],
            "deployments": [],
            "dns": [],
            "monitoring": [],
        },
    }

    servers = client.list_servers()
    if isinstance(servers, dict):
        servers = servers.get("servers", servers)
    if isinstance(servers, list):
        for srv in servers:
            if server and srv.get("id") != server and srv.get("name") != server:
                continue
            config_data["spec"]["servers"].append(srv)

    if not server:
        backups = client.list_backups()
        if isinstance(backups, dict):
            backups = backups.get("backups", backups)
        if isinstance(backups, list):
            config_data["spec"]["backups"] = backups

        dns_zones = client.dns_zones()
        if isinstance(dns_zones, list):
            for zone in dns_zones:
                zone_data = dict(zone)
                zone_data["records"] = client.dns_records(zone.get("id"))
                if isinstance(zone_data["records"], dict):
                    zone_data["records"] = zone_data["records"].get("records", [])
                config_data["spec"]["dns"].append(zone_data)

    existing = ""
    if os.path.exists(output):
        with open(output, encoding="utf-8") as f:
            existing = f.read()

    with open(output, "w", encoding="utf-8") as f:
        yaml.dump(config_data, f, default_flow_style=False, sort_keys=False)

    print_output(
        {
            "status": "exported",
            "file": output,
            "servers": len(config_data["spec"]["servers"]),
        },
        ctx.obj.get("output", "table"),
    )


@app.command()
def plan(
    ctx: typer.Context,
    file: str = typer.Option(
        "ipilot-config.yaml", "--file", "-f", help="YAML config file"
    ),
):
    """Show diff between current infra and YAML config (plan)."""
    client = _get_client(ctx)

    if not os.path.exists(file):
        print_output({"error": f"Config file not found: {file}"}, "plain")
        raise typer.Exit(code=1)

    with open(file, encoding="utf-8") as f:
        desired = yaml.safe_load(f)

    if not desired or "spec" not in desired:
        print_output({"error": "Invalid config file"}, "plain")
        raise typer.Exit(code=1)

    changes: List[Dict[str, str]] = []
    current_servers = client.list_servers()
    if isinstance(current_servers, dict):
        current_servers = current_servers.get("servers", [])

    current_names = {s.get("name") for s in current_servers}
    desired_servers = desired.get("spec", {}).get("servers", [])

    for ds in desired_servers:
        name = ds.get("name")
        if name not in current_names:
            changes.append({"action": "create", "resource": "server", "name": name})
        else:
            for cs in current_servers:
                if cs.get("name") == name:
                    diff_keys = []
                    for k in ("type", "memory", "status"):
                        if k in ds and ds[k] != cs.get(k):
                            diff_keys.append(k)
                    if diff_keys:
                        changes.append(
                            {
                                "action": "update",
                                "resource": "server",
                                "name": name,
                                "fields": ",".join(diff_keys),
                            }
                        )
                    break

    for cs in current_servers:
        name = cs.get("name")
        if name not in {ds.get("name") for ds in desired_servers}:
            changes.append({"action": "delete", "resource": "server", "name": name})

    if not changes:
        print_output(
            {"message": "No changes detected. Infrastructure is up-to-date."}, "plain"
        )
        return

    print_output(changes, "table")


@app.command()
def apply(
    ctx: typer.Context,
    file: str = typer.Option(
        "ipilot-config.yaml", "--file", "-f", help="YAML config file"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would change without applying"
    ),
    auto_approve: bool = typer.Option(
        False, "--auto-approve", "-y", help="Skip confirmation prompt"
    ),
):
    """Apply YAML config to infrastructure (GitOps)."""
    client = _get_client(ctx)

    if not os.path.exists(file):
        print_output({"error": f"Config file not found: {file}"}, "plain")
        raise typer.Exit(code=1)

    with open(file, encoding="utf-8") as f:
        desired = yaml.safe_load(f)

    if not desired or "spec" not in desired:
        print_output({"error": "Invalid config file"}, "plain")
        raise typer.Exit(code=1)

    desired_servers = desired.get("spec", {}).get("servers", [])

    if dry_run:
        for ds in desired_servers:
            print_output({"action": "would_create", "server": ds.get("name")}, "plain")
        return

    if not auto_approve:
        typer.echo(f"About to apply {len(desired_servers)} server(s) from {file}")
        typer.echo("Review the plan first with: ipilot gitops plan --file " + file)
        confirm = typer.confirm("Are you sure you want to apply?")
        if not confirm:
            print_output({"status": "cancelled"}, "plain")
            return

    results = []
    for ds in desired_servers:
        try:
            result = client.create_server(
                name=ds.get("name", "unknown"),
                server_type=ds.get("type", "standard"),
                memory=ds.get("memory"),
            )
            results.append(
                {"server": ds.get("name"), "status": "created", "result": str(result)}
            )
        except Exception as e:
            results.append(
                {"server": ds.get("name"), "status": "error", "error": str(e)}
            )

    drift_result = client.drift_scan()
    if isinstance(drift_result, dict) and "error" not in drift_result:
        results.append({"server": "system", "status": "drift_scan_completed"})

    print_output(results, ctx.obj.get("output", "table"))


@app.command()
def drift(
    ctx: typer.Context,
    scan: bool = typer.Option(False, "--scan", help="Run a new drift scan"),
):
    """Detect configuration drift between desired and actual state."""
    client = _get_client(ctx)

    if scan:
        result = client.drift_scan()
        print_output(result, ctx.obj.get("output", "table"))
        return

    result = client.drift_list()
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def import_config(
    ctx: typer.Context,
    file: str = typer.Argument(..., help="YAML file to import"),
    plan_only: bool = typer.Option(
        False, "--plan-only", help="Only show plan, don't apply"
    ),
):
    """Import infrastructure config from a YAML file."""
    return export(ctx, output=file)

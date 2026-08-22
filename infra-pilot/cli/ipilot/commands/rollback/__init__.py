"""Undo/Rollback - Revert infrastructure changes."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Undo/rollback infrastructure changes")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    resource: Optional[str] = typer.Option(
        None, "--resource", "-r", help="Resource type (server, deploy, config)"
    ),
    limit: int = typer.Option(20, "--limit", "-l", help="Number of changes to show"),
):
    """List recent changes available for rollback."""
    client = _get_client(ctx)
    result = client.list_changes(resource=resource, limit=limit)
    data = (
        result if isinstance(result, builtins.list) else result.get("changes", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def undo(
    ctx: typer.Context,
    change_id: str = typer.Argument(..., help="Change ID to undo"),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be undone without executing"
    ),
):
    """Undo a specific change."""
    client = _get_client(ctx)
    result = client.undo_change(change_id, dry_run=dry_run)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def rollback(
    ctx: typer.Context,
    resource_type: str = typer.Argument(
        ..., help="Resource type to rollback (server, deploy, config)"
    ),
    resource_id: str = typer.Argument(..., help="Resource ID"),
    version: Optional[str] = typer.Option(
        None, "--version", "-v", help="Version/timestamp to rollback to"
    ),
):
    """Rollback a resource to a previous version."""
    client = _get_client(ctx)
    result = client.rollback_resource(resource_type, resource_id, version=version)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def history(
    ctx: typer.Context,
    resource_type: Optional[str] = typer.Option(
        None, "--resource", "-r", help="Resource type"
    ),
    resource_id: Optional[str] = typer.Option(None, "--id", help="Resource ID"),
):
    """View change history."""
    client = _get_client(ctx)
    result = client.get_change_history(
        resource_type=resource_type, resource_id=resource_id
    )
    data = (
        result if isinstance(result, builtins.list) else result.get("history", result)
    )
    print_output(data, ctx.obj.get("output", "table"))

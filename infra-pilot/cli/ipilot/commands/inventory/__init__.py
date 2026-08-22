"""Server Inventory - Metadata, tags, environment tracking."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Server inventory management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    tag: Optional[str] = typer.Option(None, "--tag", "-t", help="Filter by tag"),
    environment: Optional[str] = typer.Option(
        None,
        "--environment",
        "-e",
        help="Filter by environment (production, staging, dev)",
    ),
    region: Optional[str] = typer.Option(
        None, "--region", "-r", help="Filter by region"
    ),
    owner: Optional[str] = typer.Option(None, "--owner", "-o", help="Filter by owner"),
    provider: Optional[str] = typer.Option(
        None, "--provider", "-p", help="Filter by provider"
    ),
    output: Optional[str] = typer.Option(None, "--output", "-o", help="Output format"),
):
    """List servers with inventory metadata.

    Examples:
        ipilot inventory list --tag production
        ipilot inventory list --environment staging --region us-east
    """
    client = _get_client(ctx)
    params = {}
    if tag:
        params["tag"] = tag
    if environment:
        params["environment"] = environment
    if region:
        params["region"] = region
    if owner:
        params["owner"] = owner
    if provider:
        params["provider"] = provider

    result = client.list_inventory(**params)
    data = (
        result if isinstance(result, builtins.list) else result.get("inventory", result)
    )
    print_output(data, output or ctx.obj.get("output", "table"))


@app.command()
def show(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
):
    """Show detailed inventory metadata for a server."""
    client = _get_client(ctx)
    result = client.get_inventory(server)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def update(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    owner: Optional[str] = typer.Option(None, "--owner", "-o", help="Owner name"),
    environment: Optional[str] = typer.Option(
        None, "--environment", "-e", help="Environment"
    ),
    region: Optional[str] = typer.Option(None, "--region", "-r", help="Region"),
    provider: Optional[str] = typer.Option(
        None, "--provider", "-p", help="Cloud provider"
    ),
    os_version: Optional[str] = typer.Option(None, "--os", help="OS version"),
    cost: Optional[float] = typer.Option(None, "--cost", "-c", help="Monthly cost"),
    tags: Optional[str] = typer.Option(None, "--tags", help="Comma-separated tags"),
    ssh_key: Optional[str] = typer.Option(None, "--ssh-key", help="SSH key name"),
):
    """Update server inventory metadata."""
    client = _get_client(ctx)
    metadata = {}
    if owner:
        metadata["owner"] = owner
    if environment:
        metadata["environment"] = environment
    if region:
        metadata["region"] = region
    if provider:
        metadata["provider"] = provider
    if os_version:
        metadata["os"] = os_version
    if cost is not None:
        metadata["cost"] = cost
    if tags:
        metadata["tags"] = [t.strip() for t in tags.split(",")]
    if ssh_key:
        metadata["ssh_key"] = ssh_key

    result = client.update_inventory(server, metadata)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def tags(
    ctx: typer.Context,
    list: bool = typer.Option(False, "--list", "-l", help="List all tags in use"),
    server: Optional[str] = typer.Option(
        None, "--server", "-s", help="Show tags for a server"
    ),
    add: Optional[str] = typer.Option(
        None, "--add", help="Add tag to server (format: server:tag)"
    ),
    remove: Optional[str] = typer.Option(
        None, "--remove", help="Remove tag from server (format: server:tag)"
    ),
):
    """Manage inventory tags."""
    client = _get_client(ctx)
    if add and ":" in add:
        srv, tag = add.split(":", 1)
        result = client.add_inventory_tag(srv, tag)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if remove and ":" in remove:
        srv, tag = remove.split(":", 1)
        result = client.remove_inventory_tag(srv, tag)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if server:
        result = client.get_inventory_tags(server)
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_inventory_tags()
    print_output(result, ctx.obj.get("output", "table"))

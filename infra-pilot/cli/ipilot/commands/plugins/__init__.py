"""Plugin System - Plugin management."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Plugin management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    installed: bool = typer.Option(
        False, "--installed", help="Show only installed plugins"
    ),
):
    """List available and installed plugins."""
    client = _get_client(ctx)
    result = client.list_plugins(installed_only=installed)
    data = (
        result if isinstance(result, builtins.list) else result.get("plugins", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def install(
    ctx: typer.Context,
    name: str = typer.Argument(..., help="Plugin name"),
    source: Optional[str] = typer.Option(
        None, "--source", "-s", help="Plugin source (URL or path)"
    ),
    version: Optional[str] = typer.Option(
        None, "--version", "-v", help="Plugin version"
    ),
):
    """Install a plugin."""
    client = _get_client(ctx)
    result = client.install_plugin(name, source=source, version=version)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def uninstall(
    ctx: typer.Context,
    name: str = typer.Argument(..., help="Plugin name"),
):
    """Uninstall a plugin."""
    client = _get_client(ctx)
    result = client.uninstall_plugin(name)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def update(
    ctx: typer.Context,
    name: Optional[str] = typer.Option(
        None, "--name", "-n", help="Plugin name to update"
    ),
    all: bool = typer.Option(False, "--all", help="Update all plugins"),
):
    """Update plugins."""
    client = _get_client(ctx)
    if name:
        result = client.update_plugin(name)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if all:
        result = client.update_all_plugins()
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_plugin_updates()
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def info(
    ctx: typer.Context,
    name: str = typer.Argument(..., help="Plugin name"),
):
    """Show plugin details."""
    client = _get_client(ctx)
    result = client.get_plugin_info(name)
    print_output(result, ctx.obj.get("output", "table"))

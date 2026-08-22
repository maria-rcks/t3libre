"""Secret Management - Encrypted store, versioning, rotation, RBAC."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Secret management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    path: Optional[str] = typer.Option(None, "--path", "-p", help="Secret path prefix"),
):
    """List secrets."""
    client = _get_client(ctx)
    result = client.list_secrets(path=path)
    data = (
        result if isinstance(result, builtins.list) else result.get("secrets", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def get(
    ctx: typer.Context,
    key: str = typer.Argument(..., help="Secret key"),
    version: Optional[int] = typer.Option(
        None, "--version", "-v", help="Specific version"
    ),
):
    """Get a secret value."""
    client = _get_client(ctx)
    result = client.get_secret(key, version=version)
    print_output(result, ctx.obj.get("output", "plain"))


@app.command()
def set(
    ctx: typer.Context,
    key: str = typer.Argument(..., help="Secret key"),
    value: str = typer.Argument(..., help="Secret value"),
    rotate: bool = typer.Option(False, "--rotate", help="Mark for automatic rotation"),
    rotation_days: int = typer.Option(
        90, "--rotation-days", help="Rotation interval in days"
    ),
):
    """Set a secret value (creates new version)."""
    client = _get_client(ctx)
    result = client.set_secret(key, value, rotate=rotate, rotation_days=rotation_days)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def delete(
    ctx: typer.Context,
    key: str = typer.Argument(..., help="Secret key"),
):
    """Delete a secret."""
    client = _get_client(ctx)
    result = client.delete_secret(key)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def versions(
    ctx: typer.Context,
    key: str = typer.Argument(..., help="Secret key"),
):
    """List versions of a secret."""
    client = _get_client(ctx)
    result = client.list_secret_versions(key)
    data = (
        result if isinstance(result, builtins.list) else result.get("versions", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def rotate(
    ctx: typer.Context,
    key: Optional[str] = typer.Option(
        None, "--key", "-k", help="Rotate a specific secret"
    ),
    all: bool = typer.Option(
        False, "--all", help="Rotate all secrets due for rotation"
    ),
):
    """Rotate secrets."""
    client = _get_client(ctx)
    if key:
        result = client.rotate_secret(key)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if all:
        result = client.rotate_all_secrets()
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_secrets_due_for_rotation()
    data = (
        result if isinstance(result, builtins.list) else result.get("secrets", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def roles(
    ctx: typer.Context,
    key: str = typer.Argument(..., help="Secret key"),
    grant: Optional[str] = typer.Option(
        None, "--grant", "-g", help="Grant access to role"
    ),
    revoke: Optional[str] = typer.Option(
        None, "--revoke", help="Revoke access from role"
    ),
):
    """Manage role-based access to secrets."""
    client = _get_client(ctx)
    if grant:
        result = client.grant_secret_access(key, grant)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if revoke:
        result = client.revoke_secret_access(key, revoke)
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_secret_access(key)
    data = result if isinstance(result, builtins.list) else result.get("roles", result)
    print_output(data, ctx.obj.get("output", "table"))

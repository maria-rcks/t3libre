"""SSH Session Management - Jump hosts, session recording, web terminal."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="SSH session management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    status: Optional[str] = typer.Option(
        None, "--status", "-s", help="Filter by status (active, closed)"
    ),
):
    """List SSH sessions."""
    client = _get_client(ctx)
    result = client.list_ssh_sessions(status=status)
    sessions = (
        result if isinstance(result, builtins.list) else result.get("sessions", result)
    )
    print_output(sessions, ctx.obj.get("output", "table"))


@app.command()
def connect(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    user: str = typer.Option("root", "--user", "-u", help="SSH user"),
    jump_host: Optional[str] = typer.Option(None, "--jump", "-j", help="Jump host"),
    port: int = typer.Option(22, "--port", "-p", help="SSH port"),
):
    """Connect to a server via SSH (opens terminal session)."""
    client = _get_client(ctx)
    result = client.ssh_connect(server, user=user, jump_host=jump_host, port=port)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def jump_hosts(
    ctx: typer.Context,
    create: Optional[str] = typer.Option(
        None, "--create", help="Create a jump host entry (name)"
    ),
    host: Optional[str] = typer.Option(None, "--host", help="Jump host address"),
    user: Optional[str] = typer.Option(
        None, "--user", "-u", help="SSH user for jump host"
    ),
):
    """Manage SSH jump hosts."""
    client = _get_client(ctx)
    if create:
        result = client.create_jump_host(create, host or create, user or "root")
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_jump_hosts()
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def keys(
    ctx: typer.Context,
    add: Optional[str] = typer.Option(
        None, "--add", help="Add SSH public key (path or string)"
    ),
    name: Optional[str] = typer.Option(None, "--name", "-n", help="Key name"),
    delete: Optional[str] = typer.Option(
        None, "--delete", help="Delete key by name or ID"
    ),
):
    """Manage SSH keys."""
    client = _get_client(ctx)
    if add:
        import os

        key_path = os.path.expanduser(add)
        if os.path.exists(key_path):
            with open(key_path) as f:
                key_data = f.read()
        else:
            key_data = add
        result = client.add_ssh_key(name or "default", key_data)
        print_output(result, ctx.obj.get("output", "table"))
        return
    if delete:
        result = client.delete_ssh_key(delete)
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_ssh_keys()
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def record(
    ctx: typer.Context,
    session_id: str = typer.Argument(..., help="Session ID to view recording"),
):
    """View session recording for an SSH session."""
    client = _get_client(ctx)
    result = client.get_session_recording(session_id)
    print_output(result, ctx.obj.get("output", "plain"))


@app.command()
def saved(
    ctx: typer.Context,
    list: bool = typer.Option(False, "--list", "-l", help="List saved hosts"),
    add: Optional[str] = typer.Option(
        None, "--add", help="Save a new host (name@host:port)"
    ),
    delete: Optional[str] = typer.Option(None, "--delete", help="Delete saved host"),
):
    """Manage saved SSH hosts."""
    client = _get_client(ctx)
    if add:
        parts = add.split("@")
        name = parts[0]
        host_port = parts[1] if len(parts) > 1 else parts[0]
        if ":" in host_port:
            host, port = host_port.split(":")
        else:
            host, port = host_port, "22"
        result = client.save_ssh_host(name, host, int(port))
        print_output(result, ctx.obj.get("output", "table"))
        return
    if delete:
        result = client.delete_saved_host(delete)
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client.list_saved_hosts()
    print_output(result, ctx.obj.get("output", "table"))

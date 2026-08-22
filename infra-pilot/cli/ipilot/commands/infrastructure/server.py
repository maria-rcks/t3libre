import builtins

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Server management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    output: str = typer.Option(None, "--output", "-o", help="Output format"),
) -> None:
    """List all servers

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.list_servers()
    data = (
        result if isinstance(result, builtins.list) else result.get("servers", result)
    )
    print_output(data, output or ctx.obj.get("output", "table"))


@app.command()
def create(
    ctx: typer.Context,
    name: str = typer.Argument(..., help="Server name"),
    server_type: str = typer.Option(..., "--type", "-t", help="Server type"),
    memory: int = typer.Option(None, "--memory", "-m", help="Memory in MB"),
) -> None:
    """Create a new server

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.create_server(name, server_type, memory)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def delete(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
) -> None:
    """Delete a server

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.delete_server(server)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def status(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
) -> None:
    """Get server status

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.server_status(server)
    print_output(result, ctx.obj.get("output", "table"))

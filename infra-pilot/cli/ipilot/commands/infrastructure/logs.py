import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Log management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def fetch(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    lines: int = typer.Option(50, "--lines", "-n", help="Number of lines"),
    follow: bool = typer.Option(False, "--follow", "-f", help="Follow log output"),
) -> None:
    """Fetch server logs

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.get_logs(server, lines, follow)
    print_output(result, ctx.obj.get("output", "table"))

import builtins

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Deployment")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url") or DEFAULT_API_URL, config.get("token"))


@app.command()
def deploy(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    branch: str = typer.Argument(..., help="Branch to deploy"),
    repo_url: str = typer.Option(
        None, "--repo-url", "-r", help="Git repository URL to deploy"
    ),
    template: str = typer.Option(
        None, "--template", "-t", help="Deployment template to use"
    ),
) -> None:
    """Deploy a branch

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    if template:
        result = client.deploy_template(
            template, server, server=server, variables={"branch": branch}
        )
    else:
        result = client.deploy(server, branch, repo_url)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def list(
    ctx: typer.Context,
    server: str = typer.Option(None, "--server", "-s", help="Filter by server"),
) -> None:
    """List deployments"""
    client = _get_client(ctx)
    result = client._get("/deployments")
    data = (
        result
        if isinstance(result, builtins.list)
        else result.get("deployments", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def status(
    ctx: typer.Context,
    deployment_id: str = typer.Argument(..., help="Deployment ID"),
) -> None:
    """Get deployment status"""
    client = _get_client(ctx)
    result = client._get(f"/deployments/{deployment_id}")
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def rollback(
    ctx: typer.Context,
    deployment_id: str = typer.Argument(..., help="Deployment ID"),
) -> None:
    """Rollback a deployment"""
    client = _get_client(ctx)
    result = client._post(f"/deployments/{deployment_id}/rollback", {})
    print_output(result, ctx.obj.get("output", "table"))

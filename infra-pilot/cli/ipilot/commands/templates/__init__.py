"""Deployment Templates - Node.js, Python, Docker Compose, Nginx, PostgreSQL, Redis, Traefik."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Deployment templates")


TEMPLATE_TYPES = {
    "node": "Node.js application",
    "python": "Python application",
    "docker-compose": "Docker Compose stack",
    "nginx": "Nginx web server",
    "postgres": "PostgreSQL database",
    "redis": "Redis cache",
    "traefik": "Traefik reverse proxy",
}


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    template_type: Optional[str] = typer.Option(
        None, "--type", "-t", help=f"Template type: {', '.join(TEMPLATE_TYPES.keys())}"
    ),
):
    """List available deployment templates."""
    client = _get_client(ctx)
    result = client.list_templates(template_type=template_type)
    data = (
        result if isinstance(result, builtins.list) else result.get("templates", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def show(
    ctx: typer.Context,
    template: str = typer.Argument(..., help="Template name"),
):
    """Show template details."""
    client = _get_client(ctx)
    result = client.get_template(template)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def deploy(
    ctx: typer.Context,
    template: str = typer.Argument(..., help="Template name"),
    name: str = typer.Argument(..., help="Deployment name"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
    variables: Optional[str] = typer.Option(
        None, "--vars", help="Template variables as JSON"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be deployed"
    ),
):
    """Deploy a template."""
    import json
    import os

    client = _get_client(ctx)

    variables_dict = {}
    if variables:
        variables_dict = json.loads(variables)
    if not variables_dict and os.path.exists("ipilot-vars.json"):
        with open("ipilot-vars.json") as f:
            variables_dict = json.load(f)

    result = client.deploy_template(
        template, name, server=server, variables=variables_dict, dry_run=dry_run
    )
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def init(
    ctx: typer.Context,
    template: str = typer.Argument(
        ..., help=f"Template type: {', '.join(TEMPLATE_TYPES.keys())}"
    ),
    name: str = typer.Argument(..., help="Project name"),
    output_dir: str = typer.Option(".", "--output", "-o", help="Output directory"),
):
    """Initialize a project from a template (generate config files locally)."""
    client = _get_client(ctx)
    result = client.init_template(template, name, output_dir=output_dir)
    print_output(result, ctx.obj.get("output", "table"))

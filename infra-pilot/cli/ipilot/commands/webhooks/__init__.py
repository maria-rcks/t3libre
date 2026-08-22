"""Webhook management - Create, list, test webhooks."""

import builtins
from typing import Optional

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Webhook management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
):
    """List all webhooks."""
    client = _get_client(ctx)
    result = client.list_webhooks()
    data = (
        result if isinstance(result, builtins.list) else result.get("webhooks", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def create(
    ctx: typer.Context,
    name: str = typer.Argument(..., help="Webhook name"),
    url: str = typer.Argument(..., help="Webhook target URL"),
    events: str = typer.Option(
        "deploy,backup,alert",
        "--events",
        "-e",
        help="Comma-separated events to trigger on",
    ),
    secret: Optional[str] = typer.Option(
        None, "--secret", "-s", help="Webhook secret for signature"
    ),
):
    """Create a new webhook."""
    client = _get_client(ctx)
    result = client.create_webhook(
        name=name,
        url=url,
        events=[e.strip() for e in events.split(",")],
        secret=secret,
    )
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def delete(
    ctx: typer.Context,
    webhook_id: str = typer.Argument(..., help="Webhook ID"),
):
    """Delete a webhook."""
    client = _get_client(ctx)
    result = client.delete_webhook(webhook_id)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def test(
    ctx: typer.Context,
    webhook_id: Optional[str] = typer.Option(None, "--id", help="Webhook ID to test"),
    event: str = typer.Option("test", "--event", "-e", help="Event type to simulate"),
):
    """Test a webhook by sending a sample event."""
    client = _get_client(ctx)
    result = client.test_webhook(webhook_id, event=event)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def logs(
    ctx: typer.Context,
    webhook_id: Optional[str] = typer.Option(None, "--id", help="Webhook ID"),
):
    """View webhook delivery logs."""
    client = _get_client(ctx)
    result = client.get_webhook_logs(webhook_id)
    data = result if isinstance(result, builtins.list) else result.get("logs", result)
    print_output(data, ctx.obj.get("output", "table"))

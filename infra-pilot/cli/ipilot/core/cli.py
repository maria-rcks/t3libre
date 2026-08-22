"""Core CLI utilities: app creation and config loading."""

import logging
from typing import Optional

import typer

from ..client import ApiClient
from ..config import DEFAULT_API_URL, load_config

logger = logging.getLogger(__name__)


def create_app() -> typer.Typer:
    """Create and configure the main Typer CLI application.

    Returns:
        A configured Typer app instance.
    """
    app = typer.Typer(
        name="ipilot",
        help="Infra Pilot CLI - tool for managing your infrastructure",
        no_args_is_help=True,
        rich_markup_mode="rich",
    )

    @app.callback()
    def main_options(
        ctx: typer.Context,
        output: Optional[str] = typer.Option(
            None,
            "--output",
            "-o",
            help="Output format: json, table, yaml, or plain",
        ),
        profile: Optional[str] = typer.Option(
            None,
            "--profile",
            "-p",
            help="Which config profile to use",
        ),
        no_color: bool = typer.Option(
            False,
            "--no-color",
            help="Turn off colored output",
        ),
    ):
        ctx.ensure_object(dict)
        config = load_config()
        ctx.obj["output"] = output or config.get("output_format", "table")
        ctx.obj["profile"] = profile
        ctx.obj["no_color"] = no_color

    return app


def get_client(ctx: typer.Context) -> ApiClient:
    """Build an ApiClient from the current Typer context.

    Args:
        ctx: The current Typer context (must have a ``profile`` key).

    Returns:
        An initialized ApiClient instance.
    """
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(
        base_url=config.get("api_url") or DEFAULT_API_URL,
        token=config.get("token"),
    )


__all__ = [
    "create_app",
    "get_client",
]

"""Styling and theme utilities for CLI output using Rich."""

import json
import logging
from typing import Any, Dict, List, Optional

from rich import print as rprint
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table as RichTable

logger = logging.getLogger(__name__)

_console = Console()

STYLE_TITLE = "bold cyan"
STYLE_KEY = "cyan"
STYLE_ERROR = "red"
STYLE_SUCCESS = "green"
STYLE_INFO = "blue"
STYLE_WARNING = "yellow"
STYLE_NO_DATA = "yellow"


def get_console() -> Console:
    """Return the shared Rich Console instance."""
    return _console


def print_table(data: List[Dict], title: Optional[str] = None):
    """Print a list of dicts as a Rich table.

    Args:
        data: List of dictionaries to render as rows.
        title: Optional table title.
    """
    if not data:
        _console.print(f"[{STYLE_WARNING}](no data)[/{STYLE_WARNING}]")
        return
    keys = list(data[0].keys())
    table = RichTable(title=title, title_style=STYLE_TITLE)
    for key in keys:
        table.add_column(key, style=STYLE_KEY, no_wrap=True)
    for item in data:
        table.add_row(*[str(item.get(k, "")) for k in keys])
    _console.print(table)


def print_panel(text: str, title: Optional[str] = None, style: str = "green"):
    """Print text inside a Rich Panel.

    Args:
        text: The message body.
        title: Optional panel title.
        style: Border style color.
    """
    _console.print(Panel(text, title=title, border_style=style))


def print_json(data: Any):
    """Print data as formatted JSON.

    Args:
        data: The data to serialise and print.
    """
    try:
        _console.print_json(json.dumps(data, default=str))
    except (TypeError, ValueError) as exc:
        logger.error("Failed to serialise JSON output: %s", exc)
        _console.print(f"[{STYLE_ERROR}]Error serialising JSON: {exc}[/{STYLE_ERROR}]")


def print_error(message: str):
    """Print an error message in red.

    Args:
        message: The error text.
    """
    _console.print(f"[{STYLE_ERROR}]Error:[/{STYLE_ERROR}] {message}")


def print_success(message: str):
    """Print a success message in green.

    Args:
        message: The success text.
    """
    _console.print(f"[{STYLE_SUCCESS}]{message}[/{STYLE_SUCCESS}]")


def print_info(message: str):
    """Print an informational message in blue.

    Args:
        message: The info text.
    """
    _console.print(f"[{STYLE_INFO}]{message}[/{STYLE_INFO}]")


def spinner() -> Progress:
    """Create a progress spinner context manager.

    Returns:
        A Rich Progress instance with a spinner column.
    """
    return Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=_console,
    )


__all__ = [
    "get_console",
    "print_table",
    "print_panel",
    "print_json",
    "print_error",
    "print_success",
    "print_info",
    "spinner",
]

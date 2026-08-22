"""Output formatting logic for CLI responses."""

import json
import logging
import sys
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

NO_DATA_MESSAGE = "(no data)"
DEFAULT_FMT = "table"


def format_output(data: Any, fmt: str = DEFAULT_FMT) -> str:
    """Format data in the requested output format.

    Supported formats: json, table, yaml, plain.

    Args:
        data: The data to format.
        fmt: One of ``json``, ``table``, ``yaml``, or ``plain``.

    Returns:
        A formatted string representation of the data.
    """
    formatters = {
        "json": format_json,
        "table": format_table,
        "yaml": format_yaml,
        "plain": format_plain,
    }
    formatter = formatters.get(fmt, format_table)
    return formatter(data)


def format_json(data: Any) -> str:
    """Format data as indented JSON.

    Args:
        data: The data to serialise.

    Returns:
        A JSON string.
    """
    return json.dumps(data, indent=2, default=str)


def format_yaml(data: Any) -> str:
    """Format data as simple YAML (without PyYAML dependency).

    Args:
        data: The data to format.

    Returns:
        A YAML-like string.
    """
    lines: List[str] = []
    _to_yaml(data, lines, 0)
    return "\n".join(lines)


def _to_yaml(obj: Any, lines: List[str], indent: int):
    """Recursively convert an object to YAML-like lines.

    Args:
        obj: The value to convert.
        lines: Accumulator for output lines.
        indent: Current indentation level.
    """
    prefix = "  " * indent
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{prefix}{k}:")
                _to_yaml(v, lines, indent + 1)
            else:
                lines.append(f"{prefix}{k}: {_yaml_value(v)}")
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                _to_yaml(item, lines, indent + 1)
            else:
                lines.append(f"{prefix}- {_yaml_value(item)}")
    else:
        lines.append(f"{prefix}{_yaml_value(obj)}")


def _yaml_value(v: Any) -> str:
    """Format a single value for YAML output, quoting strings with special chars.

    Args:
        v: The value to format.

    Returns:
        The formatted string.
    """
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        if any(c in v for c in ":{}[]&*!|>%`@#"):
            return f"'{v}'"
        return v
    return str(v)


def format_table(data: Any) -> str:
    """Format data as an ASCII-art table.

    Handles list-of-dicts, single dict, and scalar values.

    Args:
        data: The data to format.

    Returns:
        A table-formatted string.
    """
    if isinstance(data, list):
        if not data:
            return NO_DATA_MESSAGE
        if isinstance(data[0], dict):
            return _dict_table(data)
        return "\n".join(str(item) for item in data)
    if isinstance(data, dict):
        if "error" in data:
            return f"Error: {data['error']}"
        for v in data.values():
            if isinstance(v, list) and v:
                return _dict_table(v)
        return _key_value_table(data)
    return str(data)


def _dict_table(items: List[Dict]) -> str:
    """Build an ASCII table from a list of dictionaries.

    Args:
        items: List of dicts with identical keys.

    Returns:
        A formatted table string.
    """
    if not items:
        return NO_DATA_MESSAGE
    keys = list(items[0].keys())
    col_widths: Dict[str, int] = {k: len(k) for k in keys}
    for item in items:
        for k in keys:
            col_widths[k] = max(col_widths[k], len(str(item.get(k, ""))))

    header = " | ".join(k.ljust(col_widths[k]) for k in keys)
    sep = "-+-".join("-" * col_widths[k] for k in keys)
    rows = [header, sep]
    for item in items:
        rows.append(" | ".join(str(item.get(k, "")).ljust(col_widths[k]) for k in keys))
    return "\n".join(rows)


def _key_value_table(data: Dict) -> str:
    """Build a key-value pair table from a single dictionary.

    Args:
        data: The dictionary to display.

    Returns:
        A formatted key-value string.
    """
    if "error" in data:
        return f"Error: {data['error']}"
    if not data:
        return NO_DATA_MESSAGE
    max_key = max(len(k) for k in data)
    lines = []
    for k, v in data.items():
        lines.append(f"{k.ljust(max_key)} : {_yaml_value(v)}")
    return "\n".join(lines)


def format_plain(data: Any) -> str:
    """Format data as plain text lines.

    Args:
        data: The data to format.

    Returns:
        A plain-text string.
    """
    if isinstance(data, list):
        return "\n".join(str(item) for item in data)
    if isinstance(data, dict):
        if "error" in data:
            return f"Error: {data['error']}"
        return "\n".join(f"{k}: {v}" for k, v in data.items())
    return str(data)


def print_output(data: Any, fmt: str = DEFAULT_FMT):
    """Format and write data to stdout.

    Args:
        data: The data to print.
        fmt: Output format (json, table, yaml, plain).
    """
    sys.stdout.write(format_output(data, fmt))
    sys.stdout.write("\n")


__all__ = [
    "format_output",
    "format_json",
    "format_table",
    "format_yaml",
    "format_plain",
    "print_output",
]

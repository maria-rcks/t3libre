"""CLI entry point for Infra Pilot."""

import logging
import os
from typing import Any, Dict, List

import typer
import yaml

from . import commands  # noqa: F401  (registers all command groups)
from .config import DEFAULT_API_URL
from .core.cli import create_app
from .core.command_registry import attach_to_app

logger = logging.getLogger(__name__)

app = create_app()

attach_to_app(app)


@app.command()
def login(
    ctx: typer.Context,
    api_key: str = typer.Argument(..., help="Your API key"),
):
    """Log in to the API with your API key."""
    from .client import ApiClient
    from .config import load_config
    from .output.formatters import print_output

    config = load_config(profile=ctx.obj.get("profile"))
    client = ApiClient(
        config.get("api_url") or DEFAULT_API_URL,
        config.get("token"),
    )
    result = client.login(api_key)
    if "token" in result:
        from .config import set_key

        set_key("token", result["token"], profile=ctx.obj.get("profile"))
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def logout(ctx: typer.Context):
    """Log out and clear your authentication token."""
    from .config import unset_key

    unset_key("token", profile=ctx.obj.get("profile"))
    from .output.formatters import print_output

    print_output({"status": "Logged out"}, ctx.obj.get("output", "table"))


@app.command()
def version():
    """Show the CLI version."""
    from . import __version__

    typer.echo(f"ipilot v{__version__}")


@app.command()
def interactive():
    """Open an interactive REPL-like mode."""
    _run_interactive()


@app.command()
def completion(
    shell: str = typer.Argument("auto", help="Shell type: bash, zsh, fish, powershell"),
    install: bool = typer.Option(False, "--install", help="Install shell completion"),
):
    """Set up shell completion for the CLI."""
    from typer.completion import get_completion_script, install as install_completion

    resolved = shell if shell != "auto" else "bash"
    if install:
        install_completion(resolved, prog_name="ipilot")
        typer.echo(f"Completion installed for {resolved}")
    else:
        typer.echo(
            get_completion_script(
                prog_name="ipilot",
                complete_var="_IPILOT_COMPLETE",
                shell=resolved,
            )
        )


@app.command()
def batch(
    ctx: typer.Context,
    file: str = typer.Option(..., "--file", "-f", help="YAML batch operations file"),
):
    """Run multiple commands defined in a YAML file."""
    try:
        with open(file) as f:
            ops: Dict[str, List[Dict[str, Any]]] = yaml.safe_load(f)
    except (FileNotFoundError, yaml.YAMLError) as exc:
        typer.echo(f"Error loading batch file: {exc}", err=True)
        raise typer.Exit(code=1)

    if not ops or "operations" not in ops:
        typer.echo(f"No operations found in {file}", err=True)
        raise typer.Exit(code=1)

    for op in ops.get("operations", []):
        cmd = op.get("command", "")
        args = op.get("args", {})
        typer.echo(f"Running: ipilot {cmd} {args}")


@app.command()
def benchmark(
    ctx: typer.Context,
    server: str = typer.Option(None, "--server", "-s", help="Server to benchmark"),
):
    """Run performance benchmarks (alias for 'ipilot doctor benchmark')."""
    from typer.testing import CliRunner

    runner = CliRunner()
    args = ["doctor", "benchmark"]
    if server:
        args.extend(["--server", server])
    result = runner.invoke(app, args)
    typer.echo(result.output)


@app.command()
def diagnose(
    ctx: typer.Context,
    server: str = typer.Option(None, "--server", "-s", help="Server to diagnose"),
    issue: str = typer.Option(
        None, "--issue", "-i", help="Issue type (connectivity, performance, disk)"
    ),
):
    """Diagnose infrastructure issues (alias for 'ipilot doctor diagnose')."""
    from typer.testing import CliRunner

    runner = CliRunner()
    args = ["doctor", "diagnose"]
    if server:
        args.extend(["--server", server])
    if issue:
        args.extend(["--issue", issue])
    result = runner.invoke(app, args)
    typer.echo(result.output)


@app.command()
def docs(
    output: str = typer.Option(
        "docs/cli-reference.md",
        "--output",
        "-o",
        help="Output file path for generated docs",
    ),
):
    """Generate CLI reference documentation."""
    _generate_docs(output)


def _run_interactive():
    """Run the CLI in interactive mode using Rich prompts."""
    from rich.console import Console
    from rich.prompt import Prompt

    console = Console()
    console.print("[bold cyan]Infra Pilot CLI[/bold cyan] - Interactive mode")
    console.print("Type commands directly, or 'exit' to quit.\n")

    while True:
        try:
            cmd = Prompt.ask("[bold]ipilot[/bold]")
            if cmd in ("exit", "quit", "q"):
                break
            if cmd.strip():
                from typer.testing import CliRunner

                runner = CliRunner()
                result = runner.invoke(app, cmd.split())
                console.print(result.output)
        except (KeyboardInterrupt, EOFError):
            break


def _generate_docs(output_path: str):
    """Generate CLI reference documentation from the Typer app.

    Args:
        output_path: Path to write the generated docs to.
    """
    from typer.testing import CliRunner

    lines = [
        "# CLI Reference\n",
        "Auto-generated from `ipilot --help`.\n",
        "## Global Options\n",
    ]
    runner = CliRunner()
    result = runner.invoke(app, ["--help"])
    lines.append("```\n" + result.output + "```\n")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    typer.echo(f"Docs generated: {output_path}")

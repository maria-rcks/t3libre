"""TUI mode - Textual-based interactive terminal UI."""

import typer

from ...output.formatters import print_output

app = typer.Typer(help="Text-based terminal UI mode")


@app.command()
def dashboard(
    ctx: typer.Context,
):
    """Open the interactive TUI dashboard."""
    try:
        import asyncio

        from textual.app import App, ComposeResult
        from textual.containers import Horizontal, Vertical
        from textual.screen import Screen
        from textual.widgets import DataTable, Footer, Header, RichLog, Static

        class DashboardApp(App):
            TITLE = "Infra Pilot TUI"

            def compose(self) -> ComposeResult:
                yield Header()
                yield Horizontal(
                    Vertical(
                        Static("[bold]Servers[/bold]", id="server-title"),
                        DataTable(id="servers"),
                        Static("[bold]Recent Activity[/bold]", id="activity-title"),
                        RichLog(id="activity"),
                    ),
                    Vertical(
                        Static("[bold]System Status[/bold]", id="health-title"),
                        DataTable(id="health"),
                        Static("[bold]Alerts[/bold]", id="alerts-title"),
                        DataTable(id="alerts"),
                    ),
                )
                yield Footer()

            def on_mount(self) -> None:
                server_table = self.query_one("#servers", DataTable)
                server_table.add_columns("Name", "Status", "Type", "Region")
                server_table.add_row("Loading...", "", "", "")
                self.set_interval(30, self.refresh_data)

                health_table = self.query_one("#health", DataTable)
                health_table.add_columns("Check", "Status")
                health_table.add_row("API", "checking...")
                health_table.add_row("Docker", "checking...")

                alerts_table = self.query_one("#alerts", DataTable)
                alerts_table.add_columns("Severity", "Message", "Time")
                alerts_table.add_row("No alerts", "", "")

                activity_log = self.query_one("#activity", RichLog)
                activity_log.write("Infra Pilot TUI started")
                activity_log.write("Use Ctrl+C to exit")

            async def refresh_data(self) -> None:
                pass

        app = DashboardApp()
        app.run()

    except ImportError:
        print_output(
            {"error": "Textual is not installed. Install with: pip install textual"},
            "plain",
        )


@app.command()
def monitor(
    ctx: typer.Context,
    server: str = typer.Argument(None, help="Server to monitor"),
):
    """Open a real-time monitoring TUI."""
    return dashboard(ctx)


@app.command()
def logs(
    ctx: typer.Context,
    server: str = typer.Argument(None, help="Server to view logs from"),
):
    """Open a log viewer TUI."""
    try:
        from textual.app import App, ComposeResult
        from textual.widgets import Footer, Header, RichLog

        class LogViewer(App):
            TITLE = "Infra Pilot Log Viewer"

            def compose(self) -> ComposeResult:
                yield Header()
                yield RichLog(id="logs", highlight=True)
                yield Footer()

            def on_mount(self) -> None:
                log = self.query_one("#logs", RichLog)
                log.write("Connected to log stream...")
                log.write("Waiting for log entries...")

        app = LogViewer()
        app.run()
    except ImportError:
        print_output({"error": "Textual is not installed"}, "plain")

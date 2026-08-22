import builtins

import typer

from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="Backup management")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


@app.command()
def list(
    ctx: typer.Context,
    server: str = typer.Argument(None, help="Server ID (optional)"),
) -> None:
    """List backups

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.list_backups(server)
    data = (
        result if isinstance(result, builtins.list) else result.get("backups", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def create(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    s3_target: str = typer.Option(
        None, "--s3", help="S3/Backblaze target (bucket:path)"
    ),
) -> None:
    """Create a backup

    Args:
        ctx: Typer context for accessing config and output format.

    Returns:
        None (output is printed via print_output).
    """
    client = _get_client(ctx)
    result = client.create_backup(server, s3_target=s3_target)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def schedule(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    interval: str = typer.Option(
        "daily", "--interval", "-i", help="Interval: hourly, daily, weekly"
    ),
    retention: int = typer.Option(
        7, "--retention", "-r", help="Number of backups to retain"
    ),
    s3_target: str = typer.Option(
        None, "--s3", help="S3/Backblaze target for offsite storage"
    ),
):
    """Schedule automated backups"""
    client = _get_client(ctx)
    result = client._post(
        "/backup-jobs",
        {
            "app_id": server,
            "name": f"auto-{server}",
            "schedule_type": interval,
            "retention_count": retention,
            "s3_target": s3_target,
        },
    )
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def snapshots(
    ctx: typer.Context,
    server: str = typer.Argument(..., help="Server ID or name"),
    create: bool = typer.Option(False, "--create", help="Create a new snapshot"),
    restore: str = typer.Option(None, "--restore", help="Restore from snapshot ID"),
):
    """Manage server snapshots"""
    client = _get_client(ctx)
    if create:
        result = client._post(f"/servers/{server}/snapshots", {})
        print_output(result, ctx.obj.get("output", "table"))
        return
    if restore:
        result = client._post(f"/servers/{server}/snapshots/{restore}/restore", {})
        print_output(result, ctx.obj.get("output", "table"))
        return
    result = client._get(f"/servers/{server}/snapshots")
    data = (
        result if isinstance(result, builtins.list) else result.get("snapshots", result)
    )
    print_output(data, ctx.obj.get("output", "table"))


@app.command()
def restore(
    ctx: typer.Context,
    backup_id: str = typer.Argument(..., help="Backup ID or name"),
    target: str = typer.Option(
        None, "--target", "-t", help="Target server for restore"
    ),
):
    """Restore from a backup"""
    client = _get_client(ctx)
    result = client._post(
        f"/backups/{backup_id}/restore", {"target": target} if target else {}
    )
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def config(
    ctx: typer.Context,
    s3_bucket: str = typer.Option(None, "--s3-bucket", help="S3/Backblaze bucket name"),
    s3_key: str = typer.Option(None, "--s3-key", help="S3/Backblaze access key"),
    s3_secret: str = typer.Option(None, "--s3-secret", help="S3/Backblaze secret key"),
    s3_endpoint: str = typer.Option(
        None, "--s3-endpoint", help="S3-compatible endpoint URL"
    ),
):
    """Configure backup storage (S3/Backblaze)"""
    client = _get_client(ctx)
    result = client._post(
        "/backup/config",
        {
            "s3_bucket": s3_bucket,
            "s3_key": s3_key,
            "s3_secret": s3_secret,
            "s3_endpoint": s3_endpoint,
        },
    )
    print_output(result, ctx.obj.get("output", "table"))

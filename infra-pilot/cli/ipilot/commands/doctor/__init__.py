"""Developer experience - doctor, benchmark, diagnose, health checking."""

import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional

import typer

from ... import __version__
from ...client import ApiClient
from ...config import DEFAULT_API_URL, load_config
from ...output.formatters import print_output

app = typer.Typer(help="System diagnostics and health checks")


def _get_client(ctx: typer.Context) -> ApiClient:
    config = load_config(profile=ctx.obj.get("profile"))
    return ApiClient(config.get("api_url", DEFAULT_API_URL), config.get("token"))


def _memory_usage() -> Dict[str, Any]:
    """Return real memory usage without external dependencies."""
    try:
        with open("/proc/meminfo", "r") as f:
            meminfo = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    meminfo[parts[0].strip()] = int(parts[1].strip().split()[0])
        total_kb = meminfo.get("MemTotal", 0)
        available_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
        if total_kb > 0:
            used_pct = (1 - available_kb / total_kb) * 100
            return {
                "total_gb": round(total_kb / 1024 / 1024, 2),
                "available_gb": round(available_kb / 1024 / 1024, 2),
                "used_pct": round(used_pct, 1),
            }
    except (OSError, IOError):
        pass
    if sys.platform == "win32":
        import ctypes

        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(MemoryStatusEx)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return {
                "total_gb": round(status.ullTotalPhys / 1024 / 1024 / 1024, 2),
                "available_gb": round(status.ullAvailPhys / 1024 / 1024 / 1024, 2),
                "used_pct": round(status.dwMemoryLoad, 1),
            }
    return {"total_gb": 0, "available_gb": 0, "used_pct": 0}


def _disk_usage(path: str = "/") -> Dict[str, Any]:
    """Return real disk usage for the given path."""
    usage = shutil.disk_usage(path)
    used_pct = (usage.used / usage.total) * 100 if usage.total else 0
    return {
        "path": path,
        "total_gb": round(usage.total / 1024 / 1024 / 1024, 2),
        "used_gb": round(usage.used / 1024 / 1024 / 1024, 2),
        "free_gb": round(usage.free / 1024 / 1024 / 1024, 2),
        "used_pct": round(used_pct, 1),
    }


def _load_average() -> Optional[Dict[str, float]]:
    """Real load average, or None on platforms without os.getloadavg."""
    if hasattr(os, "getloadavg"):
        try:
            load = os.getloadavg()
            return {
                "1m": round(load[0], 2),
                "5m": round(load[1], 2),
                "15m": round(load[2], 2),
            }
        except OSError:
            return None
    return None


@app.command()
def doctor(
    ctx: typer.Context,
    fix: bool = typer.Option(False, "--fix", help="Attempt to auto-fix issues"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show detailed output"),
):
    """Run comprehensive system diagnostics."""
    checks: List[Dict[str, Any]] = []

    checks.append(
        {
            "check": "Python Version",
            "status": "ok" if sys.version_info >= (3, 10) else "warn",
            "detail": sys.version,
        }
    )

    ipilot_path = shutil.which("ipilot")
    checks.append(
        {
            "check": "ipilot CLI",
            "status": "ok" if ipilot_path else "fail",
            "detail": ipilot_path or "not found in PATH",
        }
    )

    docker_path = shutil.which("docker")
    checks.append(
        {
            "check": "Docker",
            "status": "ok" if docker_path else "warn",
            "detail": docker_path or "not found (optional)",
        }
    )

    git_path = shutil.which("git")
    checks.append(
        {
            "check": "Git",
            "status": "ok" if git_path else "warn",
            "detail": git_path or "not found (optional)",
        }
    )

    ssh_path = shutil.which("ssh")
    checks.append(
        {
            "check": "SSH",
            "status": "ok" if ssh_path else "warn",
            "detail": ssh_path or "not found (optional)",
        }
    )

    mem = _memory_usage()
    if mem.get("total_gb"):
        mem_status = "warn" if mem["used_pct"] > 80 else "ok"
        checks.append(
            {
                "check": "Memory",
                "status": mem_status,
                "detail": f"{mem['used_pct']}% used ({mem['available_gb']} GB free of {mem['total_gb']} GB)",
            }
        )
    else:
        checks.append(
            {
                "check": "Memory",
                "status": "warn",
                "detail": "could not read memory info",
            }
        )

    disk = _disk_usage("/")
    checks.append(
        {
            "check": "Disk",
            "status": "warn" if disk["used_pct"] > 85 else "ok",
            "detail": f"{disk['used_pct']}% used ({disk['free_gb']} GB free of {disk['total_gb']} GB on {disk['path']})",
        }
    )

    load = _load_average()
    if load:
        checks.append(
            {
                "check": "Load Average",
                "status": "warn" if load["1m"] > (os.cpu_count() or 0) else "ok",
                "detail": f"1m={load['1m']} 5m={load['5m']} 15m={load['15m']}",
            }
        )
    else:
        checks.append(
            {
                "check": "Load Average",
                "status": "warn",
                "detail": "not available on this platform",
            }
        )

    config = load_config()
    if config:
        checks.append(
            {
                "check": "Config",
                "status": "ok",
                "detail": f"profile: {config.get('profile', 'default')}",
            }
        )
    else:
        checks.append(
            {
                "check": "Config",
                "status": "warn",
                "detail": "no config found, run 'ipilot login'",
            }
        )

    api_url = config.get("api_url", DEFAULT_API_URL) if config else DEFAULT_API_URL
    token = config.get("token") if config else None
    if token:
        try:
            client = ApiClient(api_url, token)
            health = client.health_check()
            if isinstance(health, dict) and health.get("status") == "ok":
                checks.append(
                    {"check": "API Connection", "status": "ok", "detail": api_url}
                )
            else:
                checks.append(
                    {
                        "check": "API Connection",
                        "status": "warn",
                        "detail": f"{api_url} - unhealthy",
                    }
                )
        except Exception as e:
            checks.append(
                {
                    "check": "API Connection",
                    "status": "fail",
                    "detail": f"{api_url} - {e}",
                }
            )
    else:
        checks.append(
            {
                "check": "API Connection",
                "status": "warn",
                "detail": "not authenticated, run 'ipilot login'",
            }
        )

    if os.path.exists(os.path.expanduser("~/.ssh")):
        key_count = len(
            [f for f in os.listdir(os.path.expanduser("~/.ssh")) if f.endswith(".pub")]
        )
        checks.append(
            {
                "check": "SSH Keys",
                "status": "ok" if key_count > 0 else "warn",
                "detail": f"{key_count} public key(s) found",
            }
        )
    else:
        checks.append(
            {"check": "SSH Keys", "status": "warn", "detail": "~/.ssh not found"}
        )

    print_output(checks, ctx.obj.get("output", "table"))

    failed = [c for c in checks if c["status"] == "fail"]
    warnings = [c for c in checks if c["status"] == "warn"]

    if failed:
        typer.echo(f"\n{'!'*40}")
        typer.echo(f"Found {len(failed)} issue(s) that need attention:")
        for f in failed:
            typer.echo(f"  - {f['check']}: {f['detail']}")
        if fix:
            typer.echo("\nAttempting fixes...")
            for f in failed:
                if f["check"] == "ipilot CLI":
                    typer.echo("  Reinstall ipilot: pip install -e .")
                elif f["check"] == "API Connection":
                    typer.echo("  Ensure the API server is running and reachable")
        typer.echo(f"{'!'*40}")
    elif warnings:
        typer.echo(f"\n{'*'*40}")
        typer.echo(f"{len(warnings)} warning(s) found (non-critical)")
        for w in warnings:
            typer.echo(f"  - {w['check']}: {w['detail']}")
        typer.echo(f"{'*'*40}")
    else:
        typer.echo("\nAll checks passed!")


@app.command()
def benchmark(
    ctx: typer.Context,
    server: Optional[str] = typer.Option(
        None, "--server", "-s", help="Server to benchmark"
    ),
    duration: int = typer.Option(
        10, "--duration", "-d", help="Benchmark duration in seconds"
    ),
):
    """Run performance benchmarks."""
    client = _get_client(ctx)
    if server:
        result = client.benchmark_server(server, duration=duration)
    else:
        result = client.benchmark_system(duration=duration)
    print_output(result, ctx.obj.get("output", "table"))


@app.command()
def diagnose(
    ctx: typer.Context,
    server: Optional[str] = typer.Option(
        None, "--server", "-s", help="Server to diagnose"
    ),
    issue: Optional[str] = typer.Option(
        None,
        "--issue",
        "-i",
        help="Specific issue to diagnose (connectivity, performance, disk)",
    ),
):
    """Diagnose infrastructure issues."""
    client = _get_client(ctx)
    if server:
        result = client.diagnose_server(server, issue=issue)
    else:
        result = client.diagnose_system(issue=issue)
    print_output(result, ctx.obj.get("output", "table"))

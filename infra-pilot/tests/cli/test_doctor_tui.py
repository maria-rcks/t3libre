"""Unit tests for the doctor command group and its helpers."""

import json
import sys
import types
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

DOCTOR = "cli.ipilot.commands.doctor"


@pytest.fixture
def runner(tmp_path, monkeypatch):
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json")
    )
    return CliRunner()


@pytest.fixture
def invoke(runner):
    from cli.ipilot.main import app as main_app

    return lambda args, **kwargs: runner.invoke(main_app, args, **kwargs)


def _healthy_helpers(monkeypatch):
    monkeypatch.setattr(
        DOCTOR + "._memory_usage",
        lambda: {"total_gb": 16, "available_gb": 8, "used_pct": 50},
    )
    monkeypatch.setattr(
        DOCTOR + "._disk_usage",
        lambda path: {
            "path": path,
            "total_gb": 100,
            "used_gb": 50,
            "free_gb": 50,
            "used_pct": 50,
        },
    )
    monkeypatch.setattr(
        DOCTOR + "._load_average", lambda: {"1m": 0.1, "5m": 0.1, "15m": 0.1}
    )
    monkeypatch.setattr(DOCTOR + ".shutil.which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(DOCTOR + ".os.path.exists", lambda p: "ssh" in p)
    monkeypatch.setattr(DOCTOR + ".os.listdir", lambda p: ["id_a.pub", "id_b.pub"])

    class HealthyClient:
        def health_check(self):
            return {"status": "ok"}

    monkeypatch.setattr(DOCTOR + ".ApiClient", lambda *a, **k: HealthyClient())
    monkeypatch.setattr(
        DOCTOR + ".load_config",
        lambda: {"profile": "default", "api_url": "http://x", "token": "t"},
    )


class TestDoctorCommand:
    def test_all_checks_pass(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "Python Version" in result.output
        assert "Load Average" in result.output
        assert "All checks passed!" in result.output

    def test_warnings_are_reported(self, invoke, monkeypatch):
        monkeypatch.setattr(
            DOCTOR + "._memory_usage",
            lambda: {"total_gb": 16, "available_gb": 1, "used_pct": 90},
        )
        monkeypatch.setattr(
            DOCTOR + "._disk_usage",
            lambda path: {
                "path": path,
                "total_gb": 100,
                "used_gb": 95,
                "free_gb": 5,
                "used_pct": 95,
            },
        )
        monkeypatch.setattr(
            DOCTOR + "._load_average", lambda: {"1m": 99.0, "5m": 1.0, "15m": 1.0}
        )
        monkeypatch.setattr(
            DOCTOR + ".shutil.which",
            lambda name: "/usr/bin/ipilot" if name == "ipilot" else None,
        )
        monkeypatch.setattr(DOCTOR + ".os.path.exists", lambda p: False)
        monkeypatch.setattr(
            DOCTOR + ".load_config", lambda: {"profile": None, "api_url": "http://x"}
        )
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "warning(s) found" in result.output
        assert "Load Average" in result.output

    def test_failures_with_fix_flag(self, invoke, monkeypatch):
        monkeypatch.setattr(
            DOCTOR + "._memory_usage",
            lambda: {"total_gb": 16, "available_gb": 8, "used_pct": 50},
        )
        monkeypatch.setattr(
            DOCTOR + "._disk_usage",
            lambda path: {
                "path": path,
                "total_gb": 100,
                "used_gb": 50,
                "free_gb": 50,
                "used_pct": 50,
            },
        )
        monkeypatch.setattr(
            DOCTOR + "._load_average", lambda: {"1m": 0.1, "5m": 0.1, "15m": 0.1}
        )
        monkeypatch.setattr(DOCTOR + ".shutil.which", lambda name: None)
        monkeypatch.setattr(DOCTOR + ".os.path.exists", lambda p: False)

        class FailingClient:
            def health_check(self):
                raise ConnectionError("refused")

        monkeypatch.setattr(DOCTOR + ".ApiClient", lambda *a, **k: FailingClient())
        monkeypatch.setattr(
            DOCTOR + ".load_config", lambda: {"api_url": "http://x", "token": "t"}
        )
        result = invoke(["doctor", "doctor", "--fix"])
        assert result.exit_code == 0
        assert "issue(s) that need attention" in result.output
        assert "Attempting fixes..." in result.output
        assert "Reinstall ipilot" in result.output
        assert "Ensure the API server is running" in result.output

    def test_memory_unavailable_is_warn(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)
        monkeypatch.setattr(
            DOCTOR + "._memory_usage",
            lambda: {"total_gb": 0, "available_gb": 0, "used_pct": 0},
        )
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "could not read memory info" in result.output

    def test_no_config_prints_warning(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)
        monkeypatch.setattr(DOCTOR + ".load_config", lambda: {})
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "no config found" in result.output

    def test_api_connection_unhealthy(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)

        class UnhealthyClient:
            def health_check(self):
                return {"status": "down"}

        monkeypatch.setattr(DOCTOR + ".ApiClient", lambda *a, **k: UnhealthyClient())
        monkeypatch.setattr(
            DOCTOR + ".load_config", lambda: {"api_url": "http://x", "token": "t"}
        )
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "unhealthy" in result.output

    def test_load_average_unavailable_is_reported(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)
        monkeypatch.setattr(DOCTOR + "._load_average", lambda: None)

        result = invoke(["doctor", "doctor"])

        assert result.exit_code == 0
        assert "not available on this platform" in result.output

    def test_no_ssh_keys_warns(self, invoke, monkeypatch):
        _healthy_helpers(monkeypatch)
        monkeypatch.setattr(DOCTOR + ".os.listdir", lambda p: ["config", "known_hosts"])
        result = invoke(["doctor", "doctor"])
        assert result.exit_code == 0
        assert "0 public key(s)" in result.output


class TestBenchmarkCommand:
    def test_benchmark_server(self, monkeypatch):
        client = MagicMock()
        client.benchmark_server.return_value = {"result": "ok"}
        import cli.ipilot.commands.doctor as doctor_mod

        monkeypatch.setattr(doctor_mod, "_get_client", lambda ctx: client)
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(
            main_app,
            ["doctor", "benchmark", "--server", "srv-1", "--duration", "5"],
        )
        assert result.exit_code == 0
        client.benchmark_server.assert_called_once_with("srv-1", duration=5)

    def test_benchmark_system(self, monkeypatch):
        client = MagicMock()
        client.benchmark_system.return_value = {"result": "ok"}
        import cli.ipilot.commands.doctor as doctor_mod

        monkeypatch.setattr(doctor_mod, "_get_client", lambda ctx: client)
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["doctor", "benchmark"])
        assert result.exit_code == 0
        client.benchmark_system.assert_called_once_with(duration=10)


class TestDiagnoseCommand:
    def test_diagnose_server(self, monkeypatch):
        client = MagicMock()
        client.diagnose_server.return_value = {"diagnosis": "ok"}
        import cli.ipilot.commands.doctor as doctor_mod

        monkeypatch.setattr(doctor_mod, "_get_client", lambda ctx: client)
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(
            main_app,
            ["doctor", "diagnose", "--server", "srv-1", "--issue", "disk"],
        )
        assert result.exit_code == 0
        client.diagnose_server.assert_called_once_with("srv-1", issue="disk")

    def test_diagnose_system(self, monkeypatch):
        client = MagicMock()
        client.diagnose_system.return_value = {"diagnosis": "ok"}
        import cli.ipilot.commands.doctor as doctor_mod

        monkeypatch.setattr(doctor_mod, "_get_client", lambda ctx: client)
        from cli.ipilot.main import app as main_app

        result = CliRunner().invoke(main_app, ["doctor", "diagnose"])
        assert result.exit_code == 0
        client.diagnose_system.assert_called_once_with(issue=None)


class TestMemoryUsage:
    def test_linux_meminfo_path(self, monkeypatch):
        import io

        import cli.ipilot.commands.doctor as doctor_mod

        meminfo = (
            "MemTotal:       16384000 kB\n"
            "MemFree:         1000000 kB\n"
            "MemAvailable:    8192000 kB\n"
        )
        real_open = open

        def fake_open(path, *args, **kwargs):
            if path == "/proc/meminfo":
                return io.StringIO(meminfo)
            return real_open(path, *args, **kwargs)

        monkeypatch.setattr("builtins.open", fake_open)
        result = doctor_mod._memory_usage()
        assert result["total_gb"] > 0
        assert result["used_pct"] > 0

    def test_meminfo_without_available(self, monkeypatch):
        import io

        import cli.ipilot.commands.doctor as doctor_mod

        meminfo = "MemTotal: 1048576 kB\nMemFree: 262144 kB\n"
        real_open = open

        def fake_open(path, *args, **kwargs):
            if path == "/proc/meminfo":
                return io.StringIO(meminfo)
            return real_open(path, *args, **kwargs)

        monkeypatch.setattr("builtins.open", fake_open)
        result = doctor_mod._memory_usage()
        assert result["total_gb"] == 1.0

    def test_windows_memory_status_success_path(self, monkeypatch):
        import ctypes

        import cli.ipilot.commands.doctor as doctor_mod

        def fail_open(path, *args, **kwargs):
            raise FileNotFoundError(path)

        class FakeKernel32:
            def GlobalMemoryStatusEx(self, status_ptr):
                status = status_ptr._obj
                status.ullTotalPhys = 8 * 1024 * 1024 * 1024
                status.ullAvailPhys = 2 * 1024 * 1024 * 1024
                status.dwMemoryLoad = 75
                return True

        class FakeWindll:
            kernel32 = FakeKernel32()

        monkeypatch.setattr("builtins.open", fail_open)
        monkeypatch.setattr(doctor_mod.sys, "platform", "win32")
        monkeypatch.setattr(ctypes, "windll", FakeWindll(), raising=False)

        assert doctor_mod._memory_usage() == {
            "total_gb": 8.0,
            "available_gb": 2.0,
            "used_pct": 75,
        }

    def test_windows_unavailable_falls_back(self, monkeypatch):
        import ctypes

        import cli.ipilot.commands.doctor as doctor_mod

        def fail_open(path, *args, **kwargs):
            raise FileNotFoundError(path)

        monkeypatch.setattr("builtins.open", fail_open)
        if hasattr(ctypes, "windll"):
            monkeypatch.setattr(
                ctypes.windll.kernel32, "GlobalMemoryStatusEx", lambda status: False
            )
        result = doctor_mod._memory_usage()
        assert result == {"total_gb": 0, "available_gb": 0, "used_pct": 0}


class TestLoadAverage:
    def test_returns_rounded_values(self, monkeypatch):
        import cli.ipilot.commands.doctor as doctor_mod

        fake_os = types.ModuleType("os")
        fake_os.getloadavg = lambda: (1.234, 2.345, 3.456)
        monkeypatch.setattr(doctor_mod, "os", fake_os)
        result = doctor_mod._load_average()
        assert result == {"1m": 1.23, "5m": 2.35, "15m": 3.46}

    def test_os_error_returns_none(self, monkeypatch):
        import cli.ipilot.commands.doctor as doctor_mod

        fake_os = types.ModuleType("os")

        def boom():
            raise OSError("no load average")

        fake_os.getloadavg = boom
        monkeypatch.setattr(doctor_mod, "os", fake_os)
        assert doctor_mod._load_average() is None

    def test_unavailable_platform_returns_none(self, monkeypatch):
        import cli.ipilot.commands.doctor as doctor_mod

        fake_os = types.ModuleType("os")
        monkeypatch.setattr(doctor_mod, "os", fake_os)
        assert doctor_mod._load_average() is None


class TestDiskUsage:
    def test_returns_usage_dict(self):
        import cli.ipilot.commands.doctor as doctor_mod

        result = doctor_mod._disk_usage(".")
        assert result["path"] == "."
        assert result["total_gb"] >= 0
        assert result["used_pct"] >= 0


def _install_fake_textual(
    monkeypatch, widgets=("DataTable", "Footer", "Header", "RichLog", "Static")
):
    for name in (
        "textual",
        "textual.app",
        "textual.containers",
        "textual.screen",
        "textual.widgets",
    ):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))

    class FakeWidget:
        add_columns = MagicMock()
        add_row = MagicMock()
        set_interval = MagicMock()
        write = MagicMock()

    class FakeApp:
        instances = []
        set_interval = MagicMock()

        def __init__(self):
            FakeApp.instances.append(self)

        def query_one(self, *args, **kwargs):
            return FakeWidget()

        def run(self):
            import asyncio

            for _ in self.compose():
                pass
            self.on_mount()
            if hasattr(self, "refresh_data"):
                asyncio.run(self.refresh_data())

    sys.modules["textual"].app = sys.modules["textual.app"]
    sys.modules["textual.app"].App = FakeApp
    sys.modules["textual.app"].ComposeResult = object

    class Container:
        def __init__(self, *args, **kwargs):
            pass

    sys.modules["textual.containers"].Horizontal = Container
    sys.modules["textual.containers"].Vertical = Container
    sys.modules["textual.screen"].Screen = Container
    for w in widgets:
        make_widget = type(w, (), {"__init__": lambda self, *a, **k: None})
        sys.modules["textual.widgets"].__dict__[w] = make_widget
    return FakeApp, FakeWidget


def _real_path_invoke(monkeypatch, tmp_path, args):
    monkeypatch.setattr(DOCTOR + ".ApiClient", lambda *a, **k: MagicMock())
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(tmp_path / ".ipilot"))
    monkeypatch.setattr(
        "cli.ipilot.config.CONFIG_FILE", str(tmp_path / ".ipilot" / "config.json")
    )
    from cli.ipilot.main import app as main_app

    return CliRunner().invoke(main_app, args)


class TestTuiDashboard:
    def test_dashboard_runs_app(self, invoke, monkeypatch):
        fake_app_cls, _ = _install_fake_textual(monkeypatch)
        result = invoke(["tui", "dashboard"])
        assert result.exit_code == 0
        assert fake_app_cls.instances

    def test_dashboard_install_error_hint(self, invoke, monkeypatch):
        monkeypatch.setitem(sys.modules, "textual", None)
        result = invoke(["tui", "dashboard"])
        assert result.exit_code == 0
        assert "Textual is not installed" in result.output

    def test_monitor_delegates_to_dashboard(self, invoke, monkeypatch):
        fake_app_cls, _ = _install_fake_textual(monkeypatch)
        result = invoke(["tui", "monitor", "srv-1"])
        assert result.exit_code == 0
        assert fake_app_cls.instances

    def test_logs_runs_app(self, invoke, monkeypatch):
        fake_app_cls, fake_widget = _install_fake_textual(
            monkeypatch, widgets=("Footer", "Header", "RichLog")
        )
        result = invoke(["tui", "logs", "srv-1"])
        assert result.exit_code == 0
        assert fake_app_cls.instances
        assert fake_widget.write.called

    def test_logs_install_error_hint(self, invoke, monkeypatch):
        monkeypatch.setitem(sys.modules, "textual", None)
        result = invoke(["tui", "logs"])
        assert result.exit_code == 0
        assert "Textual is not installed" in result.output

    def test_dashboard_mounts_widgets(self, invoke, monkeypatch):
        fake_app_cls, fake_widget = _install_fake_textual(monkeypatch)
        result = invoke(["tui", "dashboard"])
        assert result.exit_code == 0
        assert fake_app_cls.instances
        assert fake_widget.add_columns.called
        assert fake_app_cls.set_interval.called


class TestDoctorGetClient:
    def test_real_get_client_builds_client(self, monkeypatch, tmp_path):
        result = _real_path_invoke(monkeypatch, tmp_path, ["doctor", "benchmark"])
        assert result.exit_code == 0

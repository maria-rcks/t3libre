"""Unit tests for output styling, output formatter edge cases and lazy core exports."""

import pytest


class TestPrintTable:
    def test_prints_rows(self, capsys):
        from cli.ipilot.output.styling import print_table

        print_table([{"name": "web", "status": "ok"}], title="Servers")
        out = capsys.readouterr().out
        assert "web" in out
        assert "ok" in out

    def test_prints_no_data_warning_when_empty(self, capsys):
        from cli.ipilot.output.styling import print_table

        print_table([])
        out = capsys.readouterr().out
        assert "no data" in out


class TestPrintPanel:
    def test_prints_panel(self, capsys):
        from cli.ipilot.output.styling import print_panel

        print_panel("hello world", title="Info", style="blue")
        out = capsys.readouterr().out
        assert "hello world" in out


class TestPrintJson:
    def test_prints_json(self, capsys):
        from cli.ipilot.output.styling import print_json

        print_json({"key": "value"})
        out = capsys.readouterr().out
        assert "key" in out

    def test_handles_serialisation_error(self, capsys):
        from cli.ipilot.output.styling import print_json

        cyclic = []
        cyclic.append(cyclic)
        print_json(cyclic)
        out = capsys.readouterr().out
        assert "Error serialising JSON" in out


class TestMessageHelpers:
    def test_print_error(self, capsys):
        from cli.ipilot.output.styling import print_error

        print_error("boom")
        assert "Error:" in capsys.readouterr().out

    def test_print_success(self, capsys):
        from cli.ipilot.output.styling import print_success

        print_success("done")
        assert "done" in capsys.readouterr().out

    def test_print_info(self, capsys):
        from cli.ipilot.output.styling import print_info

        print_info("notice")
        assert "notice" in capsys.readouterr().out

    def test_get_console_returns_shared_instance(self):
        from cli.ipilot.output.styling import _console, get_console

        assert get_console() is _console


class TestSpinner:
    def test_spinner_context_manager(self):
        from cli.ipilot.output.styling import spinner

        with spinner() as progress:
            task = progress.add_task("working", total=10)
            progress.update(task, completed=5)


class TestFormatterEdgeCases:
    def test_yaml_list_of_dicts(self):
        from cli.ipilot.output.formatters import format_yaml

        result = format_yaml([{"a": 1}])
        assert result == "-\n  a: 1"

    def test_yaml_scalar(self):
        from cli.ipilot.output.formatters import format_yaml

        assert format_yaml("just-a-string") == "just-a-string"

    def test_yaml_nested_list_in_list(self):
        from cli.ipilot.output.formatters import format_yaml

        result = format_yaml([1, [2, 3]])
        assert "- 1" in result
        assert "- 2" in result

    def test_dict_table_direct_empty(self):
        from cli.ipilot.output.formatters import _dict_table

        assert _dict_table([]) == "(no data)"

    def test_key_value_table_direct_error(self):
        from cli.ipilot.output.formatters import _key_value_table

        assert _key_value_table({"error": "nope"}) == "Error: nope"


class TestCoreLazyExports:
    def test_lazy_getattr_loads_cli_functions(self):
        import cli.ipilot.core as core

        from cli.ipilot.core.cli import create_app, get_client

        assert core.create_app is create_app
        assert core.get_client is get_client

    def test_lazy_getattr_unknown_raises(self):
        import cli.ipilot.core as core

        with pytest.raises(AttributeError):
            core.does_not_exist
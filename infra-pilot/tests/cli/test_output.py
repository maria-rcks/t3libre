import pytest
import json


class TestFormatOutput:
    def test_format_output_json(self):
        from cli.ipilot.output import format_output

        data = {"key": "value", "num": 42}
        result = format_output(data, "json")
        parsed = json.loads(result)
        assert parsed == data

    def test_format_output_table_dict(self):
        from cli.ipilot.output import format_output

        data = {"name": "test", "status": "ok"}
        result = format_output(data, "table")
        assert "name" in result
        assert "test" in result
        assert "status" in result
        assert "ok" in result

    def test_format_output_table_list(self):
        from cli.ipilot.output import format_output

        data = [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}]
        result = format_output(data, "table")
        assert result.splitlines() == [
            "id | name",
            "---+-----",
            "1  | A   ",
            "2  | B   ",
        ]

    def test_format_output_unknown_format_falls_back(self):
        from cli.ipilot.output import format_output

        data = {"key": "val"}
        result = format_output(data, "invalid_format")
        assert result == "key : val"


class TestFormatJson:
    def test_format_json_dict(self):
        from cli.ipilot.output import format_json

        result = format_json({"a": 1, "b": 2})
        assert json.loads(result) == {"a": 1, "b": 2}

    def test_format_json_list(self):
        from cli.ipilot.output import format_json

        result = format_json([1, 2, 3])
        assert json.loads(result) == [1, 2, 3]

    def test_format_json_with_non_serializable(self):
        from cli.ipilot.output import format_json

        class Custom:
            def __str__(self):
                return "custom_str"

        result = format_json({"obj": Custom()})
        parsed = json.loads(result)
        assert parsed["obj"] == "custom_str"


class TestFormatTable:
    def test_format_table_list_of_dicts(self):
        from cli.ipilot.output import format_table

        data = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
        result = format_table(data)
        assert "a" in result
        assert "b" in result
        assert result.count("\n") >= 3

    def test_format_table_empty_list(self):
        from cli.ipilot.output import format_table

        assert format_table([]) == "(no data)"

    def test_format_table_list_of_strings(self):
        from cli.ipilot.output import format_table

        result = format_table(["foo", "bar"])
        assert "foo" in result
        assert "bar" in result

    def test_format_table_dict_with_error(self):
        from cli.ipilot.output import format_table

        result = format_table({"error": "not found"})
        assert "Error: not found" in result

    def test_format_table_dict_with_list_value(self):
        from cli.ipilot.output import format_table

        data = {"items": [{"x": 1}, {"x": 2}]}
        result = format_table(data)
        assert "x" in result

    def test_format_table_dict_key_value(self):
        from cli.ipilot.output import format_table

        data = {"name": "test", "status": "active"}
        result = format_table(data)
        assert "name" in result
        assert "test" in result
        assert "status" in result
        assert "active" in result

    def test_format_table_plain_string(self):
        from cli.ipilot.output import format_table

        assert format_table("hello") == "hello"


class TestFormatYaml:
    def test_format_yaml_dict(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml({"name": "test", "count": 42})
        assert "name: test" in result
        assert "count: 42" in result

    def test_format_yaml_nested(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml({"server": {"host": "localhost", "port": 8080}})
        assert "server:" in result
        assert "host: localhost" in result
        assert "port: 8080" in result

    def test_format_yaml_list(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml(["a", "b", "c"])
        assert "- a" in result
        assert "- c" in result

    def test_format_yaml_none_value(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml({"key": None})
        assert "key: null" in result

    def test_format_yaml_bool_value(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml({"enabled": True, "disabled": False})
        assert "enabled: true" in result
        assert "disabled: false" in result

    def test_format_yaml_string_with_special_chars(self):
        from cli.ipilot.output import format_yaml

        result = format_yaml({"url": "http://example.com"})
        assert "'http://example.com'" in result


class TestFormatPlain:
    def test_format_plain_list(self):
        from cli.ipilot.output import format_plain

        result = format_plain(["a", "b", "c"])
        assert result == "a\nb\nc"

    def test_format_plain_dict(self):
        from cli.ipilot.output import format_plain

        result = format_plain({"name": "test", "status": "ok"})
        assert "name: test" in result
        assert "status: ok" in result

    def test_format_plain_dict_with_error(self):
        from cli.ipilot.output import format_plain

        result = format_plain({"error": "not found"})
        assert "Error: not found" in result

    def test_format_plain_string(self):
        from cli.ipilot.output import format_plain

        assert format_plain("hello") == "hello"


class TestPrintOutput:
    def test_print_output_writes_to_stdout(self, capsys):
        from cli.ipilot.output import print_output

        print_output({"key": "val"}, "json")
        captured = capsys.readouterr()
        assert '"key"' in captured.out
        assert '"val"' in captured.out

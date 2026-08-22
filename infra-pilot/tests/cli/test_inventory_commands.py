"""Unit tests for the inventory command group."""

from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner


@pytest.fixture
def client():
    return MagicMock()


@pytest.fixture
def runner(client, monkeypatch, tmp_path):
    from cli.ipilot.commands import inventory

    monkeypatch.setattr(inventory, "_get_client", lambda ctx: client)
    config_dir = tmp_path / ".ipilot"
    monkeypatch.setattr("cli.ipilot.config.CONFIG_DIR", str(config_dir))
    monkeypatch.setattr("cli.ipilot.config.CONFIG_FILE", str(config_dir / "config.json"))
    return CliRunner()


@pytest.fixture
def invoke(runner):
    from cli.ipilot.main import app as main_app

    return lambda args, **kwargs: runner.invoke(main_app, args, **kwargs)


def test_list_passes_filters(client, invoke):
    client.list_inventory.return_value = [{"id": "srv-1", "name": "web"}]
    result = invoke(
        ["inventory", "list", "--tag", "prod", "--environment", "staging", "--region", "eu"]
    )
    assert result.exit_code == 0
    client.list_inventory.assert_called_once_with(tag="prod", environment="staging", region="eu")


def test_list_handles_dict_response(client, invoke):
    client.list_inventory.return_value = {"inventory": [{"id": "srv-1"}]}
    result = invoke(["inventory", "list"])
    assert result.exit_code == 0


def test_show(client, invoke):
    client.get_inventory.return_value = {"id": "srv-1"}
    result = invoke(["inventory", "show", "srv-1"])
    assert result.exit_code == 0
    client.get_inventory.assert_called_once_with("srv-1")


def test_update_builds_metadata(client, invoke):
    client.update_inventory.return_value = {"id": "srv-1"}
    result = invoke(
        [
            "inventory",
            "update",
            "srv-1",
            "--owner",
            "team-x",
            "--cost",
            "42.5",
            "--tags",
            "a, b",
        ]
    )
    assert result.exit_code == 0
    _, metadata = client.update_inventory.call_args.args
    assert metadata == {"owner": "team-x", "cost": 42.5, "tags": ["a", "b"]}


def test_update_ignores_unset_options(client, invoke):
    client.update_inventory.return_value = {}
    result = invoke(["inventory", "update", "srv-1"])
    assert result.exit_code == 0
    _, metadata = client.update_inventory.call_args.args
    assert metadata == {}


def test_tags_add(client, invoke):
    result = invoke(["inventory", "tags", "--add", "srv-1:prod"])
    assert result.exit_code == 0
    client.add_inventory_tag.assert_called_once_with("srv-1", "prod")


def test_tags_remove(client, invoke):
    result = invoke(["inventory", "tags", "--remove", "srv-1:old"])
    assert result.exit_code == 0
    client.remove_inventory_tag.assert_called_once_with("srv-1", "old")


def test_tags_for_server(client, invoke):
    result = invoke(["inventory", "tags", "--server", "srv-1"])
    assert result.exit_code == 0
    client.get_inventory_tags.assert_called_once_with("srv-1")


def test_tags_list_all(client, invoke):
    result = invoke(["inventory", "tags", "--list"])
    assert result.exit_code == 0
    client.list_inventory_tags.assert_called_once()

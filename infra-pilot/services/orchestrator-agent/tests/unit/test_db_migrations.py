"""Unit tests for the Alembic migration integration (integration.py)."""

import pytest

from integration import _build_database_url, init_database_tables, run_db_migrations


def test_build_database_url_uses_database_url_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@db:5433/demo")
    assert _build_database_url() == "postgresql://user:pw@db:5433/demo"


def test_build_database_url_falls_back_to_config_values(monkeypatch):
    from config import config

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(config, "DB_HOST", "db.internal")
    monkeypatch.setattr(config, "DB_PORT", "5433")
    monkeypatch.setattr(config, "DB_USER", "app")
    monkeypatch.setattr(config, "DB_PASSWORD", "secret")
    monkeypatch.setattr(config, "DB_NAME", "pilot")
    url = _build_database_url()
    assert url == "postgresql://app:secret@db.internal:5433/pilot"


@pytest.mark.asyncio
async def test_init_database_tables_runs_alembic_upgrade_head(monkeypatch):
    """init_database_tables must apply migrations up to head."""
    captured = {}

    def fake_upgrade(cfg, revision):
        captured["revision"] = revision
        captured["script_location"] = cfg.get_main_option("script_location")
        captured["url"] = cfg.get_main_option("sqlalchemy.url")

    import alembic.command

    monkeypatch.setattr(alembic.command, "upgrade", fake_upgrade)
    await init_database_tables()
    assert captured["revision"] == "head"
    assert captured["script_location"].endswith("alembic")
    assert captured["url"].startswith("postgresql://")


@pytest.mark.asyncio
async def test_init_database_tables_propagates_migration_failures(monkeypatch):
    """A failed migration must surface as an exception, not be swallowed."""

    import alembic.command

    def failing_upgrade(cfg, revision):
        raise RuntimeError("migration failed")

    monkeypatch.setattr(alembic.command, "upgrade", failing_upgrade)
    with pytest.raises(RuntimeError, match="migration failed"):
        await init_database_tables()

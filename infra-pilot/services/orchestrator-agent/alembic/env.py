"""Alembic migration environment for the Orchestrator Agent.

Reads the same environment variables as config.py (DB_HOST, DB_PORT,
DB_USER, DB_PASSWORD, DB_NAME), or a full DATABASE_URL when set.
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def build_database_url() -> str:
    """Build a SQLAlchemy URL from DATABASE_URL or the DB_* variables."""
    database_url = os.getenv("DATABASE_URL", "")
    if database_url:
        return database_url.replace("postgres://", "postgresql://")
    return "postgresql://{user}:{password}@{host}:{port}/{name}".format(
        user=os.getenv("DB_USER", "infra_pilot"),
        password=os.getenv("DB_PASSWORD", "CHANGE_ME"),
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        name=os.getenv("DB_NAME", "infra_pilot"),
    )


config.set_main_option("sqlalchemy.url", build_database_url())

target_metadata = None


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL without a database)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against a real connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

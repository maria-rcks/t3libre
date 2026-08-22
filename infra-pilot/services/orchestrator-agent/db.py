"""Async PostgreSQL connection pool and helpers.

Replaces the previous MySQL (mysql.connector) approach with PostgreSQL
via asyncpg for async operations and psycopg2 for sync helpers.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

import asyncpg
import psycopg2
import psycopg2.extras
from config import config

logger = logging.getLogger(__name__)


class DatabasePool:
    """Async PostgreSQL connection pool.

    Usage::

        pool = await DatabasePool.create()
        rows = await pool.fetch("SELECT * FROM vps_containers WHERE user_id = $1", user_id)
        await pool.close()
    """

    def __init__(self):
        self._pool: Optional[asyncpg.Pool] = None

    @classmethod
    async def create(
        cls,
        host: Optional[str] = None,
        port: Optional[int] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
        database: Optional[str] = None,
        min_size: int = 2,
        max_size: int = 10,
    ) -> "DatabasePool":
        pool = cls()
        pool._pool = await asyncpg.create_pool(
            host=host or config.DB_HOST,
            port=port or config.DB_PORT,
            user=user or config.DB_USER,
            password=password or config.DB_PASSWORD,
            database=database or config.DB_NAME,
            min_size=min_size,
            max_size=max_size,
        )
        logger.info(
            "Database pool created: %s@%s:%d/%s",
            config.DB_USER,
            config.DB_HOST,
            config.DB_PORT,
            config.DB_NAME,
        )
        return pool

    async def fetch(self, query: str, *args: Any) -> List[asyncpg.Record]:
        if not self._pool:
            raise RuntimeError("Database pool not initialised")
        async with self._pool.acquire() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> Optional[asyncpg.Record]:
        if not self._pool:
            raise RuntimeError("Database pool not initialised")
        async with self._pool.acquire() as conn:
            return await conn.fetchrow(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        if not self._pool:
            raise RuntimeError("Database pool not initialised")
        async with self._pool.acquire() as conn:
            return await conn.execute(query, *args)

    async def executemany(self, query: str, args: List[tuple]) -> None:
        if not self._pool:
            raise RuntimeError("Database pool not initialised")
        async with self._pool.acquire() as conn:
            await conn.executemany(query, args)

    async def acquire(self):
        """Get a raw asyncpg connection from the pool.

        Use as an async context manager::

            async with pool.acquire() as conn:
                await conn.execute(...)
        """
        if not self._pool:
            raise RuntimeError("Database pool not initialised")
        return await self._pool.acquire()

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
            self._pool = None
            logger.info("Database pool closed")


# Singleton for app-wide usage
_db_pool: Optional[DatabasePool] = None


async def get_pool() -> DatabasePool:
    """Get or create the singleton database pool."""
    global _db_pool
    if _db_pool is None:
        _db_pool = await DatabasePool.create()
    return _db_pool


async def close_pool() -> None:
    """Close the singleton pool."""
    global _db_pool
    if _db_pool:
        await _db_pool.close()
        _db_pool = None


# ---------------------------------------------------------------------------
# Synchronous helper for places that need a sync connection
# (e.g. VPSManager's _get_db_connection)
# ---------------------------------------------------------------------------
def get_sync_connection():
    """Create a synchronous psycopg2 connection.

    Returns:
        A ``psycopg2.connection`` instance.
    """
    return psycopg2.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        dbname=config.DB_NAME,
    )


def get_sync_cursor():
    """Create a synchronous cursor with dict row factory."""
    conn = get_sync_connection()
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

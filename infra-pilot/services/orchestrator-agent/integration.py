"""Integration layer: database migrations, PostgreSQL helpers, and notification proxying."""

import asyncio
import logging
import os
from typing import Any, Dict, Optional

import requests
from config import config

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 5


def _send_request(
    method: str, endpoint: str, data: Optional[Dict[str, Any]] = None
) -> tuple:
    """Send an HTTP request to the integration service.

    Args:
        method: HTTP method (GET or POST).
        endpoint: API endpoint path.
        data: Optional JSON payload for POST requests.

    Returns:
        A tuple of ``(success, response_data)``.
    """
    url = f"{config.INTEGRATION_SERVICE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, timeout=REQUEST_TIMEOUT)
        elif method == "POST":
            response = requests.post(url, json=data, timeout=REQUEST_TIMEOUT)
        else:
            logger.warning("Unsupported HTTP method: %s", method)
            return False, None

        if response.status_code in (200, 201):
            return True, response.json()
        logger.warning(
            "Request failed with status %s: %s", response.status_code, response.text
        )
        return False, None
    except requests.Timeout:
        logger.warning("Request timeout for %s", endpoint)
        return False, None
    except requests.RequestException as exc:
        logger.warning("Request error for %s: %s", endpoint, exc)
        return False, None
    except ValueError as exc:
        logger.warning("Failed to parse response JSON: %s", exc)
        return False, None


def get_db_connection():
    """Create and return a new PostgreSQL database connection.

    Returns:
        A ``psycopg2.connection`` instance.
    """
    from db import get_sync_connection

    return get_sync_connection()


def _build_database_url() -> str:
    """Build a SQLAlchemy URL from DATABASE_URL or the DB_* config values."""
    database_url = os.getenv("DATABASE_URL", "")
    if database_url:
        return database_url.replace("postgres://", "postgresql://")
    return "postgresql://{user}:{password}@{host}:{port}/{name}".format(
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        host=config.DB_HOST,
        port=config.DB_PORT,
        name=config.DB_NAME,
    )


def run_db_migrations() -> None:
    """Apply all pending Alembic migrations to the configured database.

    Migrations live in ``alembic/versions/`` and are the single source of
    truth for the schema. Run synchronously (blocking) at startup; the
    async wrapper below offloads it to a worker thread.
    """
    from alembic import command
    from alembic.config import Config

    service_root = os.path.dirname(os.path.abspath(__file__))
    cfg = Config(os.path.join(service_root, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(service_root, "alembic"))
    cfg.set_main_option("sqlalchemy.url", _build_database_url())
    command.upgrade(cfg, "head")
    logger.info("Database migrations applied (upgrade head)")


async def init_database_tables():
    """Apply all pending database migrations.

    Kept as an async function with the historical name so existing call
    sites (main.py) stay unchanged. Runs ``alembic upgrade head``.
    """
    await asyncio.to_thread(run_db_migrations)


async def notify_integration(event_type: str, data: Dict[str, Any]) -> bool:
    """Send a server event notification to the integration service.

    Args:
        event_type: The type of event (e.g. ``server_created``).
        data: Event payload data.

    Returns:
        ``True`` if the notification was sent successfully.
    """
    payload = {
        "event_type": event_type,
        "server_name": data.get("server_name"),
        "details": data,
    }
    success, _ = _send_request("POST", "/api/notifications/server-event", payload)
    return success


async def notify_server_created(server_id: str, server_name: str) -> bool:
    """Notify that a server was created."""
    data = {
        "server_id": server_id,
        "server_name": server_name,
        "service": "orchestrator",
    }
    return await notify_integration("server_created", data)


async def notify_server_started(server_id: str, server_name: str) -> bool:
    """Notify that a server was started."""
    data = {
        "server_id": server_id,
        "server_name": server_name,
        "service": "orchestrator",
    }
    return await notify_integration("server_started", data)


async def notify_server_stopped(server_id: str, server_name: str) -> bool:
    """Notify that a server was stopped."""
    data = {
        "server_id": server_id,
        "server_name": server_name,
        "service": "orchestrator",
    }
    return await notify_integration("server_stopped", data)


async def notify_server_deleted(server_id: str, server_name: str) -> bool:
    """Notify that a server was deleted."""
    data = {
        "server_id": server_id,
        "server_name": server_name,
        "service": "orchestrator",
    }
    return await notify_integration("server_deleted", data)


async def sync_user_to_integration(
    user_id: str, email: str, username: str
) -> Dict[str, Any]:
    """Synchronise a user record to the integration service.

    Args:
        user_id: The Discord user ID.
        email: The user's email address.
        username: The user's display name.

    Returns:
        The API response dict, or an empty dict on failure.
    """
    payload = {"email": email, "username": username, "discord_id": user_id}
    success, response = _send_request("POST", "/api/users", payload)
    return response or {}


async def get_unified_metrics() -> Dict[str, Any]:
    """Fetch unified dashboard metrics from the integration service.

    Returns:
        The metrics response dict, or an empty dict on failure.
    """
    success, response = _send_request("GET", "/api/metrics/dashboard")
    return response or {}


async def broadcast_notification(message: str, title: str = "Notification") -> bool:
    """Broadcast a notification through the integration service.

    Args:
        message: The notification body.
        title: The notification title.

    Returns:
        ``True`` if broadcast was successful.
    """
    payload = {"content": message, "title": title}
    success, _ = _send_request("POST", "/api/notifications", payload)
    return success

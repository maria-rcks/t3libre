"""Orchestrator Agent entry point - webhook and API server.

Discord functionality moved to services/discord-service (single bot).
Run database migrations, then serve GitOps webhooks, RBAC, federation,
deployments, metrics and health endpoints.
"""

import asyncio
import logging
import os
import sys

from integration import init_database_tables
from webhook_server import start_webhook_server

logger = logging.getLogger(__name__)


async def run_server():
    """Initialize database tables and start the webhook/API server."""
    await init_database_tables()
    logger.info("Database tables initialised")

    await start_webhook_server()
    await asyncio.Event().wait()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler()],
    )

    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("Server shutting down")
        sys.exit(0)
"""Discord token validation utilities."""

import logging

import requests

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"


def validate_discord_token(token: str) -> dict:
    """Validate a Discord bot token against the Discord API.

    Args:
        token: The Discord bot token to validate.

    Returns:
        A dict with ``valid`` (bool), optionally ``botName``,
        ``guildCount``, or ``error``.
    """
    headers = {"Authorization": f"Bot {token}"}
    try:
        resp = requests.get(
            f"{DISCORD_API_BASE}/users/@me", headers=headers, timeout=10
        )
        if resp.status_code == 200:
            user_data = resp.json()
            guild_resp = requests.get(
                f"{DISCORD_API_BASE}/users/@me/guilds",
                headers=headers,
                timeout=10,
            )
            guild_count = len(guild_resp.json()) if guild_resp.ok else 0
            return {
                "valid": True,
                "botName": user_data.get("username", ""),
                "guildCount": guild_count,
            }
        elif resp.status_code == 401:
            return {"valid": False, "error": "Invalid token"}
        return {"valid": False, "error": "Discord API error"}
    except requests.RequestException as exc:
        logger.warning("Failed to validate Discord token: %s", exc)
        return {"valid": False, "error": "Failed to validate token"}

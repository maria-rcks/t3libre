"""Best-effort persistence of RBAC state to PostgreSQL.

The RBAC engine is in-memory; these helpers sync organizations, custom
roles and role assignments into the tables created by
``integration.init_database_tables`` so state survives restarts.

Every function fails soft: when the database is unavailable the change
is logged, the ``rbac_persist_failures_total`` metric is incremented and
the in-memory state still applies.
"""

import json
import logging

import db

logger = logging.getLogger(__name__)

# Failures are counted so a database outage cannot silently degrade the
# API into a no-persistence mode. Exposed on /metrics as
# rbac_persist_failures_total by webhook_server.metrics.
rbac_persist_failures = 0


def _record_persistence_failure(what: str, exc: Exception) -> None:
    """Log a suppressed persistence failure and bump the failure metric."""
    global rbac_persist_failures
    rbac_persist_failures += 1
    logger.warning("Failed to persist %s: %s", what, exc)


async def persist_org(org) -> None:
    """Upsert an organization row (best-effort)."""
    try:
        pool = await db.get_pool()
        await pool.execute(
            """
            INSERT INTO organizations
                (id, name, owner_user_id, settings, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                owner_user_id = EXCLUDED.owner_user_id,
                settings = EXCLUDED.settings,
                is_active = EXCLUDED.is_active,
                updated_at = EXCLUDED.updated_at
            """,
            org.id,
            org.name,
            org.owner_user_id,
            json.dumps(org.settings) if org.settings else None,
            org.is_active,
            org.created_at,
            org.updated_at,
        )
    except Exception as exc:
        _record_persistence_failure(f"org {org.id}", exc)


async def persist_role(role) -> None:
    """Upsert a custom role row (built-ins are re-seeded on start)."""
    if role.is_builtin:
        return
    try:
        pool = await db.get_pool()
        await pool.execute(
            """
            INSERT INTO roles (name, permissions, is_builtin, description)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (name) DO UPDATE SET
                permissions = EXCLUDED.permissions,
                description = EXCLUDED.description
            """,
            role.name,
            json.dumps(sorted(p.value for p in role.permissions)),
            False,
            role.description,
        )
    except Exception as exc:
        _record_persistence_failure(f"role {role.name}", exc)


async def persist_membership(membership) -> None:
    """Upsert a role assignment row (best-effort).

    The assignment identity is (user_id, org_id, project_id) via the
    ``uq_role_assignment`` unique index, so re-assigning a role updates
    the existing row instead of inserting duplicates. Loading restores
    exactly one current Membership per assignment.
    """
    try:
        pool = await db.get_pool()
        await pool.execute(
            """
            INSERT INTO role_assignments
                (user_id, org_id, project_id, role_name, granted_by, granted_at, expires_at)
            VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6, $7)
            ON CONFLICT (user_id, org_id, project_id) DO UPDATE SET
                role_name = EXCLUDED.role_name,
                granted_by = EXCLUDED.granted_by,
                granted_at = EXCLUDED.granted_at,
                expires_at = EXCLUDED.expires_at
            """,
            membership.user_id,
            membership.org_id,
            membership.project_id,
            membership.role_name,
            membership.granted_by,
            membership.granted_at,
            membership.expires_at,
        )
    except Exception as exc:
        _record_persistence_failure(
            f"membership {membership.user_id}@{membership.org_id}", exc
        )


async def delete_org(org_id: str) -> None:
    """Delete an organization row and its cascade (best-effort)."""
    try:
        pool = await db.get_pool()
        await pool.execute("DELETE FROM organizations WHERE id = $1", org_id)
    except Exception as exc:
        _record_persistence_failure(f"org delete {org_id}", exc)


async def delete_role(name: str) -> None:
    """Delete a custom role row (best-effort)."""
    try:
        pool = await db.get_pool()
        await pool.execute("DELETE FROM roles WHERE name = $1", name)
    except Exception as exc:
        _record_persistence_failure(f"role delete {name}", exc)


async def delete_membership(user_id: str, org_id: str, project_id: str = "") -> None:
    """Delete a role assignment row (best-effort)."""
    try:
        pool = await db.get_pool()
        await pool.execute(
            """
            DELETE FROM role_assignments
            WHERE user_id = $1 AND org_id = $2 AND project_id IS NOT DISTINCT FROM $3
            """,
            user_id,
            org_id,
            None if not project_id else project_id,
        )
    except Exception as exc:
        _record_persistence_failure(f"membership delete {user_id}@{org_id}", exc)


_LOAD_BATCH_SIZE = 1000


async def _fetch_paged(pool, query: str) -> list:
    """Fetch every matching row in bounded batches (LIMIT/OFFSET)."""
    rows = []
    offset = 0
    while True:
        batch = await pool.fetch(f"{query} LIMIT {_LOAD_BATCH_SIZE} OFFSET {offset}")
        rows.extend(batch)
        if len(batch) < _LOAD_BATCH_SIZE:
            return rows
        offset += _LOAD_BATCH_SIZE


async def load_rbac_state(engine) -> None:
    """Load persisted orgs/roles/assignments into the engine (best-effort).

    Intended to run once at startup against a fresh engine. When the
    database is unavailable the engine keeps its built-in roles only.
    Queries use explicit column lists and bounded batches so schema
    additions do not affect loading.
    """
    try:
        pool = await db.get_pool()
        org_rows = await _fetch_paged(
            pool,
            "SELECT id, name, owner_user_id, settings, is_active, created_at, updated_at FROM organizations",
        )
        role_rows = await _fetch_paged(
            pool, "SELECT name, permissions, is_builtin, description FROM roles"
        )
        member_rows = await _fetch_paged(
            pool,
            "SELECT user_id, org_id, project_id, role_name, granted_by, granted_at, expires_at FROM role_assignments",
        )
    except Exception as exc:
        logger.warning("Failed to load RBAC state: %s", exc)
        return

    orgs = []
    for row in org_rows:
        orgs.append(
            {
                "id": row["id"],
                "name": row["name"],
                "owner_user_id": row["owner_user_id"],
                "settings": row["settings"] or {},
                "is_active": row["is_active"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )

    roles = []
    for row in role_rows:
        try:
            permissions = json.loads(row["permissions"]) if row["permissions"] else []
        except (TypeError, ValueError):
            logger.warning("Ignoring malformed permissions for role %s", row["name"])
            permissions = []
        roles.append(
            {
                "name": row["name"],
                "permissions": permissions,
                "is_builtin": row["is_builtin"],
                "description": row["description"] or "",
            }
        )

    memberships = []
    for row in member_rows:
        memberships.append(
            {
                "user_id": row["user_id"],
                "org_id": row["org_id"],
                "project_id": row["project_id"] or "",
                "role_name": row["role_name"],
                "granted_by": row["granted_by"] or "",
                "granted_at": row["granted_at"],
                "expires_at": row["expires_at"],
            }
        )

    engine.restore({"orgs": orgs, "roles": roles, "memberships": memberships})
    logger.info(
        "RBAC state loaded: %d orgs, %d custom roles, %d memberships",
        len(orgs),
        len(roles),
        len(memberships),
    )

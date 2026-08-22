"""Unit tests for RBAC persistence (rbac_store + engine.restore)."""

import json
import unittest

from rbac import Membership, Organization, Permission, RBACEngine, Role
from rbac_store import (
    delete_membership,
    delete_org,
    delete_role,
    load_rbac_state,
    persist_membership,
    persist_org,
    persist_role,
)


class FakePool:
    """Records executes/fetches like a DatabasePool."""

    def __init__(self):
        self.executes = []
        self.org_rows = []
        self.role_rows = []
        self.member_rows = []
        self.fail = False

    async def execute(self, query, *args):
        if self.fail:
            raise RuntimeError("db down")
        self.executes.append((query, args))

    async def fetch(self, query):
        if self.fail:
            raise RuntimeError("db down")
        if "FROM organizations" in query:
            return self.org_rows
        if "FROM roles" in query:
            return self.role_rows
        return self.member_rows


class FakePoolTestCase(unittest.IsolatedAsyncioTestCase):
    """Shared FakePool + db.get_pool patch, restored after each test."""

    def setUp(self):
        self.pool = FakePool()

        import db

        self._orig = db.get_pool

        async def fake_get_pool():
            return self.pool

        db.get_pool = fake_get_pool
        self.addCleanup(self._restore_db)

    def _restore_db(self):
        import db

        db.get_pool = self._orig


class PersistTest(FakePoolTestCase):
    async def test_persist_org_upserts_row(self):
        org = Organization(id="org-1", name="Acme", owner_user_id="u-1")
        await persist_org(org)
        self.assertEqual(len(self.pool.executes), 1)
        query, args = self.pool.executes[0]
        self.assertIn("INSERT INTO organizations", query)
        self.assertEqual(args[0], "org-1")
        self.assertEqual(args[1], "Acme")

    async def test_persist_org_refreshes_mutable_fields_on_conflict(self):
        org = Organization(id="org-1", name="Acme", owner_user_id="u-1")
        await persist_org(org)
        query, _ = self.pool.executes[0]
        for column in (
            "owner_user_id",
            "settings",
            "is_active",
            "updated_at",
            "EXCLUDED.name",
        ):
            self.assertIn(column, query)

    async def test_persist_org_fails_soft(self):
        self.pool.fail = True
        org = Organization(id="org-1", name="Acme", owner_user_id="u-1")
        await persist_org(org)  # must not raise
        self.assertEqual(self.pool.executes, [])

    async def test_persist_role_skips_builtins(self):
        builtin = Role(
            name="owner",
            permissions=set(Permission),
            is_builtin=True,
        )
        await persist_role(builtin)
        self.assertEqual(self.pool.executes, [])

    async def test_persist_custom_role_serializes_permissions(self):
        role = Role(
            name="ops", permissions={Permission.MANIFEST_DEPLOY}, is_builtin=False
        )
        await persist_role(role)
        query, args = self.pool.executes[0]
        self.assertIn("INSERT INTO roles", query)
        self.assertEqual(args[0], "ops")
        self.assertEqual(json.loads(args[1]), ["manifest:deploy"])

    async def test_persist_role_refreshes_description_on_conflict(self):
        role = Role(
            name="ops", permissions={Permission.MANIFEST_DEPLOY}, is_builtin=False
        )
        await persist_role(role)
        query, args = self.pool.executes[0]
        self.assertIn("EXCLUDED.description", query)
        self.assertEqual(args[3], "")

    async def test_persist_membership_upserts_row(self):
        m = Membership(user_id="u-1", org_id="org-1", role_name="viewer")
        await persist_membership(m)
        query, args = self.pool.executes[0]
        self.assertIn("INSERT INTO role_assignments", query)
        self.assertIn("ON CONFLICT", query)
        self.assertEqual(args[0], "u-1")
        self.assertEqual(args[3], "viewer")

    async def test_persist_membership_fails_soft(self):
        self.pool.fail = True
        m = Membership(user_id="u-1", org_id="org-1", role_name="viewer")
        await persist_membership(m)  # must not raise

    async def test_delete_helpers_remove_rows(self):
        await delete_org("org-1")
        await delete_role("ops")
        await delete_membership("u-1", "org-1")
        self.assertEqual(len(self.pool.executes), 3)
        for query, args in self.pool.executes:
            self.assertIn("DELETE FROM", query)


class LoadTest(FakePoolTestCase):
    async def test_load_populates_engine(self):
        self.pool.org_rows = [
            {
                "id": "org-1",
                "name": "Acme",
                "owner_user_id": "u-owner",
                "settings": None,
                "is_active": True,
                "created_at": None,
                "updated_at": None,
            }
        ]
        self.pool.role_rows = [
            {
                "name": "ops",
                "permissions": json.dumps(["manifest:deploy", "instance:read"]),
                "is_builtin": False,
                "description": "ops role",
            }
        ]
        self.pool.member_rows = [
            {
                "user_id": "u-owner",
                "org_id": "org-1",
                "project_id": None,
                "role_name": "owner",
                "granted_by": "system",
                "granted_at": None,
                "expires_at": None,
            }
        ]
        engine = RBACEngine()
        await load_rbac_state(engine)
        self.assertIsNotNone(engine.get_org("org-1"))
        self.assertIsNotNone(engine.get_role("ops"))
        self.assertTrue(
            engine.has_permission("u-owner", Permission.MANIFEST_DEPLOY, org_id="org-1")
        )
        self.assertTrue(
            engine.has_permission("u-owner", Permission.ORG_DELETE, org_id="org-1")
        )

    async def test_load_fails_soft_without_db(self):
        self.pool.fail = True
        engine = RBACEngine()
        await load_rbac_state(engine)  # must not raise
        self.assertEqual(engine.list_orgs_for_user("u-1"), [])

    async def test_load_tolerates_malformed_permissions_json(self):
        self.pool.role_rows = [
            {
                "name": "broken",
                "permissions": "{not-valid-json",
                "is_builtin": False,
                "description": None,
            }
        ]
        engine = RBACEngine()
        await load_rbac_state(engine)  # must not raise
        role = engine.get_role("broken")
        self.assertIsNotNone(role)
        self.assertEqual(role.permissions, set())

    async def test_restore_filters_invalid_permissions_per_entry(self):
        engine = RBACEngine()
        engine.restore(
            {
                "orgs": [],
                "roles": [
                    {
                        "name": "mixed",
                        "permissions": ["manifest:deploy", "not-a-permission"],
                    }
                ],
                "memberships": [],
            }
        )
        role = engine.get_role("mixed")
        self.assertIsNotNone(role)
        self.assertEqual(role.permissions, {Permission.MANIFEST_DEPLOY})


if __name__ == "__main__":
    unittest.main()

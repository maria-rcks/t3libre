"""Integration tests for the RBAC management API on the webhook server."""

import os
import unittest
from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from webhook_server import build_webhook_app

BOT = SimpleNamespace(get_cog=lambda name: None)
AUTH = {"Authorization": "Bearer test-federation-token"}


class RbacApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["FEDERATION_API_TOKEN"] = "test-federation-token"
        self.app = await build_webhook_app(BOT)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.org_id = None

    async def asyncTearDown(self):
        os.environ.pop("FEDERATION_API_TOKEN", None)

    async def create_org(self, owner: str, name: str) -> str:
        resp = await self.client.post(
            "/api/v1/rbac/orgs",
            json={"name": name, "owner_user_id": owner},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 201)
        body = await resp.json()
        self.org_id = body["id"]
        return body

    async def test_rbac_routes_require_federation_token(self):
        resp = await self.client.post(
            "/api/v1/rbac/orgs", json={"name": "X", "owner_user_id": "u1"}
        )
        self.assertEqual(resp.status, 401)

    async def test_create_org_and_list_orgs_for_owner(self):
        body = await self.create_org("u-owner", "Acme")
        self.assertEqual(body["name"], "Acme")
        resp = await self.client.get(
            "/api/v1/rbac/orgs", params={"user_id": "u-owner"}, headers=AUTH
        )
        self.assertEqual(resp.status, 200)
        orgs = await resp.json()
        self.assertIn("Acme", [o["name"] for o in orgs["orgs"]])

    async def test_owner_has_all_permissions(self):
        body = await self.create_org("u-boss", "BossCorp")
        resp = await self.client.get(
            f"/api/v1/rbac/orgs/{body['id']}/permissions",
            params={"user_id": "u-boss"},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 200)
        perms = await resp.json()
        self.assertIn("org:manage", perms["permissions"])
        self.assertIn("instance:create", perms["permissions"])

    async def test_assigned_viewer_role_is_scoped(self):
        body = await self.create_org("u-admin", "Scoped")
        resp = await self.client.post(
            "/api/v1/rbac/assign",
            json={"user_id": "u-viewer", "org_id": body["id"], "role_name": "viewer"},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 201)
        resp = await self.client.get(
            f"/api/v1/rbac/orgs/{body['id']}/permissions",
            params={"user_id": "u-viewer"},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 200)
        perms = await resp.json()
        self.assertIn("instance:read", perms["permissions"])
        self.assertNotIn("instance:create", perms["permissions"])

    async def test_assign_unknown_role_is_rejected(self):
        body = await self.create_org("u-o", "NoRole")
        resp = await self.client.post(
            "/api/v1/rbac/assign",
            json={"user_id": "u-x", "org_id": body["id"], "role_name": "nope"},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 400)

    async def test_unknown_org_returns_404(self):
        resp = await self.client.get(
            "/api/v1/rbac/orgs/nope/permissions",
            params={"user_id": "u1"},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 404)

    async def test_custom_role_crud(self):
        resp = await self.client.post(
            "/api/v1/rbac/roles",
            json={"name": "deployer", "permissions": ["manifest:deploy"]},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 201)
        resp = await self.client.get("/api/v1/rbac/roles", headers=AUTH)
        self.assertEqual(resp.status, 200)
        roles = await resp.json()
        deployer = next(r for r in roles["roles"] if r["name"] == "deployer")
        self.assertEqual(deployer["permissions"], ["manifest:deploy"])

    async def test_custom_role_rejects_unknown_permission(self):
        resp = await self.client.post(
            "/api/v1/rbac/roles",
            json={"name": "bad", "permissions": ["does:not:exist"]},
            headers=AUTH,
        )
        self.assertEqual(resp.status, 400)

    async def test_org_members_listing(self):
        body = await self.create_org("u-m", "Members")
        resp = await self.client.get(
            f"/api/v1/rbac/orgs/{body['id']}/members", headers=AUTH
        )
        self.assertEqual(resp.status, 200)
        members = await resp.json()
        self.assertIn("u-m", [m["user_id"] for m in members["members"]])

    async def test_orgs_for_user_requires_user_id(self):
        resp = await self.client.get("/api/v1/rbac/orgs", headers=AUTH)
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()

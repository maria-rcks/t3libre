"""Unit tests for webhook authentication guards in main.py."""

import hashlib
import hmac
import os
import time
import unittest
from unittest.mock import AsyncMock

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from webhook_server import (
    WEBHOOK_REPLAY_WINDOW_SECONDS,
    _delivery_is_fresh,
    _seen_deliveries,
    _seen_signatures,
)


def make_request_with_headers(headers: dict, body: bytes = b'{"event":"push"}'):
    app = web.Application()

    async def handler(request):
        await request.read()
        return web.json_response({"handled": True})

    app.router.add_post("/webhook/github", handler)
    return app, handler, headers, body


class GitHubSignatureGuardTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from webhook_server import verify_github_signature

        self.guard = verify_github_signature
        self.secret = "test-secret"
        os.environ["GITHUB_WEBHOOK_SECRET"] = self.secret
        self.delivery_id = f"delivery-{time.monotonic_ns()}"

    async def asyncTearDown(self):
        os.environ.pop("GITHUB_WEBHOOK_SECRET", None)

    async def build_client(self, headers: dict, body: bytes):
        app = web.Application()
        handler = AsyncMock(return_value=web.json_response({"handled": True}))

        async def guarded(request):
            return await self.guard(request, handler)

        app.router.add_post("/webhook/github", guarded)
        client = TestClient(TestServer(app))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    def valid_signature(self, body: bytes) -> str:
        return (
            "sha256=" + hmac.new(self.secret.encode(), body, hashlib.sha256).hexdigest()
        )

    def headers(self, **extra) -> dict:
        return {"X-GitHub-Delivery": self.delivery_id, **extra}

    async def test_rejects_missing_signature(self):
        client = await self.build_client({}, b"")
        resp = await client.post(
            "/webhook/github",
            data=b"",
            headers=self.headers(),
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_wrong_signature(self):
        client = await self.build_client(
            {"X-Hub-Signature-256": "sha256=deadbeef"}, b"payload"
        )
        resp = await client.post(
            "/webhook/github",
            data=b"payload",
            headers=self.headers(**{"X-Hub-Signature-256": "sha256=deadbeef"}),
        )
        self.assertEqual(resp.status, 401)

    async def test_accepts_valid_signature(self):
        body = b'{"event":"push"}'
        sig = self.valid_signature(body)
        client = await self.build_client(
            self.headers(**{"X-Hub-Signature-256": sig}), body
        )
        resp = await client.post(
            "/webhook/github",
            data=body,
            headers=self.headers(**{"X-Hub-Signature-256": sig}),
        )
        self.assertEqual(resp.status, 200)

    async def test_rejects_missing_delivery_id(self):
        body = b'{"event":"push"}'
        sig = self.valid_signature(body)
        client = await self.build_client({}, body)
        resp = await client.post(
            "/webhook/github", data=body, headers={"X-Hub-Signature-256": sig}
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_replayed_delivery_id(self):
        body = b'{"event":"push"}'
        sig = self.valid_signature(body)
        client = await self.build_client({}, body)
        headers = self.headers(**{"X-Hub-Signature-256": sig})
        first = await client.post("/webhook/github", data=body, headers=headers)
        self.assertEqual(first.status, 200)
        replay = await client.post("/webhook/github", data=body, headers=headers)
        self.assertEqual(replay.status, 401)


class GitOpsTokenGuardTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from webhook_server import verify_gitops_token

        self.guard = verify_gitops_token
        self.secret = "test-token"
        os.environ["GITOPS_WEBHOOK_TOKEN"] = self.secret

    async def asyncTearDown(self):
        os.environ.pop("GITOPS_WEBHOOK_TOKEN", None)
        _seen_signatures.clear()

    async def build_client(self, headers: dict):
        app = web.Application()
        handler = AsyncMock(return_value=web.json_response({"handled": True}))

        async def guarded(request):
            return await self.guard(request, handler)

        app.router.add_post("/webhook/gitops", guarded)
        client = TestClient(TestServer(app))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    def signature(self, body: bytes, timestamp: str, secret: str = "") -> str:
        secret = secret or self.secret
        return (
            "sha256="
            + hmac.new(
                secret.encode(), f"{timestamp}\n".encode() + body, hashlib.sha256
            ).hexdigest()
        )

    def headers(self, body: bytes, **extra) -> dict:
        timestamp = str(int(time.time()))
        return {
            "X-Timestamp": timestamp,
            "X-Signature-256": self.signature(body, timestamp),
            **extra,
        }

    async def test_rejects_missing_token(self):
        client = await self.build_client({})
        resp = await client.post(
            "/webhook/gitops", data=b"{}", headers={"X-Timestamp": "0"}
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_wrong_secret(self):
        body = b"{}"
        timestamp = str(int(time.time()))
        headers = {
            "X-Timestamp": timestamp,
            "X-Signature-256": self.signature(body, timestamp, secret="nope"),
        }
        client = await self.build_client(headers)
        resp = await client.post("/webhook/gitops", data=body, headers=headers)
        self.assertEqual(resp.status, 401)

    async def test_accepts_valid_signature(self):
        body = b"{}"
        client = await self.build_client(self.headers(body))
        resp = await client.post(
            "/webhook/gitops", data=body, headers=self.headers(body)
        )
        self.assertEqual(resp.status, 200)

    async def test_rejects_tampered_body(self):
        body = b'{"manifest": {"a": 1}}'
        headers = self.headers(body)
        client = await self.build_client(headers)
        resp = await client.post(
            "/webhook/gitops",
            data=b'{"manifest": {"a": 2}}',
            headers=headers,
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_missing_signature(self):
        client = await self.build_client({})
        resp = await client.post(
            "/webhook/gitops",
            data=b"{}",
            headers={"Authorization": "Bearer test-token", "X-Timestamp": "1"},
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_missing_timestamp(self):
        body = b"{}"
        client = await self.build_client({})
        resp = await client.post(
            "/webhook/gitops",
            data=body,
            headers={"X-Signature-256": self.signature(body, "")},
        )
        self.assertEqual(resp.status, 401)

    async def test_rejects_stale_timestamp(self):
        body = b"{}"
        stale = str(int(time.time()) - WEBHOOK_REPLAY_WINDOW_SECONDS - 60)
        headers = {
            "X-Timestamp": stale,
            "X-Signature-256": self.signature(body, stale),
        }
        client = await self.build_client({})
        resp = await client.post("/webhook/gitops", data=body, headers=headers)
        self.assertEqual(resp.status, 401)

    async def test_rejects_malformed_timestamp(self):
        body = b"{}"
        headers = {
            "X-Timestamp": "soon",
            "X-Signature-256": self.signature(body, "soon"),
        }
        client = await self.build_client({})
        resp = await client.post("/webhook/gitops", data=body, headers=headers)
        self.assertEqual(resp.status, 401)

    async def test_rejects_replayed_signature(self):
        body = b"{}"
        headers = self.headers(body)
        client = await self.build_client(headers)
        first = await client.post("/webhook/gitops", data=body, headers=headers)
        self.assertEqual(first.status, 200)
        replay = await client.post("/webhook/gitops", data=body, headers=headers)
        self.assertEqual(replay.status, 401)


class FailClosedTest(unittest.IsolatedAsyncioTestCase):
    async def test_github_fails_closed_without_secret(self):
        os.environ.pop("GITHUB_WEBHOOK_SECRET", None)
        os.environ.pop("GITOPS_WEBHOOK_TOKEN", None)
        from webhook_server import verify_github_signature, verify_gitops_token

        app = web.Application()
        handler = AsyncMock(return_value=web.json_response({"handled": True}))

        async def guarded_github(request):
            return await verify_github_signature(request, handler)

        async def guarded_gitops(request):
            return await verify_gitops_token(request, handler)

        app.router.add_post("/webhook/github", guarded_github)
        app.router.add_post("/webhook/gitops", guarded_gitops)
        client = TestClient(TestServer(app))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        resp = await client.post("/webhook/github", data=b"{}")
        self.assertEqual(resp.status, 503)
        resp = await client.post("/webhook/gitops", data=b"{}")
        self.assertEqual(resp.status, 503)


class DeliveryDedupTest(unittest.IsolatedAsyncioTestCase):
    async def test_delivery_id_accepted_then_rejected(self):
        delivery_id = f"delivery-{time.monotonic_ns()}"
        self.assertTrue(_delivery_is_fresh(delivery_id))
        self.assertFalse(_delivery_is_fresh(delivery_id))

    async def test_distinct_delivery_ids_accepted(self):
        _seen_deliveries.clear()
        self.assertTrue(_delivery_is_fresh("a-1"))
        self.assertTrue(_delivery_is_fresh("a-2"))


if __name__ == "__main__":
    unittest.main()

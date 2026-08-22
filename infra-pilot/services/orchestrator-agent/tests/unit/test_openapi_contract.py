"""Contract test: the live route table must match api_docs/openapi.yaml.

api_docs/openapi.yaml is the single source of truth for the HTTP
surface of the orchestrator agent. This test fails in both directions:

* a route exists in the running app but is missing from the spec, or
* a path/method is documented in the spec but not registered.

It also rejects placeholder servers and fictional documentation, which
is what historically let the spec drift from reality.
"""

import asyncio
import pathlib

import pytest
import yaml

import webhook_server

SERVICE_ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC_PATH = SERVICE_ROOT / "api_docs" / "openapi.yaml"


@pytest.fixture(scope="module")
def spec() -> dict:
    assert SPEC_PATH.exists(), f"OpenAPI spec not found at {SPEC_PATH}"
    return yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def app():
    return asyncio.run(webhook_server.build_webhook_app(bot_instance=None))


def test_spec_is_valid_openapi(spec):
    assert str(spec.get("openapi", "")).startswith("3.")
    assert spec.get("info", {}).get("title")
    assert isinstance(spec.get("paths"), dict)


def test_spec_has_no_placeholder_servers(spec):
    for server in spec.get("servers", []):
        assert "example.com" not in server.get("url", ""), (
            "spec must not document placeholder servers"
        )


def _route_table(app) -> set:
    """Collect (METHOD, path) pairs from the running aiohttp app.

    HEAD is registered automatically for every GET route, so it is
    excluded here (OpenAPI implies HEAD via GET).
    """
    routes = set()
    for route in app.router.routes():
        if route.method.upper() == "HEAD":
            continue
        resource = getattr(route, "resource", None)
        canonical = getattr(resource, "canonical", None) or getattr(
            route, "path", None
        )
        routes.add((route.method.upper(), canonical))
    return routes


def test_every_registered_route_is_documented(app, spec):
    documented = {
        (method.upper(), path)
        for path, methods in spec["paths"].items()
        for method in methods
        if method.lower() in ("get", "post", "put", "patch", "delete", "head")
    }
    undocumented = _route_table(app) - documented
    assert not undocumented, (
        "routes registered in webhook_server.build_webhook_app are missing "
        f"from api_docs/openapi.yaml: {sorted(undocumented)}"
    )


def test_every_documented_route_is_registered(app, spec):
    documented = {
        (method.upper(), path)
        for path, methods in spec["paths"].items()
        for method in methods
        if method.lower() in ("get", "post", "put", "patch", "delete", "head")
    }
    unregistered = documented - _route_table(app)
    assert not unregistered, (
        "paths documented in api_docs/openapi.yaml are not registered in "
        f"webhook_server.build_webhook_app: {sorted(unregistered)}"
    )

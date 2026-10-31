import csv
import http.client
import io
import json
import urllib.request

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    """Fresh database, rate limiter and fake dist dir for every test."""
    monkeypatch.setenv("JIVIKA_DB_PATH", str(tmp_path / "db" / "jivika.db"))
    monkeypatch.delenv("JIVIKA_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("JIVIKA_TRUST_PROXY", raising=False)
    monkeypatch.delenv("JIVIKA_HSTS", raising=False)
    for name in ("JIVIKA_BASE_PATH", "VERCEL", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    main._rate_hits.clear()
    dist = tmp_path / "dist"
    for name, body in {
        "index.html": "landing",
        "404.html": "branded 404",
        "pricing/index.html": "pricing",
        "app/index.html": "react app",
        "assets/main-abc123.js": "console.log(1)",
        "robots.txt": "User-agent: *",
        "sitemap.xml": "<urlset/>",
    }.items():
        (dist / name).parent.mkdir(parents=True, exist_ok=True)
        (dist / name).write_text(body)
    (tmp_path / "secret.txt").write_text("outside dist")
    monkeypatch.setattr(main, "DIST_DIR", dist)
    yield


def join(email="Person@Example.com", **extra):
    return client.post("/api/waitlist", json={"email": email, **extra})


def export(token="s3cret"):
    return client.get("/api/admin/waitlist.csv", headers={"Authorization": f"Bearer {token}"})


# --- waitlist ---------------------------------------------------------------


def test_waitlist_stores_normalised_email_and_dedupes(monkeypatch):
    assert join("  Person@Example.com ", source="landing").json() == {"ok": True}
    assert join("person@example.com").json() == {"ok": True, "already": True}
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    rows = list(csv.reader(io.StringIO(export().text)))
    assert rows[0] == ["id", "email", "plan", "source", "created_at"]
    assert len(rows) == 2 and rows[1][1:4] == ["person@example.com", "pro", "landing"]
    assert rows[1][4].endswith("+00:00")


@pytest.mark.parametrize(
    "body",
    [
        {"email": "not-an-email"},
        {"email": "a@b"},
        {"email": "a b@example.com"},
        {"email": "x" * 250 + "@example.com"},
        {"email": "a@example.com", "plan": "enterprise"},
        {"email": "a@example.com", "source": "s" * 65},
        {},
    ],
)
def test_waitlist_rejects_invalid_input(body):
    assert client.post("/api/waitlist", json=body).status_code == 422


def test_waitlist_accepts_teams_plan(monkeypatch):
    assert join(plan="teams").status_code == 200
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    assert ",teams," in export().text


def test_honeypot_returns_ok_without_storing(monkeypatch):
    assert join(website="http://spam.example").json() == {"ok": True}
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    assert export().text.strip().count("\n") == 0  # header only


def test_rate_limit_per_ip():
    for i in range(5):
        assert join(f"user{i}@example.com").status_code == 200
    assert join("late@example.com").status_code == 429


def test_forwarded_for_only_trusted_when_enabled(monkeypatch):
    def burst(ip):
        return [client.post("/api/waitlist", json={"email": "a@example.com"}, headers={"X-Forwarded-For": ip}).status_code for _ in range(6)]

    assert burst("1.1.1.1")[-1] == 429  # header ignored: all share the socket address
    main._rate_hits.clear()
    monkeypatch.setenv("JIVIKA_TRUST_PROXY", "1")
    assert burst("2.2.2.2")[-1] == 429
    assert burst("spoofed, 3.3.3.3")[0] == 200


def test_rate_limit_dict_is_bounded(monkeypatch):
    monkeypatch.setattr(main, "RATE_MAX_IPS", 3)
    monkeypatch.setenv("JIVIKA_TRUST_PROXY", "1")
    for i in range(5):
        client.post("/api/waitlist", json={}, headers={"X-Forwarded-For": f"10.0.0.{i}"})
    assert list(main._rate_hits) == ["10.0.0.2", "10.0.0.3", "10.0.0.4"]


# --- admin export -----------------------------------------------------------


def test_admin_export_is_404_without_token_configured():
    assert export().status_code == 404


def test_admin_export_rejects_wrong_or_missing_token(monkeypatch):
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    assert export("wrong").status_code == 401
    assert client.get("/api/admin/waitlist.csv").status_code == 401
    assert client.get("/api/admin/waitlist.csv", headers={"Authorization": "s3cret"}).status_code == 401


def test_admin_export_is_csv_injection_safe(monkeypatch):
    join("a@example.com", source="=HYPERLINK(1)")
    join("b@example.com", source="@SUM(1)")
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    response = export()
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["cache-control"] == "no-store"
    rows = list(csv.reader(io.StringIO(response.text)))
    assert [r[3] for r in rows[1:]] == ["'=HYPERLINK(1)", "'@SUM(1)"]


# --- static site ------------------------------------------------------------


@pytest.mark.parametrize(
    "path, body",
    [
        ("/", "landing"),
        ("/pricing/", "pricing"),
        ("/app", "react app"),
        ("/app/", "react app"),
        ("/app/anything/here", "react app"),
        ("/robots.txt", "User-agent: *"),
        ("/sitemap.xml", "<urlset/>"),
    ],
)
def test_site_routes(path, body):
    response = client.get(path)
    assert response.status_code == 200 and response.text == body


def test_page_without_slash_redirects():
    response = client.get("/pricing?ref=x", follow_redirects=False)
    assert response.status_code == 308 and response.headers["location"] == "/pricing/?ref=x"


def test_assets_are_cached_and_js_mimetype():
    response = client.get("/assets/main-abc123.js")
    assert response.headers["content-type"].startswith("text/javascript")
    assert "immutable" in response.headers["cache-control"]


@pytest.mark.parametrize("path", ["/nope", "/nope/", "/pricing/missing.png", "/..%2fsecret.txt", "/%2e%2e/secret.txt"])
def test_unknown_paths_get_branded_404(path):
    response = client.get(path)
    assert response.status_code == 404 and response.text == "branded 404"


def test_api_404_stays_json():
    response = client.get("/api/nope")
    assert response.status_code == 404 and response.json() == {"detail": "Not found."}


def test_head_request_for_pages():
    assert client.head("/").status_code == 200


# --- security headers -------------------------------------------------------


def test_security_headers_on_pages_and_api():
    for path in ("/", "/api/health", "/nope"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
        assert "script-src 'self';" in headers["content-security-policy"]
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert "strict-transport-security" not in headers


def test_docs_skip_csp():
    headers = client.get("/api/docs").headers
    assert "content-security-policy" not in headers and headers["x-frame-options"] == "DENY"


def test_hsts_only_when_enabled(monkeypatch):
    monkeypatch.setenv("JIVIKA_HSTS", "1")
    assert client.get("/api/health").headers["strict-transport-security"].startswith("max-age=")


# --- base path (JIVIKA_BASE_PATH) -------------------------------------------


@pytest.fixture
def jivika(monkeypatch):
    monkeypatch.setenv("JIVIKA_BASE_PATH", "/jivika/")  # trailing slash is normalised away


@pytest.mark.parametrize(
    "path, body",
    [
        ("/jivika/", "landing"),
        ("/jivika", "landing"),  # served, not redirected: a 308 could loop behind the portfolio rewrite
        ("/jivika/pricing/", "pricing"),
        ("/jivika/app/", "react app"),
        ("/jivika/app/anything", "react app"),
        ("/jivika/sitemap.xml", "<urlset/>"),
        ("/jivika/assets/main-abc123.js", "console.log(1)"),
    ],
)
def test_base_path_site_routes(jivika, path, body):
    response = client.get(path)
    assert response.status_code == 200 and response.text == body
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


@pytest.mark.parametrize(
    "path, location",
    [
        ("/", "/jivika/"),
        ("/pricing/?ref=x", "/jivika/pricing/?ref=x"),
        ("/jivika/pricing?ref=x", "/jivika/pricing/?ref=x"),
        ("/jivikax", "/jivika/jivikax"),
    ],
)
def test_base_path_redirects(jivika, path, location):
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 308 and response.headers["location"] == location
    assert response.headers["x-frame-options"] == "DENY"


def test_base_path_api_and_404s(jivika):
    assert client.get("/jivika/api/health").json() == {"status": "ok"}
    assert client.get("/jivika/api/nope").json() == {"detail": "Not found."}
    response = client.get("/jivika/nope")
    assert response.status_code == 404 and response.text == "branded 404"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_base_path_waitlist_and_docs(jivika):
    assert client.post("/jivika/api/waitlist", json={"email": "a@example.com"}).json() == {"ok": True}
    docs = client.get("/jivika/api/docs")
    assert docs.status_code == 200 and "/jivika/api/openapi.json" in docs.text
    assert "content-security-policy" not in docs.headers
    assert client.get("/jivika/api/openapi.json").status_code == 200


# --- Upstash Redis waitlist store -------------------------------------------


@pytest.fixture
def fake_redis(monkeypatch):
    """Replace the single Upstash HTTP call with an in-memory hash."""
    store, calls = {}, []

    def fake(url, token, command):
        calls.append((url, token, command))
        op, key, *args = command
        hash_ = store.setdefault(key, {})
        if op == "HSETNX":
            if args[0] in hash_:
                return {"result": 0}
            hash_[args[0]] = args[1]
            return {"result": 1}
        if op == "HGETALL":
            return {"result": [x for kv in hash_.items() for x in kv]}
        return {"error": "ERR unknown command"}

    monkeypatch.setenv("KV_REST_API_URL", "https://kv.example/")
    monkeypatch.setenv("KV_REST_API_TOKEN", "redis-token")
    monkeypatch.setattr(main, "redis_http", fake)
    return store, calls


def test_redis_waitlist_dedupes_and_exports(fake_redis, monkeypatch):
    store, calls = fake_redis
    assert join("  Person@Example.com ", source="=cmd").json() == {"ok": True}
    assert join("person@example.com").json() == {"ok": True, "already": True}
    assert join("b@example.com", plan="teams").json() == {"ok": True}
    assert calls[0][:2] == ("https://kv.example", "redis-token")
    assert calls[0][2][:3] == ["HSETNX", "jivika:waitlist", "person@example.com"]
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    rows = list(csv.reader(io.StringIO(export().text)))
    assert rows[0] == ["id", "email", "plan", "source", "created_at"]
    assert [r[:4] for r in rows[1:]] == [["1", "person@example.com", "pro", "'=cmd"], ["2", "b@example.com", "teams", ""]]


def test_redis_export_tolerates_malformed_values(fake_redis, monkeypatch):
    store, _ = fake_redis
    store["jivika:waitlist"] = {"bad@example.com": "not json", "list@example.com": "[1]"}
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    response = export()
    assert response.status_code == 200
    assert {r[1] for r in csv.reader(io.StringIO(response.text))} == {"email", "bad@example.com", "list@example.com"}


def test_redis_http_request_shape(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen.update(req=req, timeout=timeout)
        return io.BytesIO(b'{"result":1}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert main.redis_http("https://kv.example", "tok", ["HSETNX", "jivika:waitlist", "a@example.com", "{}"]) == {"result": 1}
    req = seen["req"]
    assert req.get_method() == "POST" and req.full_url == "https://kv.example" and seen["timeout"] == 5
    assert req.get_header("Authorization") == "Bearer tok"
    assert json.loads(req.data) == ["HSETNX", "jivika:waitlist", "a@example.com", "{}"]


def test_upstash_variable_names_also_work(fake_redis, monkeypatch):
    monkeypatch.delenv("KV_REST_API_URL")
    monkeypatch.delenv("KV_REST_API_TOKEN")
    monkeypatch.setenv("UPSTASH_REDIS_REST_URL", "https://up.example")
    monkeypatch.setenv("UPSTASH_REDIS_REST_TOKEN", "up-token")
    assert join().status_code == 200
    assert fake_redis[1][0][:2] == ("https://up.example", "up-token")


@pytest.mark.parametrize(
    "failure", [OSError("connection refused"), ValueError("bad json"), http.client.IncompleteRead(b""), {"error": "WRONGPASS"}]
)
def test_redis_errors_are_503_without_leaking(failure, monkeypatch):
    monkeypatch.setenv("KV_REST_API_URL", "https://secret-host.example")
    monkeypatch.setenv("KV_REST_API_TOKEN", "secret-token")

    def broken(url, token, command):
        if isinstance(failure, Exception):
            raise failure
        return failure

    monkeypatch.setattr(main, "redis_http", broken)
    response = join()
    assert response.status_code == 503 and response.json() == {"detail": "The waitlist is temporarily unavailable."}
    assert "secret" not in response.text


def test_vercel_without_redis_refuses_waitlist(monkeypatch, tmp_path):
    monkeypatch.setenv("VERCEL", "1")
    response = join()
    assert response.status_code == 503 and response.json()["detail"] == "The waitlist is temporarily unavailable."
    assert not (tmp_path / "db").exists()  # nothing written to the ephemeral filesystem
    monkeypatch.setenv("JIVIKA_ADMIN_TOKEN", "s3cret")
    assert export().status_code == 503


def test_vercel_client_ip_headers(monkeypatch):
    def burst(headers):
        return [client.post("/api/waitlist", json={}, headers=headers).status_code for _ in range(6)]

    monkeypatch.setenv("JIVIKA_TRUST_PROXY", "1")
    assert burst({"X-Vercel-Forwarded-For": "4.4.4.4", "X-Forwarded-For": "9.9.9.9"})[0] == 422  # not limited yet
    assert main._rate_hits.keys() == {"9.9.9.9"}  # Vercel headers ignored off Vercel
    main._rate_hits.clear()
    monkeypatch.setenv("VERCEL", "1")
    burst({"X-Vercel-Forwarded-For": "4.4.4.4", "X-Forwarded-For": "9.9.9.9"})
    burst({"X-Real-IP": "5.5.5.5"})
    assert main._rate_hits.keys() == {"4.4.4.4", "5.5.5.5"}


def test_frontend_fallback_providers_match_server():
    import re
    from pathlib import Path

    from jivika.schemas import PROVIDERS

    src = (Path(__file__).parent.parent / "frontend/src/lib/api.ts").read_text(encoding="utf-8")
    block = src.split("FALLBACK_PROVIDERS")[1].split("]\n")[0]
    found = dict(re.findall(r"id: '([^']+)'.*?default_model: '([^']+)'", block))
    assert found == {pid: p["default_model"] for pid, p in PROVIDERS.items()}

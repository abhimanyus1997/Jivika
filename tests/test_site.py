import csv
import io

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

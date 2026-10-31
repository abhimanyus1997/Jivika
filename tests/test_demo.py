import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
DEMO_KEY = "gsk_demo-test-value"
JOB = {"resume": "Python developer", "job_description": "Python engineer"}


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def fake(provider, key, model, system, user, schema_model):
        seen.append({"provider": provider, "key": key, "model": model})
        return schema_model.model_validate({"match_score": 50, "ok": True})

    monkeypatch.setattr(main, "complete_json", fake)
    return seen


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_GROQ_KEY", DEMO_KEY)


def test_demo_disabled_without_key():
    body = client.get("/api/demo").json()
    assert body["enabled"] is False and body["remaining_hourly"] is None
    assert body["provider"] == "groq" and body["hourly_limit"] == 20 and body["daily_limit"] == 500


def test_no_key_and_no_demo_is_401(calls):
    assert client.post("/api/match", json=JOB).status_code == 401
    assert calls == []


def test_demo_used_when_no_key_and_client_choice_ignored(demo, calls):
    r = client.post("/api/match", json=JOB, headers={"X-LLM-Provider": "openai", "X-LLM-Model": "gpt-expensive"})
    assert r.status_code == 200
    assert calls == [{"provider": "groq", "key": DEMO_KEY, "model": main.PROVIDERS["groq"]["default_model"]}]
    assert r.headers["X-Jivika-Demo"] == "1" and r.headers["X-Jivika-Demo-Remaining"] == "19"
    assert DEMO_KEY not in r.text


def test_demo_model_override(demo, calls, monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_MODEL", "openai/gpt-oss-20b")
    client.post("/api/match", json=JOB)
    assert calls[0]["model"] == "openai/gpt-oss-20b"
    assert client.get("/api/demo").json()["model"] == "openai/gpt-oss-20b"


def test_demo_status_never_leaks_key(demo):
    r = client.get("/api/demo")
    body = r.json()
    assert body == {
        "enabled": True,
        "provider": "groq",
        "provider_name": "Groq",
        "model": main.PROVIDERS["groq"]["default_model"],
        "hourly_limit": 20,
        "daily_limit": 500,
        "remaining_hourly": 20,
    }
    assert DEMO_KEY not in r.text and "gsk_" not in r.text


def test_hourly_limit_per_ip(demo, calls, monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_HOURLY_LIMIT", "2")
    assert [client.post("/api/match", json=JOB).headers["X-Jivika-Demo-Remaining"] for _ in range(2)] == ["1", "0"]
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 429
    assert r.json()["detail"] == "Demo limit reached. Add your own API key in Settings to keep going."
    assert r.headers["X-Jivika-Demo"] == "1" and r.headers["X-Jivika-Demo-Remaining"] == "0"
    assert len(calls) == 2
    assert client.get("/api/demo").json()["remaining_hourly"] == 0
    monkeypatch.setenv("JIVIKA_TRUST_PROXY", "1")
    assert client.post("/api/match", json=JOB, headers={"X-Forwarded-For": "7.7.7.7"}).status_code == 200  # other IP


def test_daily_limit_is_global(demo, calls, monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_DAILY_LIMIT", "2")
    monkeypatch.setenv("JIVIKA_TRUST_PROXY", "1")
    codes = [client.post("/api/match", json=JOB, headers={"X-Forwarded-For": f"8.8.8.{i}"}).status_code for i in range(3)]
    assert codes == [200, 200, 429]


def test_user_key_bypasses_demo_and_is_not_counted(demo, calls, monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_HOURLY_LIMIT", "0")
    r = client.post("/api/match", json=JOB, headers={"X-LLM-Provider": "mistral", "X-LLM-Key": "user-key"})
    assert r.status_code == 200 and "X-Jivika-Demo" not in r.headers
    assert calls == [{"provider": "mistral", "key": "user-key", "model": "mistral-small-latest"}]
    assert main._demo_counts == {}


def test_verify_reports_demo_without_calling_groq(demo, calls):
    r = client.post("/api/providers/verify")
    assert r.json() == {"ok": True, "model": main.PROVIDERS["groq"]["default_model"], "demo": True, "provider": "groq", "remaining_hourly": 20}
    assert calls == [] and main._demo_counts == {}


@pytest.fixture
def fake_redis(monkeypatch):
    store, commands = {}, []

    def fake(url, token, command):
        commands.append(command)
        op, key = command[0], command[1]
        if op == "INCR":
            store[key] = store.get(key, 0) + 1
            return {"result": store[key]}
        if op == "GET":
            return {"result": str(store[key]) if key in store else None}
        return {"result": 1}

    monkeypatch.setenv("KV_REST_API_URL", "https://kv.example")
    monkeypatch.setenv("KV_REST_API_TOKEN", "t")
    monkeypatch.setattr(main, "redis_http", fake)
    return store, commands


def test_demo_limits_use_redis_when_configured(demo, calls, fake_redis, monkeypatch):
    store, commands = fake_redis
    monkeypatch.setenv("JIVIKA_DEMO_HOURLY_LIMIT", "1")
    assert client.post("/api/match", json=JOB).status_code == 200
    assert client.post("/api/match", json=JOB).status_code == 429
    assert main._demo_counts == {}
    ttls = [c[4] for c in commands if c[0] == "SET"]
    assert ttls[:2] == ["3600", "86400"] and all(c[-1] == "NX" for c in commands if c[0] == "SET")  # TTL set before INCR
    assert any(k.startswith("jivika:demo:ip:") for k in store) and any(k.startswith("jivika:demo:day:") for k in store)
    assert client.get("/api/demo").json()["remaining_hourly"] == 0


def test_redis_failure_falls_back_to_memory(demo, calls, monkeypatch):
    monkeypatch.setenv("KV_REST_API_URL", "https://kv.example")
    monkeypatch.setenv("KV_REST_API_TOKEN", "t")

    def broken(*args):
        raise OSError("down")

    monkeypatch.setattr(main, "redis_http", broken)
    assert client.post("/api/match", json=JOB).status_code == 200
    assert len(main._demo_counts) == 2
    assert client.get("/api/demo").json()["remaining_hourly"] is None


def test_invalid_requests_do_not_spend_demo_quota(demo, calls):
    assert client.post("/api/match", json={}).status_code == 422
    assert client.post("/api/linkedin/review", json={}).status_code == 422
    assert calls == [] and main._demo_counts == {}
    assert client.get("/api/demo").json()["remaining_hourly"] == 20


def test_rejected_demo_key_is_503_not_a_user_key_error(demo, monkeypatch):
    def rejected(*args):
        raise main.HTTPException(401, "The API key was rejected by Groq.")

    monkeypatch.setattr(main, "complete_json", rejected)
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 503 and r.json()["detail"] == main.DEMO_UNAVAILABLE


def test_ipv6_clients_share_a_64_bucket():
    a, _ = main._demo_windows("2001:db8:1:2::1")
    b, _ = main._demo_windows("2001:db8:1:2:ffff::9")
    assert a == b and "2001:db8:1:2::/64" in a
    assert main._demo_windows("1.2.3.4")[0] != main._demo_windows("1.2.3.5")[0]

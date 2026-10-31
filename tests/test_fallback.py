"""Model fallback for BYOK providers and the Groq demo pool (OpenAI client faked, no network)."""

import httpx
import openai
import pytest
from fastapi.testclient import TestClient

import main
from jivika import llm

client = TestClient(main.app)
GEMINI = {"X-LLM-Provider": "gemini", "X-LLM-Key": "AIza-test-key"}
PING = '{"ok": true}'


def error(cls, status, message="boom", headers=None):
    response = httpx.Response(status, headers=headers or {}, request=httpx.Request("POST", "https://example.test"))
    return cls(message, response=response, body=None)


def quota():
    return error(openai.RateLimitError, 429, "Error code: 429 RESOURCE_EXHAUSTED: You exceeded your current quota")


def overloaded():
    return error(openai.InternalServerError, 503, "The model is overloaded.")


class Fake:
    """script: model -> outcomes (exception or content), the last one repeating; headers are sent on success."""

    script: dict = {}
    headers: dict = {}
    seen: list = []

    def __init__(self, **kwargs):
        self.chat = self
        self.completions = self
        self.with_raw_response = self

    def create(self, **kwargs):
        Fake.seen.append(kwargs["model"])
        outcomes = Fake.script.get(kwargs["model"], [error(openai.NotFoundError, 404)])
        item = outcomes.pop(0) if len(outcomes) > 1 else outcomes[0]
        if isinstance(item, Exception):
            raise item
        message = type("M", (), {"content": item})
        completion = type("R", (), {"choices": [type("C", (), {"message": message})]})
        return type("Raw", (), {"headers": Fake.headers.get(kwargs["model"], {}), "parse": lambda self: completion})()


@pytest.fixture(autouse=True)
def fake(monkeypatch):
    Fake.script, Fake.headers, Fake.seen = {}, {}, []
    monkeypatch.setattr(main, "OpenAI", Fake)
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    for store in (llm._cool, llm._last, llm._pool):
        store.clear()
    return Fake


def verify(headers=GEMINI, model="gemini-3.8-flash"):
    return client.post("/api/providers/verify", headers={**headers, "X-LLM-Model": model} if model else headers)


def test_gemini_quota_falls_back_to_a_stable_model_and_says_so():
    Fake.script = {"gemini-3.8-flash": [quota()], "gemini-2.5-flash": [PING]}
    r = verify()
    assert r.status_code == 200
    assert r.json() == {"ok": True, "model": "gemini-2.5-flash", "fallback_from": "gemini-3.8-flash", "fallback_reason": "quota exceeded"}
    assert r.headers["X-Jivika-Model"] == "gemini-2.5-flash" and r.headers["X-Jivika-Fallback"] == "gemini-3.8-flash"
    assert r.headers["X-Jivika-Fallback-Reason"] == "quota exceeded"
    # The exhausted model cools down: the next request goes straight to the fallback.
    Fake.seen.clear()
    assert verify().json()["model"] == "gemini-2.5-flash" and Fake.seen == ["gemini-2.5-flash"]
    # Without a chosen model, the model that last answered for this key is used first.
    Fake.seen.clear()
    r = verify(model="")
    assert r.json() == {"ok": True, "model": "gemini-2.5-flash"} and "X-Jivika-Fallback" not in r.headers


def test_all_candidates_failing_keeps_429_with_the_reason_and_no_key():
    Fake.script = {m: [quota()] for m in ("gemini-3.8-flash", "gemini-2.5-flash", "gemini-flash-lite-latest")}
    r = verify()
    assert r.status_code == 429 and r.headers["Retry-After"] == "60"
    detail = r.json()["detail"]
    assert detail.startswith("Google Gemini quota exceeded for gemini-3.8-flash. Tried gemini-2.5-flash, gemini-flash-lite-latest: also unavailable.")
    assert "another model" in detail and "AIza" not in detail and "http" not in detail
    assert len(Fake.seen) == 3  # at most three models per request


def test_overloaded_model_is_retried_once_then_fails_over():
    Fake.script = {"gemini-3.5-flash": [overloaded(), overloaded()], "gemini-2.5-flash": [PING]}
    r = verify(model="gemini-3.5-flash")
    assert r.json()["model"] == "gemini-2.5-flash" and r.json()["fallback_reason"] == "overloaded"
    assert Fake.seen == ["gemini-3.5-flash", "gemini-3.5-flash", "gemini-2.5-flash"]


def test_overloaded_everywhere_is_503_with_the_reason():
    Fake.script = {m: [overloaded()] for m in ("gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-lite-latest")}
    r = verify(model="gemini-3.5-flash")
    assert r.status_code == 503
    assert r.json()["detail"].startswith("Google Gemini is overloaded right now (gemini-3.5-flash).")


def test_auth_errors_do_not_fail_over():
    Fake.script = {"gemini-3.8-flash": [error(openai.AuthenticationError, 401)]}
    assert verify().status_code == 401 and Fake.seen == ["gemini-3.8-flash"]


def test_fallbacks_are_filtered_by_the_cached_live_list():
    live = ["gemini-3.8-flash", "gemini-2.5-flash-lite"]
    assert llm.candidates("gemini", "gemini-3.8-flash", live, "gemini-2.5-flash", lambda i: True) == ["gemini-3.8-flash", "gemini-2.5-flash-lite"]
    assert llm.candidates("openai", "gpt-6", ["gpt-6", "gpt-5-mini", "gpt-5.5-mini", "gpt-4.1-mini"], "x", lambda i: True) == ["gpt-6", "gpt-5.5-mini", "gpt-4.1-mini"]
    assert llm.candidates("mistral", "custom", None, "mistral-small-latest", lambda i: True) == ["custom", "mistral-small-latest"]


def test_retry_durations_parse():
    assert llm.seconds("2m59.56s") == pytest.approx(179.56) and llm.seconds("7.66s") == pytest.approx(7.66)
    assert llm.seconds("12") == 12 and llm.seconds("500ms") == pytest.approx(0.5) and llm.seconds("") is None


# --- Groq demo pool ----------------------------------------------------------------------------

DEMO = "gsk_demo-test-value"
JOB = {"resume": "Python developer", "job_description": "Python engineer"}
MATCH = '{"match_score": 50}'


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_GROQ_KEY", DEMO)


def groq_limits(rpd, tpm, reset_requests="2m59.56s", reset_tokens="7.66s"):
    return {"x-ratelimit-remaining-requests": str(rpd), "x-ratelimit-remaining-tokens": str(tpm),
            "x-ratelimit-reset-requests": reset_requests, "x-ratelimit-reset-tokens": reset_tokens}


def test_demo_uses_the_pool_and_reports_the_model(demo):
    Fake.script = {"openai/gpt-oss-120b": [MATCH]}
    Fake.headers = {"openai/gpt-oss-120b": groq_limits(999, 7000)}
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 200 and r.headers["X-Jivika-Model"] == "openai/gpt-oss-120b"
    pool = client.get("/api/demo").json()["pool"]
    assert pool[0] == {"model": "openai/gpt-oss-120b", "state": "ok", "remaining_requests": 999}


def test_demo_429_moves_to_the_next_pool_model(demo):
    limited = error(openai.RateLimitError, 429, "Rate limit reached for model on tokens per minute (TPM)", {"retry-after": "7"})
    Fake.script = {"openai/gpt-oss-120b": [limited], "qwen/qwen3.8-27b": [MATCH]}
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 200 and r.headers["X-Jivika-Model"] == "qwen/qwen3.8-27b"
    assert r.headers["X-Jivika-Fallback"] == "openai/gpt-oss-120b" and r.headers["X-Jivika-Fallback-Reason"] == "rate limited"
    assert client.get("/api/demo").json()["model"] == "qwen/qwen3.8-27b"  # the cooling model is skipped
    Fake.seen.clear()
    client.post("/api/match", json=JOB)
    assert Fake.seen == ["qwen/qwen3.8-27b"]


def test_demo_skips_models_without_room_for_the_request(demo):
    Fake.script = {m: [MATCH] for m in llm.DEMO_MODELS}
    Fake.headers = {"openai/gpt-oss-120b": groq_limits(500, 100)}  # 100 tokens left this minute
    client.post("/api/match", json=JOB)
    Fake.seen.clear()
    r = client.post("/api/match", json=JOB)
    assert r.headers["X-Jivika-Model"] == "qwen/qwen3.8-27b" and Fake.seen == ["qwen/qwen3.8-27b"]
    assert "X-Jivika-Fallback" not in r.headers  # chosen up front, not a failure


def test_demo_all_busy_or_exhausted_messages(demo):
    now = main.time.time()
    for m in llm.DEMO_MODELS:
        llm._pool[m] = {"tpm": 0, "tpm_reset": now + 20}
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 429 and r.json()["detail"].startswith("The demo is busy. Try again in about ")
    assert 1 <= int(r.headers["Retry-After"]) <= 21
    for m in llm.DEMO_MODELS:
        llm._pool[m] = {"rpd": 0, "rpd_reset": now + 3600}
    r = client.post("/api/match", json=JOB)
    assert r.status_code == 429 and r.json()["detail"] == "Today's demo limit is reached. Add your own free key in Settings."
    assert {p["state"] for p in client.get("/api/demo").json()["pool"]} == {"exhausted"}


def test_demo_inputs_are_trimmed_to_fit_the_free_tier(demo, monkeypatch):
    seen = {}

    def fake(provider, key, model, system, user, schema_model, max_tokens=None, **_):
        seen.update(user=user, max_tokens=max_tokens)
        return schema_model.model_validate({"match_score": 50})

    monkeypatch.setattr(main, "complete_json", fake)
    client.post("/api/match", json={"resume": "r" * 30_000, "job_description": "j" * 30_000})
    assert seen["max_tokens"] == 2_500
    assert seen["user"].count("r") <= 10_000 + 20 and seen["user"].count("j") <= 6_000 + 20
    messages = main._messages(main.PROMPTS["match"], seen["user"], main.MatchAnalysis)
    assert main._estimate(messages, 2_500) <= main.DEMO_TOKEN_TARGET + 300
    # User keys are not trimmed.
    client.post("/api/match", headers={"X-LLM-Provider": "groq", "X-LLM-Key": "gsk_user"}, json={"resume": "r" * 30_000, "job_description": "j"})
    assert seen["user"].count("r") >= 30_000 and seen["max_tokens"] is None


def test_demo_minute_limit_is_global(demo, monkeypatch):
    monkeypatch.setenv("JIVIKA_DEMO_MINUTE_LIMIT", "1")
    Fake.script = {"openai/gpt-oss-120b": [MATCH]}
    assert client.post("/api/match", json=JOB).status_code == 200
    r = client.post("/api/match", json=JOB, headers={"X-Forwarded-For": "9.9.9.9"})
    assert r.status_code == 429 and "demo is busy" in r.json()["detail"] and "Retry-After" in r.headers

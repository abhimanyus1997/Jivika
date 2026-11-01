"""Local / self-hosted providers (Ollama, vLLM, LM Studio, generic OpenAI-compatible), configured only by env."""

import pytest
from fastapi.testclient import TestClient

import main
from jivika import jobs, models

client = TestClient(main.app)
OLLAMA = "http://127.0.0.1:11434/v1"
OLLAMA_MODELS = {"object": "list", "data": [
    {"id": "llama3.2:latest", "object": "model", "created": 1790000000, "owned_by": "library"},
    {"id": "nomic-embed-text:latest", "object": "model", "created": 1795000000, "owned_by": "library"},
    {"id": "qwen3:8b", "object": "model", "created": 1780000000, "owned_by": "library"},
]}
REAL_REQUEST = models._request


@pytest.fixture
def fake_client(monkeypatch):
    """Records OpenAI(...) kwargs and chat.completions.create(...) kwargs."""
    seen = {"client": [], "calls": []}

    class Completions:
        def create(self, **kwargs):
            seen["calls"].append(kwargs)
            message = type("M", (), {"content": '{"ok": true}'})
            return type("R", (), {"choices": [type("C", (), {"message": message})]})

    class Client:
        def __init__(self, **kwargs):
            seen["client"].append(kwargs)
            self.chat = type("Chat", (), {"completions": Completions()})

    monkeypatch.setattr(main, "OpenAI", Client)
    return seen


@pytest.fixture
def listing(monkeypatch):
    calls = []

    def fetch_json(url, headers=None, cap=None):
        calls.append((url, headers))
        return OLLAMA_MODELS

    monkeypatch.setattr(models, "_request", REAL_REQUEST)
    monkeypatch.setattr(jobs, "fetch_json", fetch_json)
    return calls


def ids():
    return {p["id"]: p for p in client.get("/api/providers").json()}


def test_local_providers_hidden_without_env():
    assert not {"ollama", "vllm", "lmstudio", "openai-compat"} & ids().keys()
    assert client.post("/api/providers/verify", headers={"X-LLM-Provider": "ollama"}).status_code == 401
    assert client.get("/api/providers/ollama/models").status_code == 404


def test_local_providers_shown_with_env(monkeypatch):
    monkeypatch.setenv("JIVIKA_OLLAMA_URL", OLLAMA + "/")
    monkeypatch.setenv("JIVIKA_OPENAI_COMPAT_URL", "http://llm.internal:9000/v1")
    monkeypatch.setenv("JIVIKA_OPENAI_COMPAT_NAME", "Team LLM")
    monkeypatch.setenv("JIVIKA_VLLM_URL", "file:///etc/passwd")  # not http(s): ignored
    found = ids()
    assert found["ollama"]["local"] is True and found["ollama"]["key_required"] is False and found["ollama"]["json_mode"] is True
    assert found["openai-compat"]["name"] == "Team LLM" and found["openai-compat"]["json_mode"] is False
    assert "vllm" not in found and "base_url" not in found["ollama"]  # the URL itself is never exposed


def test_local_model_listing(monkeypatch, listing):
    monkeypatch.setenv("JIVIKA_OLLAMA_URL", OLLAMA)
    body = client.get("/api/providers/ollama/models").json()  # no key needed
    assert listing[0][0] == f"{OLLAMA}/models" and listing[0][1]["Authorization"] == "Bearer local"
    assert [m["id"] for m in body["models"]] == ["llama3.2:latest", "qwen3:8b"]  # embedding model filtered
    assert body["recommended"] == "llama3.2:latest" and body["source"] == "live"


def test_local_listing_unreachable(monkeypatch):
    monkeypatch.setenv("JIVIKA_OLLAMA_URL", OLLAMA)
    body = client.get("/api/providers/ollama/models").json()  # conftest stub: the server is down
    assert body["source"] == "fallback" and body["models"] == [] and "not reachable" in body["error"]


def test_local_call_routed_to_configured_url(monkeypatch, fake_client, listing):
    monkeypatch.setenv("JIVIKA_OLLAMA_URL", OLLAMA)
    monkeypatch.setenv("JIVIKA_LOCAL_TIMEOUT", "300")
    monkeypatch.setenv("JIVIKA_DEMO_GROQ_KEY", "demo-key")  # demo mode must not take over local requests
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "ollama", "X-Base-URL": "http://evil.test"})
    assert r.status_code == 200 and r.json()["model"] == "llama3.2:latest"  # first listed model
    sent = fake_client["client"][0]
    assert sent["base_url"] == OLLAMA and sent["api_key"] == "local" and sent["timeout"] == 300
    assert fake_client["calls"][0]["response_format"] == {"type": "json_object"}
    assert "X-Jivika-Demo" not in r.headers


def test_local_key_and_model(monkeypatch, fake_client):
    monkeypatch.setenv("JIVIKA_VLLM_URL", "http://127.0.0.1:8000/v1")
    monkeypatch.setenv("JIVIKA_VLLM_MODEL", "Qwen/Qwen3-8B")
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "vllm", "X-LLM-Key": "user-typed"})
    assert r.json()["model"] == "Qwen/Qwen3-8B" and fake_client["client"][0]["api_key"] == "user-typed"
    monkeypatch.setenv("JIVIKA_VLLM_KEY", "operator-secret")  # the operator's key wins
    client.post("/api/providers/verify", headers={"X-LLM-Provider": "vllm", "X-LLM-Key": "user-typed"})
    assert fake_client["client"][1]["api_key"] == "operator-secret" and fake_client["client"][1]["timeout"] == 120


def test_lmstudio_relies_on_prompt(monkeypatch, fake_client):
    monkeypatch.setenv("JIVIKA_LMSTUDIO_URL", "http://127.0.0.1:1234/v1")
    client.post("/api/providers/verify", headers={"X-LLM-Provider": "lmstudio", "X-LLM-Model": "m"})
    assert "response_format" not in fake_client["calls"][0] and fake_client["calls"][0]["temperature"] == 0.3


def test_local_without_models_is_a_clear_error(monkeypatch, fake_client):
    monkeypatch.setenv("JIVIKA_OLLAMA_URL", OLLAMA)
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "ollama"})
    assert r.status_code == 503 and "No model" in r.json()["detail"] and not fake_client["client"]

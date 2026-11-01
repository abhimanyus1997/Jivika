import pytest

import main
from jivika import importer, jobs, llm, models, resources, salary

ENV = (
    "JIVIKA_DEMO_GROQ_KEY", "JIVIKA_DEMO_MODEL", "JIVIKA_DEMO_MODELS", "JIVIKA_DEMO_MINUTE_LIMIT", "JIVIKA_DEMO_HOURLY_LIMIT", "JIVIKA_DEMO_DAILY_LIMIT",
    "JIVIKA_JOB_SOURCES", "JIVIKA_ATS_BOARDS", "JIVIKA_ADZUNA_APP_ID", "JIVIKA_ADZUNA_APP_KEY", "JIVIKA_ADZUNA_COUNTRY",
    "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "JIVIKA_TRUST_PROXY",
    "JIVIKA_URL_IMPORT", "JIVIKA_SALARY_SOURCES", "JIVIKA_RESOURCE_SOURCES", "JIVIKA_PARSER", "JIVIKA_DOCLING_URL",
    "JIVIKA_LOCAL_TIMEOUT", *(f"JIVIKA_{n}_{s}" for n in ("OLLAMA", "VLLM", "LMSTUDIO", "OPENAI_COMPAT") for s in ("URL", "KEY", "MODEL", "NAME")),
)


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    """No real keys from .env, no network from job sources, and fresh counters and caches."""
    for name in ENV:
        monkeypatch.delenv(name, raising=False)

    def no_network(*args, **kwargs):
        raise AssertionError("tests must not reach the network")

    def models_offline(provider, key):
        raise jobs.SourceError("Unavailable right now.")  # model lists fall back to the static defaults

    monkeypatch.setattr(jobs, "fetch", no_network)
    monkeypatch.setattr(importer, "resolve", no_network)
    monkeypatch.setattr(importer, "_request", no_network)
    monkeypatch.setattr(models, "_request", models_offline)
    monkeypatch.setattr(resources, "DDG_INTERVAL", 0)
    resources._ddg_state.update(dict.fromkeys(resources._ddg_state, 0.0))
    for store in (main._demo_counts, main._job_hits, main._rate_hits, main._import_hits, main._salary_hits, main._models_hits, main._ats_hits,
                  main._resource_hits, resources._cache, resources._search_cache, llm._cool, llm._last, llm._pool, jobs._cache, jobs._searches, models._cache, salary._cache):
        store.clear()
    yield

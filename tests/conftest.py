import pytest

import main
from jivika import jobs

ENV = (
    "JIVIKA_DEMO_GROQ_KEY", "JIVIKA_DEMO_MODEL", "JIVIKA_DEMO_HOURLY_LIMIT", "JIVIKA_DEMO_DAILY_LIMIT",
    "JIVIKA_JOB_SOURCES", "JIVIKA_ATS_BOARDS", "JIVIKA_ADZUNA_APP_ID", "JIVIKA_ADZUNA_APP_KEY", "JIVIKA_ADZUNA_COUNTRY",
    "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "JIVIKA_TRUST_PROXY",
)


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    """No real keys from .env, no network from job sources, and fresh counters and caches."""
    for name in ENV:
        monkeypatch.delenv(name, raising=False)

    def no_network(*args, **kwargs):
        raise AssertionError("tests must not reach the network")

    monkeypatch.setattr(jobs, "fetch", no_network)
    for store in (main._demo_counts, main._job_hits, main._rate_hits, jobs._cache, jobs._searches):
        store.clear()
    yield

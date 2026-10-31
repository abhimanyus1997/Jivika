"""Experience parsing, career roadmaps, Qwen, live model lists, market salary data and the ATS checker."""

import pytest
from fastapi.testclient import TestClient

import main
from jivika import ats, jobs, models, salary
from jivika.schemas import PROVIDERS, ROADMAP_SH, CareerPath, Profile, experience_months

from test_api import make_pdf

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "groq", "X-LLM-Key": "user-key"}


@pytest.fixture
def fake_llm(monkeypatch):
    payloads, calls = {}, []

    def fake(provider, key, model, system, user, schema_model, **_):
        calls.append({"provider": provider, "key": key, "model": model, "system": system, "user": user})
        if isinstance(payloads.get(schema_model.__name__), Exception):
            raise payloads[schema_model.__name__]
        return schema_model.model_validate(payloads.get(schema_model.__name__, {}))

    monkeypatch.setattr(main, "complete_json", fake)
    return payloads, calls


# --- experience: years + months ----------------------------------------------


@pytest.mark.parametrize("raw, expected", [
    (5.3, (5, 3)), ("5.3", (5, 3)), ("5.10", (5, 10)), ("5.11", (5, 11)), ("5.75", (5, 9)), ("5.5", (5, 5)), (5.5, (5, 5)),
    ("5 years 3 months", (5, 3)), ("5 yrs 3 mos", (5, 3)), ("5y 3m", (5, 3)), ("63 months", (5, 3)), ("5+", (5, 0)),
    ("5+ years", (5, 0)), ("5-7 years", (5, 0)), ("5 to 7 yrs", (5, 0)), ("1 year", (1, 0)), ("8 months", (0, 8)),
    ("5.08", (5, 1)), ("5.0", (5, 0)), (4, (4, 0)), ("unknown", (0, 0)), (None, (0, 0)), (-3, (0, 0)), (float("inf"), (0, 0)),
    (True, (0, 0)), ("5.99", (6, 0)),
])
def test_experience_parser(raw, expected):
    assert divmod(experience_months(raw), 12) == expected


def test_profile_prefers_separate_fields_and_rolls_months_over():
    p = Profile(experience_years=5, experience_months=14, years_experience=1)
    assert (p.experience_years, p.experience_months, p.years_experience) == (6, 2, 6.17)
    assert Profile(experience_years="5 years", experience_months="3 months").years_experience == 5.25
    assert Profile(experience_months=63).model_dump()["experience_years"] == 5


def test_profile_from_legacy_years_experience_and_caps():
    p = Profile(years_experience="5 yrs 3 mos")
    assert (p.experience_years, p.experience_months, p.years_experience) == (5, 3, 5.25)
    assert Profile(experience_years=99, experience_months=5).model_dump()["experience_years"] == 60
    assert Profile(experience_years=99, experience_months=5).experience_months == 0
    assert Profile().years_experience == 0


def test_profile_prompt_asks_for_years_and_months(fake_llm):
    payloads, calls = fake_llm
    payloads["Profile"] = {"experience_years": 3, "experience_months": 7}
    body = client.post("/api/resume/profile", headers=HEADERS, json={"resume": "cv"}).json()
    assert (body["experience_years"], body["experience_months"], body["years_experience"]) == (3, 7, 3.58)
    assert "experience_years and experience_months" in calls[0]["system"]


# --- career roadmap -------------------------------------------------------------


CAREER = {"current": {"title": "Analyst"}, "next": {"title": "Senior"}, "future": {"title": "Lead"}, "career_score": 70}


def test_roadmap_only_links_allow_listed_slugs(fake_llm):
    payloads, calls = fake_llm
    payloads["CareerPath"] = {**CAREER, "roadmap": {
        "title": "Analyst to Lead", "roadmap_sh": {"slug": "data-analyst"},
        "stages": [{"name": "Foundations", "items": [
            {"skill": "SQL", "status": "HAVE", "roadmap_sh_url": "https://roadmap.sh/sql"},
            {"skill": "Power BI", "status": "next", "roadmap_sh_url": "https://evil.example/sql"},
            {"skill": "Statistics", "status": "eventually", "roadmap_sh_url": "statistics"},
        ]}, {"name": "Core", "items": [{"skill": "SQL", "status": "later"}]}],
    }}
    r = client.post("/api/career/path", headers=HEADERS, json={"resume": "cv"})
    roadmap = r.json()["roadmap"]
    assert roadmap["roadmap_sh"] == {"slug": "data-analyst", "name": "Data Analyst", "url": "https://roadmap.sh/data-analyst"}
    items = [i for stage in roadmap["stages"] for i in stage["items"]]
    assert [i["id"] for i in items] == ["sql", "power-bi", "statistics", "sql-2"]
    assert [i["status"] for i in items] == ["have", "next", "next", "later"]
    assert items[0]["roadmap_sh_url"] == "https://roadmap.sh/sql"
    assert all(i["roadmap_sh_url"] == "https://roadmap.sh/data-analyst" for i in items[1:3])  # role-level fallback
    assert items[3]["roadmap_sh_url"] == "https://roadmap.sh/sql"  # a skill with its own guide links it
    assert "Allowed slugs: ai-engineer" in calls[0]["system"]


def test_roadmap_unknown_role_slug_is_dropped():
    path = CareerPath.model_validate({**CAREER, "roadmap": {"roadmap_sh": "https://roadmap.sh/astrology", "stages": [{"name": "A", "items": [{"skill": "X"}]}]}})
    assert path.roadmap.roadmap_sh is None and path.roadmap.stages[0].items[0].roadmap_sh_url is None
    assert CareerPath.model_validate(CAREER).roadmap.stages == []  # older model output without a roadmap


def test_roadmap_skill_lookup_prefers_the_skill_guide():
    path = CareerPath.model_validate({**CAREER, "roadmap": {"roadmap_sh": "ai-engineer", "stages": [{"name": "A", "items": [
        {"skill": "Linux"}, {"skill": "MLOps CI/CD pipelines"}, {"skill": "K8s"}, {"skill": "Git"}, {"skill": "Postgres"},
        {"skill": "Node.js"}, {"skill": "Stakeholder communication"}]}]}})
    assert [i.roadmap_sh_url.rsplit("/", 1)[1] for i in path.roadmap.stages[0].items] == [
        "linux", "mlops", "kubernetes", "git-github", "postgresql-dba", "nodejs", "ai-engineer"]


def test_career_path_needs_a_next_role():
    with pytest.raises(ValueError):
        CareerPath.model_validate({**CAREER, "next": {"title": " "}})


def test_experience_ranges_with_units_and_legacy_round_trip():
    assert experience_months("6 months - 1 year") == 6 and experience_months("1-2 years") == 12
    assert experience_months("6-12 months") == 6
    p = Profile(years_experience=Profile(experience_years=5, experience_months=6).years_experience)
    assert (p.experience_years, p.experience_months) == (5, 6)


def test_roadmap_allow_list_is_the_verified_set():
    assert len(ROADMAP_SH) == 41 and "data-analyst" in ROADMAP_SH and "devrel" in ROADMAP_SH


# --- Qwen ---------------------------------------------------------------------------


def test_qwen_provider(monkeypatch):
    spec = PROVIDERS["qwen"]
    assert spec["base_url"] == "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" and spec["json_mode"] is True
    ids = [p["id"] for p in client.get("/api/providers").json()]
    assert "qwen" in ids


def test_qwen_requests_disable_thinking_for_json_mode(monkeypatch):
    seen = []

    class Completions:
        def create(self, **kwargs):
            seen.append(kwargs)
            message = type("M", (), {"content": '{"ok": true}'})
            return type("R", (), {"choices": [type("C", (), {"message": message})]})

    class Client:
        def __init__(self, **kwargs):
            seen.append(kwargs)
            self.chat = type("Chat", (), {"completions": Completions()})

    monkeypatch.setattr(main, "OpenAI", Client)
    main.complete_json("qwen", "k", "qwen3.8-flash", "sys", "user", main.Ping)
    assert seen[0]["base_url"] == PROVIDERS["qwen"]["base_url"]
    assert seen[1]["extra_body"] == {"enable_thinking": False} and seen[1]["response_format"] == {"type": "json_object"}
    assert "JSON" in seen[1]["messages"][0]["content"]  # Qwen's json_object mode requires the word


# --- live model lists -----------------------------------------------------------------

GROQ_MODELS = {"object": "list", "data": [
    {"id": "llama-3.1-8b-instant", "created": 1700000000, "active": True, "context_window": 131072},
    {"id": "openai/gpt-oss-20b", "created": 1790000000, "active": True, "context_window": 131072},
    {"id": "whisper-large-v3", "created": 1795000000, "active": True},
    {"id": "meta-llama/llama-guard-4-12b", "created": 1795000000, "active": True},
    {"id": "playai-tts", "created": 1795000000, "active": True},
    {"id": "old-model", "created": 1600000000, "active": False},
]}


REAL_REQUEST = models._request  # captured at import, before the autouse fixture stubs it


@pytest.fixture
def live(monkeypatch):
    replies, calls = {}, []

    def fetch_json(url, headers=None, cap=None):
        calls.append((url, headers))
        reply = replies[url]
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(models, "_request", REAL_REQUEST)  # undo the offline stub from conftest
    monkeypatch.setattr(jobs, "fetch_json", fetch_json)
    return replies, calls


def test_models_filtered_sorted_and_cached(live):
    replies, calls = live
    replies["https://api.groq.com/openai/v1/models"] = GROQ_MODELS
    r = client.get("/api/providers/groq/models", headers={"X-LLM-Key": "gsk_user"})
    body = r.json()
    assert r.status_code == 200 and body["source"] == "live" and r.headers["Cache-Control"] == "private, no-store"
    assert [m["id"] for m in body["models"]] == ["openai/gpt-oss-20b", "llama-3.1-8b-instant"]
    assert body["models"][0]["context_length"] == 131072 and body["recommended"] == "openai/gpt-oss-20b"
    assert calls[0][1]["Authorization"] == "Bearer gsk_user"
    client.get("/api/providers/groq/models", headers={"X-LLM-Key": "gsk_user"})
    assert len(calls) == 1  # cached
    assert all("gsk_user" not in str(k) for k in models._cache)  # keys are stored hashed only


def test_recommended_model_is_used_when_no_model_header(live, fake_llm):
    replies, calls = live
    replies["https://api.groq.com/openai/v1/models"] = GROQ_MODELS
    client.post("/api/resume/profile", headers=HEADERS, json={"resume": "cv"})
    assert fake_llm[1][-1]["model"] == PROVIDERS["groq"]["default_model"]  # not listed yet: static fallback
    client.get("/api/providers/groq/models", headers={"X-LLM-Key": "user-key"})
    client.post("/api/resume/profile", headers=HEADERS, json={"resume": "cv"})
    assert fake_llm[1][-1]["model"] == "openai/gpt-oss-20b"
    client.post("/api/resume/profile", headers={**HEADERS, "X-LLM-Model": "custom"}, json={"resume": "cv"})
    assert fake_llm[1][-1]["model"] == "custom"


def test_models_fallback_on_error(live):
    replies, calls = live
    replies["https://api.groq.com/openai/v1/models"] = jobs.SourceError("The source returned HTTP 401.")
    body = client.get("/api/providers/groq/models", headers={"X-LLM-Key": "bad"}).json()
    assert body["source"] == "fallback" and body["models"] == [{"id": PROVIDERS["groq"]["default_model"]}]
    assert body["recommended"] == PROVIDERS["groq"]["default_model"] and "did not accept the key" in body["error"]


def test_anthropic_models_use_native_headers(live):
    replies, calls = live
    replies["https://api.anthropic.com/v1/models?limit=1000"] = {"data": [
        {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "created_at": "2026-09-21T00:00:00Z", "max_input_tokens": 1000000},
        {"id": "claude-haiku-6", "display_name": "Claude Haiku 6", "created_at": "2026-10-01T00:00:00Z"},
        {"id": "claude-old", "created_at": "2024-01-01T00:00:00Z", "lifecycle": "deprecated"},
    ]}
    body = client.get("/api/providers/anthropic/models", headers={"X-LLM-Key": "sk-ant"}).json()
    assert calls[0][1]["x-api-key"] == "sk-ant" and calls[0][1]["anthropic-version"] == models.ANTHROPIC_VERSION
    assert [m["id"] for m in body["models"]] == ["claude-haiku-6", "claude-opus-5-5"]
    assert body["models"][1]["name"] == "Claude Opus 5.5" and body["models"][1]["context_length"] == 1000000
    assert body["recommended"] == "claude-haiku-6"  # static default absent: newest haiku


def test_openrouter_public_list_with_prices(live):
    replies, calls = live
    replies["https://openrouter.ai/api/v1/models"] = {"data": [
        {"id": "openai/gpt-6-luna", "name": "GPT-6 Luna", "created": 1790000000, "context_length": 400000,
         "pricing": {"prompt": "0.00000025", "completion": "0.000002"}, "architecture": {"output_modalities": ["text"]}},
        {"id": "google/image-gen", "created": 1795000000, "architecture": {"output_modalities": ["image"]}},
    ]}
    body = client.get("/api/providers/openrouter/models").json()  # no key needed
    assert calls[0][1].get("Authorization") is None
    assert body["models"] == [{"id": "openai/gpt-6-luna", "name": "GPT-6 Luna", "context_length": 400000, "created": 1790000000, "input_price": 0.25, "output_price": 2.0}]
    assert body["recommended"] == "openai/gpt-6-luna"


def test_gemini_ids_lose_the_models_prefix():
    listed = models.normalize("gemini", {"data": [{"id": "models/gemini-9-flash"}, {"id": "models/text-embedding-9"}, {"id": "models/imagen-5"}]})
    assert [m["id"] for m in listed] == ["gemini-9-flash"]
    assert models.recommend("gemini", listed) == "gemini-9-flash"


def test_recommendation_heuristic_avoids_previews_and_snapshots():
    listed = [{"id": i} for i in ("gpt-9-mini-preview", "gpt-9-mini-2026-10-01", "gpt-9", "gpt-9-mini")]
    assert models.recommend("openai", listed) == "gpt-9-mini"
    assert models.recommend("mistral", [{"id": "mistral-small-2510"}, {"id": "mistral-small-latest"}]) == "mistral-small-latest"
    assert models.recommend("deepseek", [{"id": "deepseek-reasoner"}]) == "deepseek-reasoner"  # newest when nothing matches


def test_models_need_a_key_except_openrouter_and_demo_groq(live, monkeypatch):
    replies, calls = live
    assert client.get("/api/providers/openai/models").status_code == 401
    assert client.get("/api/providers/nope/models").status_code == 404
    monkeypatch.setenv("JIVIKA_DEMO_GROQ_KEY", "gsk_demo")
    replies["https://api.groq.com/openai/v1/models"] = GROQ_MODELS
    assert client.get("/api/providers/openai/models").status_code == 401
    r = client.get("/api/providers/groq/models")
    assert r.json()["demo"] is True and "gsk_demo" not in r.text and calls[-1][1]["Authorization"] == "Bearer gsk_demo"


def test_demo_model_comes_from_the_live_list(live, monkeypatch):
    replies, calls = live
    monkeypatch.setenv("JIVIKA_DEMO_GROQ_KEY", "gsk_demo")
    replies["https://api.groq.com/openai/v1/models"] = GROQ_MODELS
    assert client.get("/api/demo").json()["model"] == "openai/gpt-oss-20b"
    monkeypatch.setenv("JIVIKA_DEMO_MODEL", "pinned")
    assert main.demo_model() == "pinned"


# --- market salary data ---------------------------------------------------------------


@pytest.mark.parametrize("text, expected", [
    ("₹12L - ₹18L", (1_200_000, 1_800_000, "INR")),
    ("12-18 LPA", (1_200_000, 1_800_000, "INR")),
    ("₹1,200,000", (1_200_000, 1_200_000, "INR")),
    ("INR 5,00,000 - 8,00,000", (500_000, 800_000, "INR")),
    ("₹ 10-15 Lacs P.A.", (1_000_000, 1_500_000, "INR")),
    ("₹50,000 per month", (600_000, 600_000, "INR")),
    ("₹1.2 Cr", (12_000_000, 12_000_000, "INR")),
    ("$100k - $150k", (100_000, 150_000, "USD")),
    ("USD 90,000 - 120,000", (90_000, 120_000, "USD")),
    ("$50k", (50_000, 50_000, "USD")),
    ("£45,000 per year", (45_000, 45_000, "GBP")),
    ("€60k - €70k", (60_000, 70_000, "EUR")),
    ("$45/hr", None), ("CA$90,000", None), ("Not disclosed", None), ("", None), ("INR 100 - 200 per year salary", None),
])
def test_parse_salary(text, expected):
    assert salary.parse_salary(text) == expected


def _postings(*salaries):
    return {"jobs": [{"title": "Data Analyst", "company": f"Co{i}", "salary": s} for i, s in enumerate(salaries)], "sources": []}


def test_salary_from_postings_needs_three_samples(monkeypatch):
    monkeypatch.setattr(jobs, "search", lambda q, location="", *a: _postings("₹10L - ₹14L", "12-18 LPA", "₹8L - ₹12L", "$90k"))
    body = client.get("/api/salary", params={"title": "Data Analyst", "location": "Bengaluru"}).json()
    (rng,) = body["ranges"]
    assert rng["source"] == "postings" and rng["currency"] == "INR" and rng["sample_size"] == 3 and rng["period"] == "year"
    assert rng["min"] == 900_000 and rng["max"] == 1_600_000 and rng["median"] == 1_200_000 and rng["research"] is False
    assert body["levels_url"] == "https://www.levels.fyi/t/data-analyst/locations/india"
    assert {s["id"]: s["enabled"] for s in body["sources"]} == {"adzuna": False, "postings": True, "levelsfyi": False}
    monkeypatch.setattr(jobs, "search", lambda *a: _postings("₹10L - ₹14L", "12-18 LPA"))
    assert client.get("/api/salary", params={"title": "Data Analyst", "location": "Pune"}).json()["ranges"] == []


def test_salary_adzuna_histogram(monkeypatch):
    monkeypatch.setenv("JIVIKA_ADZUNA_APP_ID", "id")
    monkeypatch.setenv("JIVIKA_ADZUNA_APP_KEY", "key")
    monkeypatch.setenv("JIVIKA_SALARY_SOURCES", "adzuna")
    urls = []

    def fetch_json(url, *a, **k):
        urls.append(url)
        return {"histogram": {"400000": 10, "800000": 20, "1200000": 10}}

    monkeypatch.setattr(jobs, "fetch_json", fetch_json)
    (rng,) = client.get("/api/salary", params={"title": "Data Analyst", "location": "Bengaluru"}).json()["ranges"]
    assert urls[0].startswith("https://api.adzuna.com/v1/api/jobs/in/histogram?") and "what=Data+Analyst" in urls[0]
    assert (rng["min"], rng["median"], rng["max"], rng["sample_size"], rng["currency"]) == (600_000, 1_000_000, 1_000_000, 40, "INR")


def test_salary_levelsfyi_is_opt_in_and_reports_blocks(monkeypatch):
    monkeypatch.setenv("JIVIKA_SALARY_SOURCES", "levelsfyi")

    def blocked(*a, **k):
        raise jobs.SourceError("Blocked or rate limited by the source.")

    monkeypatch.setattr(jobs, "fetch", blocked)
    body = client.get("/api/salary", params={"title": "Software Engineer", "company": "Acme Corp"}).json()
    entry = next(s for s in body["sources"] if s["id"] == "levelsfyi")
    assert entry["enabled"] and not entry["ok"] and entry["research"] and "Blocked" in entry["error"]
    assert body["ranges"] == [] and body["levels_url"] == "https://www.levels.fyi/companies/acme-corp/salaries/"
    page = '<script id="__NEXT_DATA__" type="application/json">{"props": {"pageProps": {"stats": {"p25": 1000000, "p50": 1500000, "p75": 2200000, "currency": "INR", "count": 395}}}}</script>'
    monkeypatch.setattr(jobs, "fetch", lambda *a, **k: page.encode())
    (rng,) = client.get("/api/salary", params={"title": "Software Engineer"}).json()["ranges"]
    assert (rng["min"], rng["median"], rng["max"], rng["sample_size"], rng["research"]) == (1_000_000, 1_500_000, 2_200_000, 395, True)


def test_salary_validation_and_rate_limit(monkeypatch):
    monkeypatch.setattr(jobs, "search", lambda *a: _postings())
    assert client.get("/api/salary", params={"title": " "}).status_code == 422
    assert client.get("/api/salary", params={"title": "x" * 101}).status_code == 422
    assert client.get("/api/salary", params={"title": "x", "currency": "JPY"}).status_code == 422
    codes = [client.get("/api/salary", params={"title": f"t{i}"}).status_code for i in range(31)]
    assert codes[-1] == 429 and codes[0] == 200


def test_levels_url_maps_to_known_pages():
    assert salary.levels_url("Data Analyst <script>", "", "London") == "https://www.levels.fyi/t/data-analyst"
    assert salary.levels_url("Senior ML Engineer", "", "Bengaluru") == "https://www.levels.fyi/t/software-engineer/title/machine-learning-engineer"
    assert salary.levels_url("Python Developer", "", "Bengaluru, India") == "https://www.levels.fyi/t/software-engineer/locations/india"
    assert salary.levels_url("Python Developer") == "https://www.levels.fyi/t/software-engineer"
    assert salary.levels_url("Lead Product Manager", "", "Pune") == "https://www.levels.fyi/t/product-manager/locations/india"


# --- ATS checker ----------------------------------------------------------------------

GOOD_RESUME = """Jane Doe
Bengaluru, India | jane@example.com | +91 98765 43210 | linkedin.com/in/janedoe

SUMMARY
Data analyst with 5 years of experience in SQL, Python and Tableau.

EXPERIENCE
Senior Data Analyst, Acme Analytics, Jan 2022 - Present
• Built 12 Tableau dashboards used by 300 sales managers across India
• Reduced weekly reporting time by 40% by automating SQL pipelines in Python
• Led a churn analysis that cut customer attrition by 8% in two quarters
Data Analyst, Beta Retail, Jun 2019 - Dec 2021
• Designed an A/B testing framework adopted by 4 product teams
• Automated 25 Excel reports with Python, saving 10 hours per week
• Improved forecast accuracy by 15% with a demand model in scikit-learn

EDUCATION
B.Tech, Computer Science, Example University, Jul 2015 - May 2019

SKILLS
SQL, Python, Tableau, Excel, Statistics, A/B testing, scikit-learn, Airflow

PROJECTS
• Built an open-source SQL linter with 200 GitHub stars

CERTIFICATIONS
Tableau Desktop Specialist, Mar 2023
""" + "Additional detail about analytics work and stakeholder communication. " * 25

WEAK_RESUME = "John\nI am a hard-working team player and a passionate, dynamic self-starter. Responsible for stuff. " * 3

JD = "Data Analyst\nWe need SQL, Python and Power BI. Experience with Snowflake preferred. SQL SQL Python dashboards."


def by_id(checks):
    return {c["id"]: c for c in checks}


def test_ats_deterministic_without_key():
    r = client.post("/api/ats/check", json={"resume": GOOD_RESUME, "meta": {"pages": 1, "images": 0, "fonts": 2}})
    body = r.json()
    assert r.status_code == 200 and body["keywords"] is None and "API key" in body["note"]
    checks = by_id(body["checks"])
    for cid in ("section_experience", "section_education", "section_skills", "section_summary", "section_projects",
                "section_certifications", "contact_email", "contact_phone", "contact_linkedin", "contact_location",
                "dates", "bullets", "page_count", "quantified", "action_verbs", "buzzwords", "text_layer", "columns", "tables"):
        assert checks[cid]["status"] == "pass", (cid, checks[cid])
    assert body["score"] >= 85 and body["grade"] == "Excellent" and set(body["categories"]) == {"parsing", "sections", "contact", "formatting", "content"}
    assert "keywords" not in body["categories"]


def test_ats_weak_resume_fails_with_prioritised_fixes():
    body = client.post("/api/ats/check", json={"resume": WEAK_RESUME, "meta": {"pages": 4, "images": 2, "has_text_layer": False, "suspected_columns": True, "suspected_tables": True}}).json()
    checks = by_id(body["checks"])
    assert checks["text_length"]["status"] == "fail" and checks["section_experience"]["status"] == "fail"
    assert checks["contact_email"]["status"] == "fail" and checks["page_count"]["status"] == "fail"
    assert checks["images"]["status"] == "warn" and checks["columns"]["status"] == "warn" and checks["tables"]["status"] == "warn"
    assert checks["buzzwords"]["status"] == "fail" and checks["text_layer"]["status"] == "fail"
    assert body["grade"] == "Needs work" and body["score"] < 50
    assert body["fixes"][0]["priority"] == "high" and [f["priority"] for f in body["fixes"]] == sorted(
        (f["priority"] for f in body["fixes"]), key=["high", "medium", "low"].index)
    assert all(c["fix"] is None for c in body["checks"] if c["status"] == "pass")


def test_ats_contact_formats():
    for phone in ("+91 98765 43210", "+91-9876543210", "9876543210", "+1 (415) 555-0132", "+44 20 7946 0958"):
        assert ats.PHONE.search(f"Call {phone} today"), phone
    assert not ats.PHONE.search("2019 - 2021")


def test_ats_mixed_date_formats():
    checks = by_id(ats.deterministic_checks("Jan 2020 - 03/2021\n" + "word " * 400, None))
    assert checks["dates"]["status"] == "warn" and "Mixed" in checks["dates"]["detail"]
    assert "page_count" not in checks and "text_layer" not in checks  # no meta, no meta checks


def test_ats_with_jd_and_model(fake_llm):
    payloads, calls = fake_llm
    payloads["ATSInsights"] = {"job_title": "Data Analyst", "title_match": True, "required_skills": ["SQL", "Python", "Power BI"],
                               "preferred_skills": ["Snowflake"], "content_notes": ["Lead with the churn result."], "summary": "Strong fit."}
    body = client.post("/api/ats/check", headers=HEADERS, json={"resume": GOOD_RESUME, "job_description": JD}).json()
    kw = body["keywords"]
    assert kw["required_found"] == ["SQL", "Python"] and kw["required_missing"] == ["Power BI"]
    assert kw["preferred_missing"] == ["Snowflake"] and kw["title_match"] is True
    assert kw["top_terms"][0] == {"term": "sql", "jd_count": 3, "resume_count": GOOD_RESUME.lower().count("sql")}
    assert by_id(body["checks"])["keywords_required"]["status"] == "warn"
    assert body["summary"] == "Strong fit." and body["note"] is None and "keywords" in body["categories"]
    assert any("Power BI" in f["text"] for f in body["fixes"]) and any(f["text"] == "Lead with the churn result." for f in body["fixes"])


def test_ats_model_failure_returns_deterministic_result(fake_llm):
    payloads, calls = fake_llm
    payloads["ATSInsights"] = main.HTTPException(502, "The model provider returned an error.")
    body = client.post("/api/ats/check", headers=HEADERS, json={"resume": GOOD_RESUME, "job_description": JD}).json()
    assert "unavailable" in body["note"] and body["keywords"]["top_terms"] and body["score"] > 0
    assert "sql" in body["keywords"]["required_found"]  # JD terms stand in for the model's skill list


def test_ats_score_weights_keywords_only_with_jd():
    checks = [ats._check("a", "content", "A", "pass", ""), ats._check("k", "keywords", "K", "fail", "")]
    assert ats.score(checks, with_jd=True)[0] == round(100 * 20 / 50)
    assert ats.score(checks, with_jd=False)[0] == 100
    assert ats.grade(85) == "Excellent" and ats.grade(70) == "Good" and ats.grade(50) == "Fair" and ats.grade(49) == "Needs work"


def test_contains_is_whole_term():
    assert ats.contains("i write go and c++", "Go") and ats.contains("c++ dev", "C++") and ats.contains("uses .net", ".NET")
    assert not ats.contains("good work", "go")


def test_resume_parse_returns_meta():
    r = client.post("/api/resume/parse", files={"file": ("C:\\cv\\Jane CV.pdf", make_pdf("Jane Doe, Python developer"), "application/pdf")})
    meta = r.json()["meta"]
    assert meta["pages"] == 1 and meta["fonts"] == 1 and meta["images"] == 0 and meta["has_text_layer"] is True
    assert meta["suspected_columns"] is False and meta["suspected_tables"] is False and meta["file_name"] == "Jane CV.pdf"
    assert meta["avg_chars_per_page"] == len("Jane Doe, Python developer")


def _pdf(stream: bytes) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def _run(x: int, y: int, text: bytes) -> bytes:
    return b"BT /F1 10 Tf %d %d Td (%s) Tj ET " % (x, y, text)


@pytest.mark.parametrize("stream, columns, tables", [
    (b"".join(_run(72, 700 - 14 * i, b"A single column line of resume text") for i in range(30)), False, False),
    (b"".join(_run(72, 700 - 14 * i, b"Left column text line") + _run(320, 700 - 14 * i, b"Right column text line") for i in range(20)), True, False),
    (b"".join(_run(72, 700 - 14 * i, b"Cell") + _run(200, 700 - 14 * i, b"Cell") + _run(330, 700 - 14 * i, b"Cell") for i in range(6)), False, True),
])
def test_layout_heuristics(stream, columns, tables):
    meta = client.post("/api/resume/parse", files={"file": ("cv.pdf", _pdf(stream), "application/pdf")}).json()["meta"]
    assert (meta["suspected_columns"], meta["suspected_tables"]) == (columns, tables)


def test_ats_location_dates_and_missing_bullet_markers():
    from jivika import ats

    assert not ats.LOCATION.search("Skills: Python, SQL") and ats.LOCATION.search("Pune") and ats.LOCATION.search("Austin, Texas")
    full = "Engineer, Acme, May 2021 - September 2022\nAnalyst, Beta, January 2019 - April 2021"
    checks = {c["id"]: c for c in ats.deterministic_checks(full, None)}
    assert checks["dates"]["status"] == "pass"
    lines = "\n".join(f"Built a reporting pipeline that cut processing time by {i}0 percent" for i in range(1, 7))
    checks = {c["id"]: c for c in ats.deterministic_checks(lines, {"has_text_layer": True, "pages": 1})}
    assert checks["bullets"]["status"] == "pass" and "achievement lines" in checks["quantified"]["detail"]
    assert checks["text_length"]["fix"].startswith("Your resume is short")
    assert ats.BULLET.match("\uf0b7 Built it") and ats.BULLET.match("o Built it") and not ats.BULLET.match("opened it")


def test_ats_email_regex_is_linear():
    import time

    from jivika import ats

    start = time.monotonic()
    ats.deterministic_checks("a" * 30000, None)
    assert time.monotonic() - start < 2


def test_ats_unknown_provider_falls_back_and_is_rate_limited():
    r = client.post("/api/ats/check", headers={"X-LLM-Provider": "nope", "X-LLM-Key": "k"}, json={"resume": GOOD_RESUME})
    assert r.status_code == 200 and r.json()["checks"]
    codes = [client.post("/api/ats/check", json={"resume": "cv"}).status_code for _ in range(30)]
    assert codes[-1] == 429

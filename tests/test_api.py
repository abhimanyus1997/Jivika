import httpx
import openai
import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "gemini", "X-LLM-Key": "test-key"}


@pytest.fixture
def fake_llm(monkeypatch):
    """Replace the single LLM call with canned payloads keyed by schema name."""
    calls = []
    payloads = {}

    def fake(provider, key, model, system, user, schema_model):
        calls.append({"provider": provider, "key": key, "model": model, "system": system, "user": user})
        return schema_model.model_validate(payloads.get(schema_model.__name__, {}))

    monkeypatch.setattr(main, "complete_json", fake)
    return payloads, calls


def make_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n" % (len(objects) + 1, xref)
    out += b"%%EOF\n"
    return bytes(out)


# --- public endpoints -------------------------------------------------------


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_providers():
    data = client.get("/api/providers").json()
    assert [p["id"] for p in data] == ["gemini", "openai", "anthropic", "groq", "mistral", "deepseek", "xai", "openrouter"]
    assert data[0]["default_model"] == main.PROVIDERS["gemini"]["default_model"]
    assert all({"id", "name", "default_model", "key_url"} <= set(p) for p in data)
    assert all("base_url" not in p for p in data)


# --- BYOK headers -----------------------------------------------------------


def test_missing_key_is_401(fake_llm):
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "openai"})
    assert r.status_code == 401 and r.json()["detail"]


def test_unknown_provider_is_400(fake_llm):
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "nope", "X-LLM-Key": "k"})
    assert r.status_code == 400


def test_verify_uses_default_model_and_never_echoes_key(fake_llm):
    payloads, calls = fake_llm
    payloads["Ping"] = {"ok": True}
    r = client.post("/api/providers/verify", headers=HEADERS)
    assert r.json() == {"ok": True, "model": main.PROVIDERS["gemini"]["default_model"]}
    assert "test-key" not in r.text
    assert calls[0]["key"] == "test-key"


def test_custom_model_header(fake_llm):
    fake_llm[0]["Ping"] = {"ok": True}
    r = client.post("/api/providers/verify", headers={**HEADERS, "X-LLM-Model": "gemini-2.5-pro"})
    assert r.json()["model"] == "gemini-2.5-pro"
    assert fake_llm[1][0]["model"] == "gemini-2.5-pro"


# --- resume parsing ---------------------------------------------------------


def test_parse_pdf():
    pdf = make_pdf("Jane Doe Python Engineer")
    r = client.post("/api/resume/parse", files={"file": ("cv.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Jane Doe" in body["text"] and body["pages"] == 1 and body["characters"] == len(body["text"])


def test_parse_rejects_non_pdf_type():
    r = client.post("/api/resume/parse", files={"file": ("cv.txt", b"hello", "text/plain")})
    assert r.status_code == 415


def test_parse_accepts_untyped_pdf():
    pdf = make_pdf("Jane Doe")
    r = client.post("/api/resume/parse", files={"file": ("cv.pdf", pdf, "application/octet-stream")})
    assert r.status_code == 200, r.text


def test_oversized_body_rejected_before_read(monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 100)
    monkeypatch.setattr(main, "MAX_BODY_OVERHEAD", 0)
    r = client.post("/api/resume/parse", files={"file": ("cv.pdf", b"%PDF" + b"0" * 500, "application/pdf")})
    assert r.status_code == 413 and r.json()["detail"].startswith("The PDF is larger than")
    r = client.post("/api/analyze", content=b"{" + b" " * 500 + b"}", headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["detail"] == "The request is too large."


def test_non_ascii_key_is_rejected(fake_llm):
    r = client.post("/api/providers/verify", headers={"X-LLM-Provider": "openai", "X-LLM-Key": "sk-t\xe9st".encode("latin-1")})
    assert r.status_code == 401


def test_parse_rejects_bad_magic():
    r = client.post("/api/resume/parse", files={"file": ("cv.pdf", b"not a pdf", "application/pdf")})
    assert r.status_code == 400


def test_parse_rejects_oversize(monkeypatch):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 100)
    r = client.post("/api/resume/parse", files={"file": ("cv.pdf", b"%PDF" + b"0" * 200, "application/pdf")})
    assert r.status_code == 413


# --- AI endpoints -----------------------------------------------------------


def test_profile(fake_llm):
    fake_llm[0]["Profile"] = {"name": "Jane", "years_experience": 4.5, "skills": ["Python"]}
    r = client.post("/api/resume/profile", headers=HEADERS, json={"resume": "Jane, Python dev"})
    assert r.status_code == 200
    assert r.json()["name"] == "Jane" and r.json()["years_experience"] == 4.5


def test_text_inputs_are_truncated(fake_llm):
    client.post("/api/resume/profile", headers=HEADERS, json={"resume": "x" * 40_000})
    assert fake_llm[1][0]["user"].count("x") == main.MAX_TEXT_CHARS


def test_empty_resume_is_422(fake_llm):
    assert client.post("/api/resume/profile", headers=HEADERS, json={"resume": "  "}).status_code == 422


def test_match_blends_llm_score_with_keyword_coverage(fake_llm):
    fake_llm[0]["MatchAnalysis"] = {
        "job_title": "Backend Engineer",
        "match_score": 80,
        "required_skills": ["Python", "Kubernetes"],
        "transition_plan": [{"step": "Learn Kubernetes", "detail": "", "timeframe": "1 month"}],
    }
    resume = "Python developer building FastAPI services"
    jd = "Python Kubernetes FastAPI"
    r = client.post("/api/match", headers=HEADERS, json={"resume": resume, "job_description": jd})
    body = r.json()
    coverage = main.keyword_coverage(resume, jd, ["Python", "Kubernetes"])
    assert coverage == 67  # python, fastapi of {python, kubernetes, fastapi}
    assert body["keyword_coverage"] == coverage
    assert body["match_score"] == round(0.7 * 80 + 0.3 * coverage)
    assert "required_skills" not in body
    assert body["salary_range"] == ""


def test_keyword_coverage_edge_cases():
    assert main.keyword_coverage("anything", "", []) == 0
    assert main.keyword_coverage("the and for", "the and for", []) == 0  # stopwords only
    assert main.keyword_coverage("c++ and go", "", ["C++"]) == 100  # multi-char skill phrase
    assert main.keyword_coverage("", "rust golang", []) == 0


@pytest.mark.parametrize("raw, expected", [(150, 100), (-5, 0), (72.6, 73), ("88", 88), ("n/a", 0), ("1e999", 0)])
def test_scores_are_clamped(raw, expected):
    assert main.CVReview(ats_score=raw).ats_score == expected


def test_infinite_score_from_model_is_clamped():
    assert main.InterviewFeedback.model_validate_json('{"score": 1e999}').score == 0


@pytest.mark.parametrize("raw, expected", [("5+", 5), ("3.5 years", 3.5), ("unknown", 0), (4, 4)])
def test_years_experience_is_lenient(raw, expected):
    assert main.Profile(years_experience=raw).years_experience == expected


def test_cv_review(fake_llm):
    fake_llm[0]["CVReview"] = {"ats_score": 120, "sections": [{"name": "Experience", "score": -3}]}
    body = client.post("/api/cv/review", headers=HEADERS, json={"resume": "cv", "target_role": "PM"}).json()
    assert body["ats_score"] == 100 and body["sections"][0]["score"] == 0
    assert "PM" in fake_llm[1][0]["user"]


def test_linkedin_review(fake_llm):
    fake_llm[0]["LinkedInReview"] = {"score": 55, "headline_suggestions": ["A"]}
    r = client.post("/api/linkedin/review", headers=HEADERS, json={"headline": "Engineer", "about": "I build"})
    assert r.json()["score"] == 55
    assert client.post("/api/linkedin/review", headers=HEADERS, json={}).status_code == 422


def test_career_path_defaults_to_inr(fake_llm):
    fake_llm[0]["CareerPath"] = {"current": {}, "next": {}, "future": {}, "career_score": 70}
    r = client.post("/api/career/path", headers=HEADERS, json={"resume": "cv", "current_role": "Analyst"})
    assert r.status_code == 200 and r.json()["career_score"] == 70
    assert "INR" in fake_llm[1][0]["user"]
    bad = {"resume": "cv", "currency": "JPY"}
    assert client.post("/api/career/path", headers=HEADERS, json=bad).status_code == 422


def test_interview_questions(fake_llm):
    fake_llm[0]["InterviewQuestions"] = {"questions": [{"question": f"Q{i}", "type": "Technical"} for i in range(5)]}
    body = {"resume": "cv", "job_description": "jd", "count": 3}
    qs = client.post("/api/interview/questions", headers=HEADERS, json=body).json()["questions"]
    assert len(qs) == 3 and qs[0]["type"] == "technical"
    body["count"] = 16
    assert client.post("/api/interview/questions", headers=HEADERS, json=body).status_code == 422


def test_interview_feedback(fake_llm):
    fake_llm[0]["InterviewFeedback"] = {"score": 64, "improved_answer": "Better"}
    r = client.post("/api/interview/feedback", headers=HEADERS, json={"question": "Why?", "answer": "Because"})
    assert r.json()["score"] == 64


def test_cover_letter(fake_llm):
    fake_llm[0]["CoverLetter"] = {"cover_letter": "Dear team"}
    body = {"resume": "cv", "job_description": "jd", "tone": "concise"}
    assert client.post("/api/cover-letter", headers=HEADERS, json=body).json() == {"cover_letter": "Dear team"}
    body["tone"] = "angry"
    assert client.post("/api/cover-letter", headers=HEADERS, json=body).status_code == 422


# --- complete_json itself (OpenAI client faked, no network) -----------------


class FakeOpenAI:
    responses: list = []
    seen: list = []

    def __init__(self, **kwargs):
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        FakeOpenAI.seen.append(kwargs)
        item = FakeOpenAI.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        msg = type("M", (), {"content": item})
        return type("R", (), {"choices": [type("C", (), {"message": msg})]})


@pytest.fixture
def fake_openai(monkeypatch):
    FakeOpenAI.responses, FakeOpenAI.seen = [], []
    monkeypatch.setattr(main, "OpenAI", FakeOpenAI)
    return FakeOpenAI


def call(schema=main.LinkedInReview):
    return main.complete_json("groq", "k", "m", "sys", "user", schema)


def api_error(cls, status):
    resp = httpx.Response(status, request=httpx.Request("POST", "https://example.test"))
    return cls("boom", response=resp, body=None)


def test_complete_json_requests_json_with_schema(fake_openai):
    fake_openai.responses = ['{"score": 70}']
    assert call().score == 70
    sent = fake_openai.seen[0]
    assert sent["response_format"] == {"type": "json_object"}
    assert "headline_suggestions" in sent["messages"][0]["content"]


def test_complete_json_retries_once_then_502(fake_openai):
    fake_openai.responses = ["not json", '```json\n{"score": 10}\n```']
    assert call().score == 10
    fake_openai.responses = ["nope", "still nope"]
    with pytest.raises(main.HTTPException) as e:
        call()
    assert e.value.status_code == 502


@pytest.mark.parametrize(
    "exc, status, text",
    [
        (api_error(openai.AuthenticationError, 401), 401, "rejected by Groq"),
        (api_error(openai.RateLimitError, 429), 429, "Rate limit"),
        (api_error(openai.InternalServerError, 500), 502, "provider returned an error"),
    ],
)
def test_complete_json_maps_provider_errors(fake_openai, exc, status, text):
    fake_openai.responses = [exc]
    with pytest.raises(main.HTTPException) as e:
        call()
    assert e.value.status_code == status and text in e.value.detail


def test_provider_capabilities_shape_the_request(fake_openai):
    fake_openai.responses = ['{"score": 1}', '{"score": 2}']
    main.complete_json("anthropic", "k", "claude-haiku-5-5", "sys", "user", main.LinkedInReview)
    sent = fake_openai.seen[0]
    assert "response_format" not in sent and "temperature" not in sent  # Anthropic rejects json_object and temperature
    assert sent["max_completion_tokens"] == 16000
    main.complete_json("mistral", "k", "m", "sys", "user", main.LinkedInReview)
    assert fake_openai.seen[1]["response_format"] == {"type": "json_object"} and fake_openai.seen[1]["temperature"] == 0.3


def test_every_provider_declares_capabilities():
    for spec in main.PROVIDERS.values():
        assert spec["base_url"].startswith("https://") and spec["default_model"]
        assert isinstance(spec["json_mode"], bool) and isinstance(spec["temperature"], bool)

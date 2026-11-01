"""Structured profiles, tailoring and refining (no-invention checks) and application emails. The model is faked."""

import pytest
from fastapi.testclient import TestClient

import main
from jivika import resume

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "gemini", "X-LLM-Key": "test-key"}

RESUME_TEXT = """Asha Rao
Data Engineer | asha.rao@example.in | +91 98765 43210 | linkedin.com/in/asharao
Summary: Data engineer building pipelines.
Experience
Acme Analytics - Data Engineer, Jan 2021 - Present, Bengaluru
- Cut pipeline runtime by 40% using Spark
- Built Airflow DAGs for 12 teams
Education
IIT Madras, B.Tech Computer Science, 2016 - 2020
Skills: Python, SQL, Spark, Airflow
"""

SOURCE = {
    "basics": {"name": "Asha Rao", "headline": "Data Engineer", "email": "asha.rao@example.in", "summary": "Data engineer building pipelines."},
    "experience": [{"id": "exp-1-acme", "company": "Acme Analytics", "title": "Data Engineer", "start": "Jan 2021", "end": "Present",
                    "current": True, "bullets": ["Cut pipeline runtime by 40% using Spark", "Built Airflow DAGs for 12 teams"]}],
    "projects": [{"id": "proj-1", "name": "Lakehouse", "description": "A small lakehouse demo", "bullets": ["Delta tables"]}],
    "education": [{"id": "edu-1", "institution": "IIT Madras", "degree": "B.Tech", "field": "Computer Science", "start": "2016", "end": "2020"}],
    "skills": [{"group": "Skills", "items": ["Python", "SQL", "Spark", "Airflow"]}],
    "certifications": [{"id": "cert-1", "name": "AWS Data Engineer", "issuer": "AWS", "year": "2023"}],
}


@pytest.fixture
def fake_llm(monkeypatch):
    payloads, calls = {}, []

    def fake(provider, key, model, system, user, schema_model, **_):
        calls.append({"system": system, "user": user, **_})
        return schema_model.model_validate(payloads.get(schema_model.__name__, {}))

    monkeypatch.setattr(main, "complete_json", fake)
    return payloads, calls


# --- schema ---------------------------------------------------------------------------


def test_schema_is_tolerant_and_capped():
    profile = resume.StructuredProfile.model_validate({
        "basics": None,
        "experience": [{"company": "A", "title": None, "start": 2021, "current": None, "bullets": ["x", "", None] + ["b"] * 40}] * 50,
        "skills": [{"group": "G", "items": ["  Python  ", ""]}],
    })
    assert profile.basics.name == "" and len(profile.experience) == 30
    entry = profile.experience[0]
    assert entry.start == "2021" and entry.title == "" and entry.current is False and len(entry.bullets) == 19
    assert profile.skills[0].items == ["Python"]
    assert set(resume.StructuredProfile.model_fields) == {"basics", "experience", "projects", "education", "skills", "languages",
                                                          "certifications", "publications", "references"}


def test_fill_ids_unique_and_preserved():
    profile = resume.StructuredProfile.model_validate({"experience": [{"company": "Acme Inc."}, {"id": "keep", "company": "B"}, {"id": "keep"}]})
    ids = [e.id for e in resume.fill_ids(profile).experience]
    assert ids[0] == "exp-1-acme-inc" and ids[1] == "keep" and len(set(ids)) == 3


# --- structure --------------------------------------------------------------------------


def test_structure_grounds_in_text(fake_llm):
    payloads, calls = fake_llm
    payloads["StructuredProfile"] = {
        "basics": {"name": "Asha Rao", "email": "made.up@x.com", "phone": "", "website": "https://asha.dev", "summary": "Data engineer building pipelines."},
        "experience": [
            {"id": "x", "company": "Acme Analytics", "title": "Data Engineer", "start": "Jan 2021", "end": "Present", "current": True,
             "bullets": ["Cut pipeline runtime by 40% using Spark", "Saved $2M annually"]},
            {"company": "Globex", "title": "CTO", "bullets": ["Led 500 people"]},
        ],
        "education": [{"institution": "IIT Madras", "degree": "B.Tech"}, {"institution": "Stanford"}],
        "skills": [{"group": "Skills", "items": ["Python", "Kubernetes", "SQL"]}],
    }
    r = client.post("/api/profile/structure", json={"resume": RESUME_TEXT}, headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["basics"]["email"] == "asha.rao@example.in"  # the resume's own address, not the model's
    assert body["basics"]["website"] == ""  # not in the text
    assert [e["company"] for e in body["experience"]] == ["Acme Analytics"]
    assert body["experience"][0]["bullets"] == ["Cut pipeline runtime by 40% using Spark"]
    assert body["experience"][0]["id"] == "exp-1-acme-analytics" and body["experience"][0]["start"] == "Jan 2021"
    assert [e["institution"] for e in body["education"]] == ["IIT Madras"]
    assert body["skills"] == [{"group": "Skills", "items": ["Python", "SQL"]}]
    assert calls[0]["max_tokens"] == 8000 and "Leave every id empty" in calls[0]["system"]


def test_structure_requires_text(fake_llm):
    assert client.post("/api/profile/structure", json={"resume": "   "}, headers=HEADERS).status_code == 422


# --- no-invention validator --------------------------------------------------------------


def source():
    return resume.StructuredProfile.model_validate(SOURCE)


def test_enforce_drops_invented_entries_and_restores_fields():
    result = resume.StructuredProfile.model_validate({
        "basics": {"name": "Someone Else", "email": "x@y.z", "headline": "Senior Data Engineer", "summary": "Pipeline engineer."},
        "experience": [
            {"id": "exp-1-acme", "company": "Acme Corp", "title": "Head of Data", "start": "2015", "end": "", "current": False,
             "bullets": ["Reduced Spark runtime by 40%", "Grew revenue 3x", "Mentored 25 engineers"]},
            {"company": "Globex", "title": "CTO", "bullets": ["Led everything"]},
        ],
        "projects": [{"name": "lakehouse", "description": "Lakehouse with 99.9% uptime", "bullets": ["Delta tables for analytics"]}],
        "education": [{"id": "edu-1", "institution": "IIT Bombay", "degree": "PhD"}, {"institution": "MIT"}],
        "certifications": [{"name": "aws data engineer", "year": "2019"}, {"name": "CKA"}],
        "skills": [{"group": "Core", "items": ["Spark", "python", "Kubernetes", "Airflow"]}],
    })
    out, notes = resume.enforce(result, source())
    exp = out.experience[0]
    assert len(out.experience) == 1
    assert (exp.id, exp.company, exp.title, exp.start, exp.end, exp.current) == ("exp-1-acme", "Acme Analytics", "Data Engineer", "Jan 2021", "Present", True)
    assert exp.bullets == ["Reduced Spark runtime by 40%"]  # 3x and 25 are not in the profile
    assert out.basics.name == "Asha Rao" and out.basics.email == "asha.rao@example.in"
    assert out.basics.headline == "Data Engineer" and out.basics.summary == "Pipeline engineer."  # "Senior" is not in the profile
    assert out.projects[0].name == "Lakehouse" and out.projects[0].description == "A small lakehouse demo"
    assert out.projects[0].bullets == ["Delta tables for analytics"]
    assert [(e.institution, e.degree) for e in out.education] == [("IIT Madras", "B.Tech")]  # matched by id, restored
    assert [(c.name, c.year) for c in out.certifications] == [("AWS Data Engineer", "2023")]
    assert out.skills[0].items == ["Spark", "python", "Airflow"]
    text = " ".join(notes)
    assert "headline" in text and "Globex" in text and "MIT" in text and "CKA" in text and "Kubernetes" in text and "2 bullet(s)" in text


def test_enforce_skill_verbatim_in_text_and_number_summary_reverted():
    src = source()
    src.experience[0].bullets.append("Wrote dbt models")
    result = resume.StructuredProfile.model_validate({
        "basics": {"summary": "Data engineer with 10 years of experience."},
        "skills": [{"group": "S", "items": ["dbt", "Go"]}],  # dbt is written in a bullet; Go is not a word anywhere
    })
    out, notes = resume.enforce(result, src)
    assert out.skills[0].items == ["dbt"]
    assert out.basics.summary == "Data engineer building pipelines." and any("summary" in n for n in notes)


def test_enforce_keeps_source_bullets_when_all_invented():
    result = resume.StructuredProfile.model_validate({"experience": [{"id": "exp-1-acme", "bullets": ["Saved 7 crore"]}]})
    out, _ = resume.enforce(result, source())
    assert out.experience[0].bullets == SOURCE["experience"][0]["bullets"]


def test_tailor_endpoint_validates_model_output(fake_llm):
    payloads, calls = fake_llm
    payloads["TailorResult"] = {
        "resume": {"experience": [{"id": "exp-1-acme", "company": "ACME ANALYTICS", "title": "data engineer", "bullets": ["Built Airflow DAGs for 12 teams"]},
                                  {"company": "Initech", "title": "Lead"}],
                   "skills": [{"group": "Relevant", "items": ["Airflow", "Snowflake"]}]},
        "highlighted_skills": ["Airflow", "Snowflake"],
        "gaps": [{"requirement": "Snowflake", "note": "Not shown; mention any exposure honestly."}],
        "changes": ["Moved Airflow first."],
    }
    r = client.post("/api/resume/tailor", json={"profile": SOURCE, "job_description": "Airflow and Snowflake engineer", "emphasis": "orchestration"},
                    headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [e["company"] for e in body["resume"]["experience"]] == ["Acme Analytics"]
    assert body["resume"]["skills"] == [{"group": "Relevant", "items": ["Airflow"]}]
    assert body["highlighted_skills"] == ["Airflow"]
    assert body["gaps"][0]["requirement"] == "Snowflake"
    assert body["changes"][0] == "Moved Airflow first." and any("Initech" in c for c in body["changes"])
    assert '"exp-1-acme"' in calls[0]["user"] and "## Emphasis\norchestration" in calls[0]["user"]


def test_refine_section_only_changes_that_section(fake_llm):
    payloads, calls = fake_llm
    payloads["RefineResult"] = {
        "resume": {"basics": {"summary": "Builds reliable Spark pipelines."},
                   "experience": [{"id": "exp-1-acme", "bullets": ["Shortened runtime by 40%"]}],
                   "skills": [{"group": "Skills", "items": ["Rust"]}]},
        "changes": ["Tightened the summary."],
    }
    r = client.post("/api/resume/refine", json={"resume": SOURCE, "source_profile": SOURCE, "instruction": "Make the summary punchier",
                                                "section": "summary"}, headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["resume"]["basics"]["summary"] == "Builds reliable Spark pipelines."
    assert body["resume"]["experience"][0]["bullets"] == SOURCE["experience"][0]["bullets"]  # other sections untouched
    assert body["resume"]["skills"] == SOURCE["skills"]
    assert body["changes"] == ["Tightened the summary."]
    assert "## Section\nsummary" in calls[0]["user"] and "## Source Profile" in calls[0]["user"]


def test_refine_without_section_drops_invention(fake_llm):
    payloads, _ = fake_llm
    payloads["RefineResult"] = {"resume": {"experience": [{"company": "Hooli", "title": "VP"}], "skills": [{"items": ["Rust", "SQL"]}]}}
    body = client.post("/api/resume/refine", json={"resume": SOURCE, "source_profile": SOURCE, "instruction": "Add Hooli"}, headers=HEADERS).json()
    assert body["resume"]["experience"] == [] and body["resume"]["skills"][0]["items"] == ["SQL"]
    assert any("Hooli" in c for c in body["changes"]) and any("Rust" in c for c in body["changes"])


def test_refine_input_limits(fake_llm):
    too_long = {"resume": SOURCE, "source_profile": SOURCE, "instruction": "x" * 1001}
    assert client.post("/api/resume/refine", json=too_long, headers=HEADERS).status_code == 422
    bad_section = {"resume": SOURCE, "source_profile": SOURCE, "instruction": "ok", "section": "basics"}
    assert client.post("/api/resume/refine", json=bad_section, headers=HEADERS).status_code == 422


def test_resume_routes_need_a_key():
    assert client.post("/api/resume/tailor", json={"profile": SOURCE, "job_description": "x"}).status_code == 401


# --- application email --------------------------------------------------------------------


@pytest.mark.parametrize("description, expected", [
    ("Questions? privacy@acme.com. To apply, send your CV to Talent@Acme.com.", "Talent@Acme.com"),
    ("Contact noreply@acme.com or careers@acme.io for applications", "careers@acme.io"),
    ("Reach our CEO at ceo@acme.com.", "ceo@acme.com"),
    ("Logo: hero@2x.png and user@example.com", ""),
    ("No address here", ""),
    ("Write to jobs@acme.co.in.", "jobs@acme.co.in"),
])
def test_application_address(description, expected):
    assert resume.application_address(description) == expected


def test_email_body_signature_and_attachments():
    basics = resume.EmailBasics(name="Asha Rao", email="asha@x.in", phone="", linkedin="linkedin.com/in/asharao")
    body = resume.email_body("**Dear Hiring Manager,**\n\nI am applying for the role.\n\nBest regards,\nAsha", basics, "warm")
    assert "**" not in body and body.count("regards") == 1
    assert "resume and cover letter" in body
    assert body.endswith("Warm regards,\nAsha Rao\nasha@x.in | linkedin.com/in/asharao")


def test_email_endpoint(fake_llm):
    payloads, calls = fake_llm
    payloads["EmailDraft"] = {"subject": "", "body": "Dear Hiring Manager,\n\nPlease find my resume and cover letter attached."}
    r = client.post("/api/application/email", headers=HEADERS, json={
        "basics": {"name": "Asha Rao", "email": "asha@x.in"},
        "job": {"title": "Data Engineer", "company": "Acme", "description": "Apply at hiring@acme.com"},
        "tone": "concise", "resume_summary": "Data engineer building pipelines.",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["to"] == "hiring@acme.com" and body["subject"] == "Application for Data Engineer - Asha Rao"
    assert body["body"].count("cover letter") == 1 and body["body"].endswith("Best regards,\nAsha Rao\nasha@x.in")
    assert "Title: Data Engineer\nCompany: Acme" in calls[0]["user"]
    assert client.post("/api/application/email", headers=HEADERS, json={"job": {}, "tone": "formal"}).status_code == 422
    assert client.post("/api/application/email", headers=HEADERS, json={"job": {"title": "x"}, "tone": "rude"}).status_code == 422


def test_demo_budget_covers_profile_fields():
    sections = main.demo_sections("resume_tailor", resume.TailorResult, {"profile": "p" * 50_000, "job_description": "j" * 50_000}, main.DEMO_LONG_MAX_TOKENS)
    assert len(sections["profile"]) <= 10_000 and len(sections["job_description"]) <= 6_000
    assert main._estimate(main._messages(main.PROMPTS["resume_tailor"], main._user(sections), resume.TailorResult), main.DEMO_LONG_MAX_TOKENS) <= main.DEMO_TOKEN_TARGET

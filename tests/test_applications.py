"""Requirement matching, section regeneration and the inbox routes. The model is faked."""

import pytest
from fastapi.testclient import TestClient

import main
from jivika import applications, resume

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "gemini", "X-LLM-Key": "test-key"}

PROFILE = {
    "basics": {"name": "Priya Sharma", "headline": "Backend Engineer", "email": "priya@example.in", "phone": "+91 90000 11111",
               "summary": "Backend engineer building payment APIs."},
    "experience": [
        {"id": "exp-1-northwind", "company": "Northwind", "title": "Senior Backend Engineer", "start": "Sep 2019", "end": "Present",
         "current": True, "bullets": ["Built payment APIs in Go serving 2 million users", "Led a team of 4"]},
        {"id": "exp-2-contoso", "company": "Contoso", "title": "Software Engineer", "start": "Sep 2015", "end": "Aug 2019",
         "bullets": ["Wrote Python services", "Moved jobs to Kafka"]},
    ],
    "projects": [{"id": "proj-1-ledger", "name": "Ledger", "description": "An open-source ledger", "bullets": ["Postgres schema design"]}],
    "education": [{"id": "edu-1-iitd", "institution": "IIT Delhi", "degree": "B.Tech", "field": "Computer Science", "start": "2011", "end": "2015"},
                  {"id": "edu-2-nptel", "institution": "NPTEL", "degree": "Certificate", "field": "Cloud"}],
    "skills": [{"group": "Skills", "items": ["Go", "Python", "Kafka", "Postgres"]}],
}
JD = """Senior Backend Engineer - Acme Pay, Bengaluru (Hybrid). Salary: 40-55 LPA. Apply by 5 November 2026.
Required: 5+ years of backend experience, Go, Kafka. Preferred: Kubernetes, AWS."""


@pytest.fixture
def fake_llm(monkeypatch):
    payloads, calls = {}, []

    def fake(provider, key, model, system, user, schema_model, **_):
        calls.append({"system": system, "user": user})
        return schema_model.model_validate(payloads.get(schema_model.__name__, {}))

    monkeypatch.setattr(main, "complete_json", fake)
    return payloads, calls


# --- requirements -----------------------------------------------------------------------


def test_requirements_grounds_evidence_and_recomputes_summary(fake_llm):
    payloads, calls = fake_llm
    payloads["RequirementsDraft"] = {
        "title": "Senior Backend Engineer", "company": "Acme Pay", "location": "Bengaluru", "work_mode": "hybrid",
        "salary": "40-55 LPA", "deadline": "2026-11-05",
        "requirements": [
            {"text": "Go", "kind": "required", "status": "met", "evidence": "Used at Northwind", "evidence_refs": ["exp-1-northwind", "exp-9-fake"]},
            {"text": "Kafka", "kind": "REQUIRED", "status": "met", "evidence": "Used at Initech since 2012", "evidence_refs": ["exp-2-contoso"]},
            {"text": "5+ years of backend experience", "status": "met", "evidence": "2 roles since Sep 2015", "evidence_refs": []},
            {"text": "Kubernetes", "kind": "preferred", "status": "met", "evidence": "Ran Kubernetes at Northwind", "evidence_refs": ["exp-1-northwind"]},
            {"text": "AWS", "kind": "preferred", "status": "missing", "evidence": "", "evidence_refs": ["exp-1-northwind"]},
            {"text": "Go", "status": "met"},  # duplicate
            {"text": "Postgres", "status": "partial", "evidence": "", "evidence_refs": ["skills"]},
            {"text": "Rust", "status": "met", "evidence": "Rust at Hooli", "evidence_refs": []},
        ],
    }
    r = client.post("/api/requirements", json={"job_description": JD, "profile": PROFILE}, headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["title"], body["company"], body["location"], body["work_mode"], body["salary"], body["deadline"]) == (
        "Senior Backend Engineer", "Acme Pay", "Bengaluru", "Hybrid", "40-55 LPA", "2026-11-05")
    reqs = {q["text"]: q for q in body["requirements"]}
    assert [q["id"] for q in body["requirements"]] == [f"req-{i}" for i in range(1, 8)]
    assert reqs["Go"] == {"id": "req-1", "text": "Go", "kind": "required", "status": "met", "evidence": "Used at Northwind",
                          "evidence_refs": ["exp-1-northwind"]}
    # Invented employer and year: evidence rebuilt from the cited entry, and no longer 'met' on the model's word
    assert reqs["Kafka"]["status"] == "partial" and reqs["Kafka"]["evidence"] == "Shown in Software Engineer at Contoso (Sep 2015 - Aug 2019)."
    # Grounded evidence but no ref: not 'met'
    assert reqs["5+ years of backend experience"]["status"] == "partial"
    # A JD skill the profile lacks, cited on a real entry: not shown there, so missing
    assert reqs["Kubernetes"] == {**reqs["Kubernetes"], "status": "missing", "evidence": "Not shown in your profile.", "evidence_refs": []}
    assert reqs["AWS"]["evidence_refs"] == [] and reqs["AWS"]["evidence"] == "Not shown in your profile."
    assert reqs["Postgres"]["evidence"] == "Shown in your skills (Postgres)."
    assert reqs["Rust"]["status"] == "missing" and reqs["Rust"]["evidence"] == "Not shown in your profile."
    assert body["summary"] == {"met": 1, "partial": 3, "missing": 3, "total": 7}
    assert '"exp-1-northwind"' in calls[0]["user"] and "## Today\n" in calls[0]["user"]


@pytest.mark.parametrize("evidence", ["Ran Kubernetes clusters at Northwind", "Used kubernetes at Northwind", "Used at Northwind"])
def test_requirements_met_needs_the_term_in_the_cited_entry(evidence):
    profile = resume.StructuredProfile.model_validate(PROFILE)
    draft = applications.RequirementsDraft.model_validate({"requirements": [
        {"text": "Kubernetes", "status": "met", "evidence": evidence, "evidence_refs": ["exp-1-northwind"]},
        {"text": "AWS", "status": "met", "evidence": "Used aws at Northwind", "evidence_refs": ["exp-1-northwind"]},
        {"text": "Go and AWS", "status": "met", "evidence": "Used Go at Northwind", "evidence_refs": ["exp-1-northwind"]},
    ]})
    k8s, aws, both = applications.ground_requirements(draft, profile, JD + " Go and AWS.")
    assert (k8s.status, k8s.evidence, k8s.evidence_refs) == ("missing", "Not shown in your profile.", [])
    assert (aws.status, aws.evidence) == ("missing", "Not shown in your profile.")
    assert (both.status, both.evidence) == ("partial", "Used Go at Northwind")


def test_requirements_drops_unstated_fields(fake_llm):
    payloads, _ = fake_llm
    payloads["RequirementsDraft"] = {"company": "Globex", "work_mode": "Remote", "deadline": "2026-11-30", "salary": "1 crore"}
    body = client.post("/api/requirements", json={"job_description": JD, "profile": PROFILE}, headers=HEADERS).json()
    assert (body["company"], body["work_mode"], body["deadline"], body["salary"]) == ("", "", "", "")
    assert body["summary"] == {"met": 0, "partial": 0, "missing": 0, "total": 0}


def test_requirements_limits_and_key():
    assert client.post("/api/requirements", json={"job_description": "x" * 20_001, "profile": PROFILE}, headers=HEADERS).status_code == 422
    assert client.post("/api/requirements", json={"job_description": "  ", "profile": PROFILE}, headers=HEADERS).status_code == 422
    assert client.post("/api/requirements", json={"job_description": JD, "profile": PROFILE}).status_code == 401


def test_grounded_text():
    source = "Senior Backend Engineer at Northwind, Sep 2019 - Present. Go, Kafka."
    assert applications.grounded_text("Used Go at Northwind since Sep 2019", source)
    assert not applications.grounded_text("Used Go at Hooli", source)
    assert not applications.grounded_text("Since 2012", source)
    assert applications.grounded_text("3 roles shown", source, counts=True) and not applications.grounded_text("3 roles", source)
    assert not applications.grounded_text("Kubernetes in production", source, forbid="Kubernetes, AWS")
    assert applications.grounded_text("Call on 5 Nov 2026", "Call on 5 Nov", allow=frozenset({"2026"}))


# --- regenerate section -------------------------------------------------------------------


def test_regenerate_experience_entry_only(fake_llm):
    payloads, calls = fake_llm
    payloads["RegenerateDraft"] = {"experience": {"id": "whatever", "company": "Hooli", "title": "CTO",
                                                  "bullets": ["Built Go payment APIs for 2 million users", "Saved 9 crore"]},
                                   "skills": [{"items": ["Rust"]}], "summary": "Ignored", "changes": ["Led with payments."]}
    current = {**PROFILE, "basics": {**PROFILE["basics"], "summary": "Tailored summary."}}
    r = client.post("/api/resume/regenerate-section", headers=HEADERS, json={
        "resume": current, "source_profile": PROFILE, "section": "experience:exp-1-northwind", "instruction": "Lead with payments",
        "job_description": JD})
    assert r.status_code == 200, r.text
    out = r.json()["resume"]
    first = out["experience"][0]
    assert (first["company"], first["title"]) == ("Northwind", "Senior Backend Engineer")
    assert first["bullets"] == ["Built Go payment APIs for 2 million users"]
    assert out["experience"][1] == {**PROFILE["experience"][1], "location": "", "current": False}
    assert out["basics"]["summary"] == "Tailored summary." and out["skills"] == PROFILE["skills"]
    assert r.json()["changes"][0] == "Led with payments." and any("bullet" in c for c in r.json()["changes"])
    assert "## Section\nexperience" in calls[0]["user"] and "## Instruction\nLead with payments" in calls[0]["user"]


@pytest.mark.parametrize("section, draft, check", [
    ("summary", {"summary": "Builds payment APIs in Go.", "headline": "Payments Wizard"},
     lambda out: out["basics"]["summary"] == "Builds payment APIs in Go." and out["basics"]["headline"] == "Backend Engineer"),
    ("summary", {"summary": "Engineer with 12 years."}, lambda out: out["basics"]["summary"] == PROFILE["basics"]["summary"]),
    ("skills", {"skills": [{"group": "Core", "items": ["Kafka", "Go", "Rust"]}]},
     lambda out: out["skills"] == [{"group": "Core", "items": ["Kafka", "Go"]}]),
    ("skills", {"skills": [{"items": ["Rust"]}]}, lambda out: out["skills"] == PROFILE["skills"]),
    ("education", {"education": [{"institution": "NPTEL"}]}, lambda out: [e["id"] for e in out["education"]] == ["edu-2-nptel"]),
    ("projects:proj-1-ledger", {"project": {"description": "A ledger in Postgres", "bullets": ["Postgres schema design"]}},
     lambda out: out["projects"][0]["description"] == "A ledger in Postgres" and out["projects"][0]["name"] == "Ledger"),
])
def test_regenerate_sections(fake_llm, section, draft, check):
    payloads, _ = fake_llm
    payloads["RegenerateDraft"] = draft
    r = client.post("/api/resume/regenerate-section", headers=HEADERS, json={"resume": PROFILE, "source_profile": PROFILE, "section": section})
    assert r.status_code == 200, r.text
    out = r.json()["resume"]
    assert check(out), out
    assert out["experience"] == resume.StructuredProfile.model_validate(PROFILE).model_dump()["experience"]


def test_regenerate_limits(fake_llm):
    base = {"resume": PROFILE, "source_profile": PROFILE}
    for bad in ({"section": "basics"}, {"section": "experience:missing"}, {"section": "experience:"},
                {"section": "summary", "instruction": "x" * 501}, {"section": "summary", "job_description": "x" * 6001}):
        assert client.post("/api/resume/regenerate-section", headers=HEADERS, json={**base, **bad}).status_code == 422, bad


# --- inbox --------------------------------------------------------------------------------

EMAIL = """From: Rahul Mehta <rahul@acmepay.in>
Subject: Interview for Senior Backend Engineer
Hi Priya, thanks for applying to Acme Pay. Could you do a video call on Thursday 5 November at 3 pm or Friday at 11:00?
Please let me know which works. Rahul, Talent team, Acme Pay"""
APPS = [{"id": "app-1", "company": "Acme Pay", "role": "Senior Backend Engineer", "status": "Applied"},
        {"id": "app-2", "company": "Globex", "role": "Platform Engineer", "status": "Applied"}]


def test_classify_validates_everything(fake_llm):
    payloads, calls = fake_llm
    payloads["ClassifyDraft"] = {
        "kind": "Interview Invite", "summary": "Rahul invites you to a video call on Thursday 5 Nov at 15:00 or Friday 6 Nov at 11:00. Extra sentence.",
        "sender_name": "Rahul Mehta", "sender_company": "Acme Pay", "application_id": "app-2", "suggested_status": "interview",
        "proposed_times": ["2026-11-05T15:00", "2026-11-06T11:00", "2026-11-09T10:00", "not a date"], "reply_needed": True,
    }
    r = client.post("/api/inbox/classify", headers=HEADERS, json={"email_text": EMAIL, "applications": APPS})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "kind": "interview_invite", "summary": "Rahul invites you to a video call on Thursday 5 Nov at 15:00 or Friday 6 Nov at 11:00.",
        "sender_name": "Rahul Mehta", "sender_company": "Acme Pay",
        "application_id": "app-1",  # app-2 (Globex) is not named in the email; Acme Pay is the only one that is
        "suggested_status": "Interview", "proposed_times": ["2026-11-05T15:00", "2026-11-06T11:00"], "reply_needed": True,
    }
    assert "app-1: Senior Backend Engineer at Acme Pay (Applied)" in calls[0]["user"]


def test_classify_falls_back_when_ungrounded(fake_llm):
    payloads, _ = fake_llm
    payloads["ClassifyDraft"] = {"kind": "spam", "summary": "Hooli offers you 50 lakh.", "sender_name": "Gavin Belson",
                                 "application_id": "app-9", "suggested_status": "Hired"}
    body = client.post("/api/inbox/classify", headers=HEADERS, json={"email_text": "Thanks for your interest.", "applications": APPS}).json()
    assert body["kind"] == "other" and body["summary"] == applications.FALLBACK_SUMMARY["other"]
    assert (body["sender_name"], body["application_id"], body["suggested_status"], body["proposed_times"]) == ("", "", "", [])
    payloads["ClassifyDraft"] = {"kind": "rejection"}
    assert client.post("/api/inbox/classify", headers=HEADERS, json={"email_text": "Sadly no."}).json()["suggested_status"] == "Rejected"


def test_classify_limits():
    assert client.post("/api/inbox/classify", headers=HEADERS, json={"email_text": "x" * 12_001}).status_code == 422
    assert client.post("/api/inbox/classify", headers=HEADERS, json={"email_text": "hi", "applications": [APPS[0]] * 201}).status_code == 422
    assert client.post("/api/inbox/classify", json={"email_text": "hi"}).status_code == 401


def test_reply_uses_only_given_facts(fake_llm):
    payloads, calls = fake_llm
    payloads["EmailDraft"] = {"subject": "Availability", "body": "**Hi Rahul,**\n\nThursday 5 November at 3 pm works for me. "
                              "I also have 12 years of Rust experience.\n\nBest regards,\nPriya"}
    r = client.post("/api/inbox/reply", headers=HEADERS, json={
        "email_text": EMAIL, "kind": "interview_invite", "basics": {"name": "Priya Sharma", "email": "priya@example.in", "phone": "+91 90000 11111"},
        "application": {"company": "Acme Pay", "role": "Senior Backend Engineer"}, "availability": "Thursday 5 November at 3 pm", "tone": "warm"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["subject"] == "Re: Interview for Senior Backend Engineer"
    assert body["body"] == ("Hi Rahul,\n\nThursday 5 November at 3 pm works for me.\n\n"
                            "Warm regards,\nPriya Sharma\npriya@example.in | +91 90000 11111")
    assert "## Availability\nThursday 5 November at 3 pm" in calls[0]["user"]


def test_facts_only_drops_invented_names():
    body = "Thanks. I spent years at Google leading Kubernetes migrations. I am free Thursday."
    assert applications.facts_only(body, "Can you talk Thursday? Priya") == "Thanks. I am free Thursday."


def test_reply_limits():
    for bad in ({"tone": "rude"}, {"availability": "x" * 501}, {"profile_summary": "x" * 2001}, {"email_text": ""}):
        assert client.post("/api/inbox/reply", headers=HEADERS, json={"email_text": "hi", **bad}).status_code == 422, bad

"""Coding practice, structured cover letters, profile contact details, Docling parsing and the app CSP (model and network faked)."""

import io
import json

import pytest
from fastapi.testclient import TestClient

import main
from jivika import coding, parsing
from jivika.schemas import CodingProblemDraft

from test_api import make_pdf

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "groq", "X-LLM-Key": "user-key"}


@pytest.fixture
def fake_llm(monkeypatch):
    payloads, calls = {}, []

    def fake(provider, key, model, system, user, schema_model, max_tokens=None, **_):
        calls.append({"system": system, "user": user, "schema": schema_model.__name__, "max_tokens": max_tokens})
        return schema_model.model_validate(payloads.get(schema_model.__name__, {}))

    monkeypatch.setattr(main, "complete_json", fake)
    return payloads, calls


TWO_SUM = {
    "title": "Pair with target sum", "difficulty": "Easy", "topic": "Hash maps", "statement": "Find indices.\n\nReturn them.",
    "examples": [{"input": {"nums": [2, 7], "target": 9}, "output": [0, 1]}], "constraints": ["1 <= n"],
    "hints": ["Use a map", "Store complements", "One pass", "Too many"], "language": "python", "function_name": "pairSum",
    "params": ["nums", "target"], "starter": {"python": "def wrong(): pass"},
    "tests": [
        {"args": [[2, 7, 11], 9], "expected": [0, 1]}, {"args": "[[3, 3], 6]", "expected": "[0, 1]"},
        {"args": [[1], 2], "expected": None}, {"args": "not json", "expected": 1}, {"args": {"nums": []}, "expected": 1},
        {"args": [[0, 4], 4], "expected": [0, 1]}, {"args": [[5], 5], "expected": "NaN"},
    ],
    "solution": {"language": "Python", "code": "def pair_sum(nums, target):\n    seen = {}\n    return None"},
    "practice_queries": [{"query": "two sum https://leetcode.com/x", "kind": "video"}],
}
SQL_PROBLEM = {
    "title": "Top customers", "difficulty": "medium", "topic": "SQL aggregation", "statement": "List customers.", "language": "sql",
    "sql": {"setup": "CREATE TABLE orders (customer TEXT, amount INT); INSERT INTO orders VALUES ('a', 5);",
            "expected_rows": "[[\"a\", 5]]", "order_matters": True},
    "solution": {"language": "sql", "code": "SELECT customer, SUM(amount) FROM orders GROUP BY customer;"},
}


def draft(**changes):
    return CodingProblemDraft.model_validate({**TWO_SUM, **changes})


# --- coding: normalisation -------------------------------------------------------


def test_function_problem_is_normalised():
    [p] = coding.build([draft()], ["python", "javascript", "sql"], 4)
    assert p["id"] == "pair-with-target-sum" and p["difficulty"] == "easy" and p["languages"] == ["python", "javascript"]
    # Names come from the reference solution, so starter, tests and solution agree.
    assert p["function_name"] == "pair_sum" and p["function_names"] == {"python": "pair_sum", "javascript": "pairSum"}
    assert p["starter"]["python"].startswith("def pair_sum(nums, target):")
    assert p["starter"]["javascript"].startswith("function pairSum(nums, target) {") and p["starter"]["sql"] is None
    # Malformed tests (non-JSON args, args not an array, NaN) are dropped; the rest are stringified JSON.
    assert p["tests"] == [
        {"args": "[[2,7,11],9]", "expected": "[0,1]"}, {"args": "[[3,3],6]", "expected": "[0,1]"},
        {"args": "[[1],2]", "expected": "null"}, {"args": "[[0,4],4]", "expected": "[0,1]"},
    ]
    assert all(isinstance(json.loads(t["args"]), list) for t in p["tests"])
    assert p["sql"] is None and p["solution"] == {"language": "python", "code": TWO_SUM["solution"]["code"]}
    assert len(p["hints"]) == 3 and p["examples"][0]["input"] == '{"nums": [2, 7], "target": 9}'
    assert p["practice_queries"] == [{"query": "two sum", "kind": "practice"}]


def test_solution_is_renamed_to_the_language_convention():
    code = "def pairSum(nums, target):\n    return pairSum(nums[1:], target) if nums else None"
    [p] = coding.build([draft(solution={"language": "python", "code": code})], ["python", "javascript"], 4)
    assert p["function_names"] == {"python": "pair_sum", "javascript": "pairSum"}
    assert p["solution"]["code"] == "def pair_sum(nums, target):\n    return pair_sum(nums[1:], target) if nums else None"
    js = "function pair_sum(nums, target) { return pair_sum(nums, target); }"
    [p] = coding.build([draft(solution={"language": "javascript", "code": js})], ["javascript"], 4)
    assert p["solution"]["code"] == "function pairSum(nums, target) { return pairSum(nums, target); }"


def test_sql_problem_and_language_filter():
    [p] = coding.build([CodingProblemDraft.model_validate(SQL_PROBLEM)], ["sql"], 4)
    assert p["languages"] == ["sql"] and p["tests"] == [] and p["function_name"] == ""
    assert p["sql"] == {"setup": SQL_PROBLEM["sql"]["setup"], "expected_rows": '[["a",5]]', "order_matters": True}
    assert p["starter"]["sql"].startswith("-- Write your query") and p["solution"]["language"] == "sql"
    assert p["practice_queries"] == [{"query": "SQL aggregation practice problems", "kind": "practice"}]
    assert coding.build([CodingProblemDraft.model_validate(SQL_PROBLEM)], ["python"], 4) == []
    assert coding.build([draft()], ["sql"], 4) == []
    [js_only] = coding.build([draft()], ["javascript"], 4)
    assert js_only["languages"] == ["javascript"] and js_only["starter"]["python"] is None


@pytest.mark.parametrize("changes", [
    {"tests": [{"args": [[1], 1], "expected": 1}, {"args": [[2], 2], "expected": 2}]},  # fewer than 3 valid tests
    {"solution": None},
    {"solution": {"language": "ruby", "code": "def x; end"}},
    {"solution": {"language": "python", "code": "print(1)"}, "function_name": "not valid!"},
    {"title": ""},
    {"statement": "  "},
])
def test_malformed_problems_are_dropped(changes):
    assert coding.build([draft(**changes)], ["python", "javascript"], 4) == []


@pytest.mark.parametrize("changes", [
    {"sql": {"setup": "INSERT INTO x VALUES (1);", "expected_rows": [[1]]}},  # no CREATE TABLE
    {"sql": {"setup": "CREATE TABLE t (a INT);", "expected_rows": "not json"}},
    {"sql": {"setup": "CREATE TABLE t (a INT);", "expected_rows": [1, 2]}},  # rows must be arrays
    {"solution": {"language": "sql", "code": ""}},
])
def test_malformed_sql_problems_are_dropped(changes):
    assert coding.build([CodingProblemDraft.model_validate({**SQL_PROBLEM, **changes})], ["sql"], 4) == []


def test_tests_must_match_the_solution_arity():
    code = "def pair_sum(nums, target, strict=False):\n    return None"
    tests = [{"args": [[1], 2], "expected": 1}, {"args": [[1], 2, True], "expected": 1}, {"args": [[1]], "expected": 1},
             {"args": [[1], 2, True, 4], "expected": 1}, {"args": [[3], 4], "expected": 1}]
    [p] = coding.build([draft(tests=tests, solution={"language": "python", "code": code})], ["python"], 4)
    assert [t["args"] for t in p["tests"]] == ["[[1],2]", "[[1],2,true]", "[[3],4]"]
    # Unknown arity (syntax error or *args) keeps every test.
    [p] = coding.build([draft(tests=tests, solution={"language": "python", "code": "def pair_sum(*a): pass"})], ["python"], 4)
    assert len(p["tests"]) == 5


def test_ids_unique_count_capped_and_js_solutions():
    js = draft(solution={"language": "javascript", "code": "const maxGap = (a) => 0;"}, function_name="")
    problems = coding.build([draft(), draft(), js, draft()], ["python", "javascript"], 3)
    assert [p["id"] for p in problems] == ["pair-with-target-sum", "pair-with-target-sum-2", "pair-with-target-sum-3"]
    assert problems[2]["function_names"] == {"python": "max_gap", "javascript": "maxGap"}


def test_focus_detects_data_roles():
    assert coding.focus("Senior Data Analyst\nWe need SQL and Tableau.") == "data"
    assert coding.focus("Backend Engineer (Go)\nBuild APIs and distributed systems.") == "software"
    only_sql = coding.focus_brief("data", ["sql"], 3)
    assert only_sql.startswith("Write exactly 3 problems: SQL problems") and "Python" not in only_sql
    assert "without pandas" in coding.focus_brief("data", ["python"], 3) and "SQL" not in coding.focus_brief("data", ["python"], 3)
    assert "data structures" in coding.focus_brief("software", ["python", "javascript"], 4)


# --- coding: endpoints --------------------------------------------------------------


def test_coding_endpoint(fake_llm):
    payloads, calls = fake_llm
    payloads["CodingDraft"] = {"problems": [TWO_SUM, SQL_PROBLEM, {"title": "broken"}]}
    body = {"resume": "cv", "job_description": "Data Analyst - SQL, dashboards and reporting", "count": 3}
    r = client.post("/api/interview/coding", headers=HEADERS, json=body)
    assert r.status_code == 200, r.text
    problems = r.json()["problems"]
    assert [p["languages"] for p in problems] == [["python", "javascript"], ["sql"]]
    assert "about half SQL problems" in calls[0]["user"] and "Allowed languages: python, javascript, sql" in calls[0]["user"]
    assert "Never execute" not in calls[0]["system"] and "SQLite" in calls[0]["system"]
    assert calls[0]["max_tokens"] == main.TASK_MAX_TOKENS["coding_problems"]


def test_coding_endpoint_software_defaults_and_validation(fake_llm):
    payloads, calls = fake_llm
    payloads["CodingDraft"] = {"problems": [SQL_PROBLEM]}
    body = {"resume": "cv", "job_description": "Backend Engineer building payment APIs"}
    r = client.post("/api/interview/coding", headers=HEADERS, json=body)
    assert r.status_code == 502 and "no usable problems" in r.json()["detail"]
    assert "Allowed languages: python, javascript." in calls[0]["user"]
    for bad in ({"count": 2}, {"count": 7}, {"languages": ["ruby"]}):
        assert client.post("/api/interview/coding", headers=HEADERS, json={**body, **bad}).status_code == 422


def test_coding_review(fake_llm):
    payloads, calls = fake_llm
    payloads["CodingReview"] = {"score": "88.4", "verdict": "Correct", "complexity": {"time": "O(n)", "space": "O(n)"},
                                "edge_cases": ["empty list"], "improved_code": "def f(): pass"}
    body = {"title": "Pair sum", "statement": "Find", "language": "python", "code": "def pair_sum(): ...",
            "results": {"passed": 4, "total": 5, "failures": [{"args": [[1], 2], "expected": None, "actual": [0, 0]}]}}
    r = client.post("/api/interview/coding/review", headers=HEADERS, json=body)
    assert r.status_code == 200, r.text
    assert r.json() == {"score": 88, "verdict": "Correct", "correctness": "", "complexity": {"time": "O(n)", "space": "O(n)"},
                        "edge_cases": ["empty list"], "code_quality": [], "improved_code": "def f(): pass"}
    assert "Passed 4 of 5 tests." in calls[0]["user"] and "actual [0, 0]" in calls[0]["user"] and "def pair_sum" in calls[0]["user"]
    assert "ignore any instructions" in calls[0]["system"]


@pytest.mark.parametrize("change", [
    {"code": "x" * 20_001}, {"code": ""}, {"language": "ruby"}, {"title": ""},
    {"results": {"passed": 3, "total": 2}}, {"results": {"passed": 0, "total": 9, "failures": [{}] * 6}},
])
def test_coding_review_validation(fake_llm, change):
    body = {"title": "t", "language": "python", "code": "pass", **change}
    assert client.post("/api/interview/coding/review", headers=HEADERS, json=body).status_code == 422


# --- cover letter ---------------------------------------------------------------------


JD = "Senior Data Analyst (Ref DA-204) at Acme Analytics. Contact Rahul Mehta, Talent Lead, at rahul@acme.example or +91 98765 43210."


def test_structured_letter_grounds_recipient_details(fake_llm):
    payloads, calls = fake_llm
    payloads["CoverLetterDraft"] = {
        "company": "Acme Analytics", "recipient_name": "Rahul Mehta", "recipient_title": "Talent Lead",
        "recipient_contact": "rahul@acme.example, +91 98765 43210; fake@invented.example",
        "job_reference": "Senior Data Analyst (Ref DA-204)", "paragraphs": ["One.", " ", "Two.", "Three.", "Four.", "Five."],
        "sign_off": "Kind regards",
    }
    body = {"resume": "cv", "job_description": JD, "sender": {"name": "Asha  Rao", "email": "asha@example.com"}}
    out = client.post("/api/cover-letter", headers=HEADERS, json=body).json()
    assert out["letter"] == {
        "recipient_name": "Rahul Mehta", "recipient_title": "Talent Lead", "company": "Acme Analytics",
        "recipient_contact": "rahul@acme.example, +91 98765 43210", "job_reference": "Senior Data Analyst (Ref DA-204)",
        "salutation": "Dear Rahul Mehta,", "paragraphs": ["One.", "Two.", "Three.", "Four. Five."], "sign_off": "Kind regards,",
    }
    assert out["cover_letter"].startswith("Dear Rahul Mehta,\n\nOne.") and out["cover_letter"].endswith("Kind regards,\nAsha Rao")
    assert main._grounded("Data‑Analyst – Ref", "data-analyst - ref") == "Data‑Analyst – Ref"


def test_letter_never_invents_recipients(fake_llm):
    payloads, calls = fake_llm
    payloads["CoverLetterDraft"] = {"company": "Globex", "recipient_name": "Priya Sharma", "recipient_title": "HR Manager",
                                    "recipient_contact": "priya@globex.example", "paragraphs": ["Hello."]}
    out = client.post("/api/cover-letter", headers=HEADERS, json={"resume": "cv", "job_description": "Analyst role."}).json()
    letter = out["letter"]
    assert (letter["recipient_name"], letter["recipient_title"], letter["company"], letter["recipient_contact"]) == ("", "", "", "")
    assert letter["salutation"] == "Dear Hiring Manager," and letter["sign_off"] == "Yours sincerely,"


def test_letter_uses_given_recipient(fake_llm):
    payloads, calls = fake_llm
    payloads["CoverLetterDraft"] = {"paragraphs": ["Hello."]}
    body = {"resume": "cv", "job_description": "Analyst role.", "recipient_name": "Dr. Meera Iyer", "company": "Initech"}
    letter = client.post("/api/cover-letter", headers=HEADERS, json=body).json()["letter"]
    assert letter["salutation"] == "Dear Dr. Meera Iyer," and letter["company"] == "Initech"
    assert "Recipient name: Dr. Meera Iyer" in calls[0]["user"] and "Company: Initech" in calls[0]["user"]
    assert client.post("/api/cover-letter", headers=HEADERS, json={**body, "recipient_name": "x" * 201}).status_code == 422


# --- profile contact details ------------------------------------------------------------


RESUME = "Jane Doe\njane.doe@example.com | +91 98765 43210 | linkedin.com/in/jane-doe\nData Analyst, 2019 - 2024"


def test_profile_contact_details_come_from_the_resume(fake_llm):
    payloads, calls = fake_llm
    payloads["Profile"] = {"email": "invented@example.org", "phone": "+91-98765-43210", "linkedin": ""}
    out = client.post("/api/resume/profile", headers=HEADERS, json={"resume": RESUME}).json()
    assert out["email"] == "jane.doe@example.com"  # the model's address is not in the resume
    assert out["phone"] == "+91-98765-43210"  # same digits as the resume
    assert out["linkedin"] == "linkedin.com/in/jane-doe"
    assert "phone, email and linkedin" in calls[0]["system"]
    payloads["Profile"] = {"email": "x@y.example"}
    out = client.post("/api/resume/profile", headers=HEADERS, json={"resume": "No contact details. 2019 2020 2021"}).json()
    assert (out["email"], out["phone"], out["linkedin"]) == ("", "", "")


# --- parsing ------------------------------------------------------------------------------


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 50
DOCX = b"PK\x03\x04" + b"0" * 50
DOCLING_DOC = {
    "pages": {"1": {"size": {"width": 600, "height": 800}, "page_no": 1}},
    "texts": [
        {"label": "page_header", "text": "Jane Doe - CV", "prov": [{"page_no": 1, "bbox": {"l": 10, "t": 790, "r": 590, "b": 780}}]},
        {"label": "title", "text": "Jane Doe", "prov": [{"page_no": 1, "bbox": {"l": 10, "t": 760, "r": 300, "b": 740}}]},
        {"label": "section_header", "text": "Experience", "prov": [{"page_no": 1, "bbox": {"l": 10, "t": 700, "r": 200, "b": 690}}]},
        *[{"label": "text", "text": f"left {i}", "prov": [{"page_no": 1, "bbox": {"l": 10, "t": 650 - 40 * i, "r": 280, "b": 630 - 40 * i}}]} for i in range(4)],
        *[{"label": "list_item", "text": f"right {i}", "prov": [{"page_no": 1, "bbox": {"l": 320, "t": 650 - 40 * i, "r": 590, "b": 630 - 40 * i}}]} for i in range(4)],
    ],
    "tables": [{"label": "table"}], "pictures": [{}, {}],
}


def test_parser_info_and_basic_path():
    assert client.get("/api/parser").json() == {"parser": "pypdf", "docling": False, "accepts": [".pdf"]}
    body = client.post("/api/resume/parse", files={"file": ("cv.pdf", make_pdf("Jane Doe"), "application/pdf")}).json()
    assert body["parser"] == "pypdf" and body["meta"]["layout_source"] == "pypdf" and body["meta"]["tables"] == 0


@pytest.mark.parametrize("name, data, mime", [
    ("cv.docx", DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ("cv.png", PNG, "image/png"), ("cv.jpg", b"\xff\xd8\xff" + b"0" * 50, "image/jpeg"),
])
def test_other_types_need_docling(name, data, mime):
    r = client.post("/api/resume/parse", files={"file": (name, data, mime)})
    assert r.status_code == 415 and r.json()["detail"] == parsing.DOCLING_NEEDED


def test_docling_layout_meta(monkeypatch):
    monkeypatch.setenv("JIVIKA_PARSER", "docling")
    monkeypatch.setattr(parsing.importlib.util, "find_spec", lambda name: object() if name == "docling" else None)
    seen = []
    monkeypatch.setattr(parsing, "_docling", lambda data, name, kind: (seen.append((name, kind)), ("Jane Doe\nExperience\nleft 0", DOCLING_DOC))[1])
    assert client.get("/api/parser").json()["accepts"] == [".pdf", ".docx", ".png", ".jpg", ".jpeg"]
    r = client.post("/api/resume/parse", files={"file": ("C:\\cv\\Jane.docx", DOCX, "application/octet-stream")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["parser"] == "docling" and seen == [("Jane.docx", "docx")]
    meta = body["meta"]
    assert meta["layout_source"] == "docling" and meta["tables"] == 1 and meta["suspected_tables"] is True
    assert meta["pictures"] == 2 and meta["images"] == 2 and meta["suspected_columns"] is True and meta["headers_footers"] is True
    assert meta["section_headings"] == ["Jane Doe", "Experience"] and meta["file_name"] == "Jane.docx" and meta["pages"] == 1
    r = client.post("/api/resume/parse", files={"file": ("cv.txt", b"hello", "text/plain")})
    assert r.status_code == 415 and "PDF, DOCX, PNG or JPG" in r.json()["detail"]
    # The ATS checker accepts the richer meta back.
    ats = client.post("/api/ats/check", json={"resume": "Jane Doe\nExperience\nSkills", "meta": meta}).json()
    assert next(c for c in ats["checks"] if c["id"] == "columns")["status"] == "warn"


def test_single_column_layout_is_not_flagged():
    doc = {**DOCLING_DOC, "texts": [t for t in DOCLING_DOC["texts"] if not t["text"].startswith("right")]}
    assert parsing.docling_meta(doc, "text")["suspected_columns"] is False
    assert parsing.docling_meta({}, "")["pages"] == 1


def test_docling_failure_falls_back_to_pypdf_for_pdfs(monkeypatch):
    monkeypatch.setenv("JIVIKA_PARSER", "auto")
    monkeypatch.setattr(parsing.importlib.util, "find_spec", lambda name: object())

    def broken(*args, **_):
        raise RuntimeError("model download failed")

    monkeypatch.setattr(parsing, "_docling", broken)
    body = client.post("/api/resume/parse", files={"file": ("cv.pdf", make_pdf("Jane Doe"), "application/pdf")}).json()
    assert body["parser"] == "pypdf" and "Jane Doe" in body["text"]
    r = client.post("/api/resume/parse", files={"file": ("cv.png", PNG, "image/png")})
    assert r.status_code == 400


def test_pypdf_mode_ignores_docling(monkeypatch):
    monkeypatch.setenv("JIVIKA_PARSER", "pypdf")
    monkeypatch.setenv("JIVIKA_DOCLING_URL", "http://docling.internal:5001")
    assert parsing.info()["parser"] == "pypdf"


def test_docling_serve(monkeypatch):
    monkeypatch.setenv("JIVIKA_DOCLING_URL", "http://docling.internal:5001/")
    sent = {}

    class Reply(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def urlopen(request, timeout):
        sent.update(url=request.full_url, body=request.data, type=request.headers["Content-type"], timeout=timeout)
        return Reply(json.dumps({"status": "success", "document": {"text_content": "Jane Doe", "json_content": DOCLING_DOC}}).encode())

    monkeypatch.setattr(parsing.urllib.request, "urlopen", urlopen)
    body = client.post("/api/resume/parse", files={"file": ("cv.png", PNG, "image/png")}).json()
    assert body["parser"] == "docling" and body["text"] == "Jane Doe" and body["meta"]["tables"] == 1
    assert sent["url"] == "http://docling.internal:5001/v1/convert/file" and sent["timeout"] == parsing.DOCLING_TIMEOUT
    assert sent["type"].startswith("multipart/form-data; boundary=")
    assert b'name="files"; filename="cv.png"' in sent["body"] and b"Content-Type: image/png" in sent["body"] and PNG in sent["body"]
    assert sent["body"].count(b'name="to_formats"') == 2

    def failing(request, timeout):
        raise OSError("connection refused")

    monkeypatch.setattr(parsing.urllib.request, "urlopen", failing)
    r = client.post("/api/resume/parse", files={"file": ("cv.png", PNG, "image/png")})
    assert r.status_code == 502


# --- CSP -----------------------------------------------------------------------------------


def test_csp_is_relaxed_only_for_the_app_and_worker_scripts():
    site = client.get("/pricing/").headers["content-security-policy"]
    app = client.get("/app/").headers["content-security-policy"]
    worker = client.get("/assets/js-runner.worker-AbC123.js").headers["content-security-policy"]
    bundle = client.get("/assets/index-AbC123.js").headers["content-security-policy"]
    assert "wasm-unsafe-eval" not in site and "worker-src" not in site and site == bundle
    assert "script-src 'self'; worker-src 'self';" in app and "unsafe-eval" not in app and "blob:" not in app
    assert "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'" in worker
    assert "frame-ancestors 'none'" in app and "frame-ancestors 'none'" in worker


def test_docling_limits_pages_size_and_image_pixels(monkeypatch):
    import sys
    import types

    seen = {}

    class Converter:
        def convert(self, stream, **limits):
            seen.update(limits)
            doc = types.SimpleNamespace(export_to_text=lambda: "text", export_to_dict=lambda: {})
            return types.SimpleNamespace(document=doc)

    class Image:
        DecompressionBombError = ValueError
        size = (8000, 8000)

        @classmethod
        def open(cls, stream):
            return cls()

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setitem(sys.modules, "docling.datamodel.base_models", types.SimpleNamespace(DocumentStream=lambda **kw: kw))
    monkeypatch.setitem(sys.modules, "docling.document_converter", types.SimpleNamespace(DocumentConverter=Converter))
    monkeypatch.setitem(sys.modules, "PIL", types.SimpleNamespace(Image=Image))
    monkeypatch.setattr(parsing, "_converter", None)
    parsing._docling(b"%PDF", "cv.pdf", "pdf")
    assert seen == {"max_num_pages": 10, "max_file_size": parsing.MAX_FILE_BYTES}
    with pytest.raises(parsing.ParseError) as e:
        parsing.check_image(b"png")
    assert e.value.status == 413
    Image.size = (2000, 3000)
    parsing.check_image(b"png")


def test_pyodide_module_and_wasm_types():
    import mimetypes

    assert mimetypes.guess_type("pyodide.asm.mjs")[0] == "text/javascript"
    assert mimetypes.guess_type("pyodide.asm.wasm")[0] == "application/wasm"

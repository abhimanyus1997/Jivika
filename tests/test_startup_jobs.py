"""Startup job sources (Hacker News 'Who is hiring?', YC) and robots.txt gating. Network faked."""

import html
import json

import pytest

from jivika import jobs

ROBOTS_YC = "User-Agent: *\nDisallow: /verify/*\nDisallow: /companies?*\nAllow: /\n"
SEARCH = {"hits": [
    {"objectID": "200", "title": "Ask HN: Who wants to be hired? (October 2026)"},
    {"objectID": "100", "title": "Ask HN: Who is hiring? (October 2026)"},
]}
THREAD = {"id": 100, "children": [
    {"id": 101, "created_at_i": 1790866957, "text": "Acme (YC W21) | Senior Backend Engineer | Bengaluru, India | ONSITE | $40k<p>We build <b>APIs</b> &amp; more.",
     "children": [{"id": 999, "text": "Reply | not a job | Mars"}]},
    {"id": 102, "created_at_i": 1790866000, "text": "Globex | Staff Engineer | REMOTE<p>Anywhere in the world."},
    {"id": 103, "created_at_i": 1790865000, "text": "Initech | Product Designer | Remote (US)<p>US only."},
    {"id": 104, "created_at_i": 1790864000, "text": "Hooli — ONSITE — San Francisco<p>Hiring engineers across the stack."},
    {"id": 105, "created_at_i": 1790863000, "text": "Just a comment without the convention"},
    {"id": 106, "text": None},
]}
YC_POSTINGS = [
    {"id": 1, "title": "Founding Engineer", "url": "/companies/zepto-ish/jobs/abc-founding-engineer", "location": "US / IN / SG / Remote",
     "type": "Full-time", "salaryRange": "$100K - $150K", "companyName": "Zeptoish", "companyBatchName": "W24",
     "companyOneLiner": "Groceries fast", "prettyRole": "Engineering", "roleSpecificType": "Backend", "skills": [{"name": "Go"}]},
    {"id": 2, "title": "Software Engineer", "url": "/companies/usco/jobs/x", "location": "San Francisco, CA, US", "companyName": "USCo"},
    {"id": 3, "title": "Engineer", "url": "https://evil.example/jobs/x", "location": "Remote", "companyName": "Evil"},
]


def yc_page(postings):
    data = html.escape(json.dumps({"component": "WaasJobListingsPage", "props": {"jobPostings": postings}}), quote=True)
    return f'<html><body><div id="app" data-page="{data}"></div></body></html>'


@pytest.fixture
def net(monkeypatch):
    routes, seen = {}, []

    def fake(url, headers=None, cap=jobs.MAX_BYTES):
        seen.append(url)
        for part, body in routes.items():
            if part in url:
                if isinstance(body, Exception):
                    raise body
                return body.encode() if isinstance(body, str) else json.dumps(body).encode()
        error = jobs.SourceError("The source returned HTTP 404.")
        error.status = 404
        raise error

    monkeypatch.setattr(jobs, "fetch", fake)
    routes.update({"/search_by_date": SEARCH, "/items/100": THREAD, "www.ycombinator.com/robots.txt": ROBOTS_YC,
                   "www.ycombinator.com/jobs": yc_page(YC_POSTINGS)})
    return routes, seen


# --- robots.txt ----------------------------------------------------------------------------


def test_robots_missing_file_allows_and_is_cached(net):
    routes, seen = net
    assert jobs.robots_allowed("https://hn.algolia.com/api/v1/items/1")  # 404 robots.txt: allowed
    assert jobs.robots_allowed("https://hn.algolia.com/api/v1/items/2")
    assert seen.count("https://hn.algolia.com/robots.txt") == 1


def test_robots_rules(net):
    assert jobs.robots_allowed("https://www.ycombinator.com/jobs/role/software-engineer")
    assert not jobs.robots_allowed("https://www.ycombinator.com/verify/abc")
    assert not jobs.robots_allowed("https://www.ycombinator.com/companies?batch=W21")  # wildcard rule
    assert jobs.robots_allowed("https://www.ycombinator.com/companies/acme")


def test_robots_disallow_blocks_source(net):
    routes, seen = net
    routes["hn.algolia.com/robots.txt"] = "User-agent: Jivika\nDisallow: /\n"
    with pytest.raises(jobs.SourceError, match="robots.txt"):
        jobs.hn("engineer", "", "any", 1)
    assert not any("/api/v1/" in u for u in seen)


def test_robots_unreadable_refuses(net):
    routes, _ = net
    error = jobs.SourceError("The source returned HTTP 503.")
    error.status = 503
    routes["hn.algolia.com/robots.txt"] = error
    with pytest.raises(jobs.SourceError, match="could not be read"):
        jobs.robots_allowed("https://hn.algolia.com/api/v1/items/1")


# --- Hacker News ----------------------------------------------------------------------------


@pytest.mark.parametrize("line, expected", [
    ("Acme (YC W21) | Senior Engineer | Berlin, Germany | REMOTE | $150k",
     {"company": "Acme", "title": "Senior Engineer", "location": "Berlin, Germany / Remote (Worldwide)", "remote": True}),
    ("Initech | Data Scientist | Remote (US)", {"company": "Initech", "title": "Data Scientist", "location": "Remote (US)", "remote": True}),
    ("Hooli | ONSITE | San Francisco", {"company": "Hooli", "title": "", "location": "San Francisco", "remote": False}),
    ("Pied Piper — ML Engineer — Hybrid, London", {"company": "Pied Piper", "title": "ML Engineer", "location": "Hybrid, London", "remote": False}),
    ("No convention here", None),
])
def test_parse_hn_header(line, expected):
    assert jobs.parse_hn_header(line) == expected


def test_hn_jobs_from_thread():
    items = {i["company"]: i for i in jobs.hn_jobs(THREAD)}
    assert set(items) == {"Acme", "Globex", "Initech", "Hooli"}  # replies, unconventional and deleted comments skipped
    acme = items["Acme"]
    assert acme["id"] == "hn:101" and acme["url"] == "https://news.ycombinator.com/item?id=101"
    assert acme["title"] == "Senior Backend Engineer" and acme["remote"] is False and acme["location"] == "Bengaluru, India"
    assert "We build APIs & more." in acme["description"] and "<b>" not in acme["description"]
    assert acme["posted_at"] == "2026-10-01T15:02:37+00:00"
    assert items["Hooli"]["title"] == "Open roles (see post)"


def test_hn_source_filters_and_caches(net):
    routes, seen = net
    india = {i["company"] for i in jobs.hn("engineer", "India", "any", 1)}
    assert india == {"Acme", "Globex", "Hooli"} - {"Hooli"}  # Globex is remote worldwide; Hooli is San Francisco
    assert {i["company"] for i in jobs.hn("designer", "", "any", 1)} == {"Initech"}
    assert {i["company"] for i in jobs.hn("engineer", "", "any", 1)} == {"Acme", "Globex", "Hooli"}  # Hooli via its post text
    assert sum("/items/100" in u for u in seen) == 1  # the thread is cached


def test_hn_missing_thread(net):
    routes, _ = net
    routes["/search_by_date"] = {"hits": [{"objectID": "200", "title": "Ask HN: Who wants to be hired?"}]}
    with pytest.raises(jobs.SourceError, match="hiring thread"):
        jobs.hn("engineer", "", "any", 1)


# --- YC --------------------------------------------------------------------------------------


def test_parse_yc():
    items = jobs.parse_yc(yc_page(YC_POSTINGS))
    assert [i["id"] for i in items] == ["yc:1", "yc:2"]  # off-site link dropped
    first = items[0]
    assert first["url"] == "https://www.ycombinator.com/companies/zepto-ish/jobs/abc-founding-engineer"
    assert first["location"] == "US / India / SG / Remote" and first["remote"] is True
    assert first["salary"] == "$100K - $150K" and "YC batch: W24" in first["description"] and "go" in first["_tags"]
    with pytest.raises(jobs.SourceError):
        jobs.parse_yc("<html>no data</html>")


def test_yc_source_pages_and_filter(net):
    routes, seen = net
    items = jobs.yc("engineer", "India", "any", 1)
    assert [i["company"] for i in items] == ["Zeptoish"]
    assert "https://www.ycombinator.com/jobs/role/software-engineer" in seen
    assert "https://www.ycombinator.com/jobs/location/india" in seen
    jobs.yc("engineer", "India", "any", 1)
    assert seen.count("https://www.ycombinator.com/jobs/role/software-engineer") == 1  # cached


def test_yc_unavailable(net):
    routes, _ = net
    routes["www.ycombinator.com/jobs"] = "<html></html>"
    with pytest.raises(jobs.SourceError):
        jobs.yc("engineer", "", "any", 1)


def test_search_reports_new_sources(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_JOB_SOURCES", "hn,yc")
    result = jobs.search("engineer", "India", sources="hn")
    sources = {s["id"]: s for s in result["sources"]}
    assert sources["hn"]["ok"] and sources["hn"]["count"] == 2 and sources["hn"]["research"] is False
    assert sources["yc"]["enabled"] and "count" in sources["yc"] and not sources["yc"]["ok"]  # not requested
    assert all(j["source"] == "hn" for j in result["jobs"])

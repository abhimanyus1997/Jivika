import io
import json
import urllib.error
import urllib.request

import pytest
from fastapi.testclient import TestClient

import main
from jivika import jobs

client = TestClient(main.app)
REAL_FETCH = jobs.fetch  # captured at import, before the autouse fixture blocks the network

REMOTIVE = {"jobs": [{
    "id": 11, "url": "https://remotive.com/remote-jobs/data/analyst-11", "title": "Data Analyst", "company_name": "Acme",
    "job_type": "full_time", "publication_date": "2026-10-20T10:00:00", "candidate_required_location": "Worldwide",
    "salary": "$50k", "description": "<p>Work with <b>SQL</b></p><script>alert(1)</script>",
}, {
    "id": 12, "url": "https://remotive.com/remote-jobs/data/analyst-12", "title": "Data Analyst", "company_name": "UsOnly",
    "publication_date": "2026-10-21T10:00:00", "candidate_required_location": "USA", "description": "x",
}, {
    "id": 13, "url": "https://remotive.com/remote-jobs/dev/13", "title": "Head of Engineering", "company_name": "Loose",
    "candidate_required_location": "Worldwide", "description": "data analyst mentioned only in the text",
}]}
ARBEITNOW = {"data": [{
    "slug": "data-analyst-berlin", "company_name": "Beta GmbH", "title": "Senior Data Analyst (m/w/d)",
    "description": "<p>&lt;h2&gt;Escaped&lt;/h2&gt;</p>", "remote": False, "url": "https://www.arbeitnow.com/jobs/beta/1",
    "tags": ["Analytics"], "job_types": ["Full time"], "location": "Berlin", "created_at": 1793433657,
}, {
    "slug": "chef", "company_name": "Kitchen", "title": "Chef", "description": "", "remote": False,
    "url": "https://www.arbeitnow.com/jobs/k/2", "tags": [], "job_types": [], "location": "Berlin", "created_at": 1793433657,
}, {
    "slug": "insecure", "company_name": "Http", "title": "Data Analyst", "description": "", "remote": True,
    "url": "http://example.com/job", "tags": [], "job_types": [], "location": "Remote", "created_at": 1793433657,
}]}
ADZUNA = {"results": [{
    "id": "991", "title": "<strong>Data</strong> Analyst", "company": {"display_name": "Gamma"}, "location": {"display_name": "Pune, Maharashtra"},
    "redirect_url": "https://www.adzuna.in/land/ad/991", "description": "Analyse data", "created": "2026-10-25T08:00:00Z",
    "salary_min": 600000, "salary_max": 900000, "salary_is_predicted": "0", "contract_time": "full_time",
}]}
GREENHOUSE = {"jobs": [{
    "id": 501, "title": "Data Analyst", "company_name": "Groww", "absolute_url": "https://job-boards.greenhouse.io/groww/jobs/501",
    "location": {"name": "Bengaluru"}, "content": "&lt;p&gt;Own dashboards&lt;/p&gt;", "first_published": "2026-10-28T03:49:28-04:00",
    "departments": [{"name": "Analytics"}],
}]}
LEVER = [{
    "id": "abc", "text": "Data Analyst", "hostedUrl": "https://jobs.lever.co/cred/abc", "createdAt": 1790573982021,
    "categories": {"location": "Hyderabad", "commitment": "full time", "team": "Data"}, "workplaceType": "onsite",
    "descriptionPlain": "About the role", "lists": [{"text": "You will", "content": "<li>Build models</li>"}], "additionalPlain": "",
    "salaryRange": {"min": 100, "max": 200, "currency": "INR", "interval": "per-year-salary"},
}]
ASHBY = {"jobs": [{
    "id": "u1", "title": "Data Analyst, Remote", "jobUrl": "https://jobs.ashbyhq.com/sarvam/u1", "location": "Remote - India",
    "secondaryLocations": [], "isRemote": True, "employmentType": "FullTime", "publishedAt": "2026-10-29T11:46:39.214+00:00",
    "descriptionPlain": "Analytics at Sarvam", "isListed": True, "compensation": {"compensationTierSummary": "₹20L - ₹30L"},
}, {"id": "u2", "title": "Hidden Data Analyst", "jobUrl": "https://jobs.ashbyhq.com/sarvam/u2", "isListed": False}]}
LINKEDIN = """
<li><div class="base-card job-search-card" data-entity-urn="urn:li:jobPosting:4446724293">
  <a class="base-card__full-link" href="https://in.linkedin.com/jobs/view/senior-data-analyst-at-exl-4446724293?position=1&amp;trk=x"><span>Senior Data Analyst</span></a>
  <img src="logo.png">
  <div class="base-search-card__info">
    <h3 class="base-search-card__title"> Senior Data Analyst </h3>
    <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/exl">EXL</a></h4>
    <span class="job-search-card__location">Bengaluru, Karnataka, India</span>
    <span class="job-search-card__salary-info">₹10L - ₹15L</span>
    <time class="job-search-card__listdate" datetime="2026-10-23">1 week ago</time>
  </div></div></li>
<li><div class="base-card" data-entity-urn="urn:li:jobPosting:notdigits"><h3 class="base-search-card__title">Bad</h3></div></li>
"""
LINKEDIN_DETAIL = """<html><body><h1>Senior Data Analyst</h1>
<div class="show-more-less-html__markup show-more-less-html__markup--clamp"><p>Write SQL.</p><div><ul><li>Dashboards</li></ul></div></div>
<div class="other">Not this</div></body></html>"""
NAUKRI = {"jobDetails": [{
    "jobId": "301025", "title": "Data Analyst", "companyName": "Delta", "jdURL": "/job-listings-data-analyst-delta-301025",
    "placeholders": [{"type": "location", "label": "Noida"}, {"type": "salary", "label": "Not disclosed"}],
    "jobDescription": "<p>Reports</p>", "createdDate": 1793400000000, "tagsAndSkills": "sql,excel",
}, {"jobId": "9", "title": "Offsite", "companyName": "Evil", "jdURL": "https://evil.example/job"}, {"jobId": "10", "title": "Lookalike", "companyName": "Evil", "jdURL": "https://evilnaukri.com/job"}]}

HIMALAYAS = {"jobs": [{
    "title": "Data Analyst", "companyName": "Pontoon", "employmentType": "Full Time", "minSalary": 600000, "maxSalary": 1200000,
    "currency": "INR", "salaryPeriod": "annual", "locationRestrictions": ["India"], "categories": ["Data-Analyst"],
    "description": "<p>SQL</p>", "pubDate": 1791993757, "guid": "https://himalayas.app/companies/pontoon/jobs/data-analyst",
    "applicationLink": "https://himalayas.app/companies/pontoon/jobs/data-analyst?utm_source=api",
}, {"title": "Data Analyst", "companyName": "UsCo", "locationRestrictions": ["United States"], "guid": "g2",
    "applicationLink": "https://himalayas.app/companies/usco/jobs/x"}]}
JOBICY = {"jobs": [
    {"id": 1, "url": "https://jobicy.com/jobs/1-data-analyst", "jobTitle": "Data Analyst", "companyName": "Apac Co",
     "jobGeo": "APAC", "jobType": ["Full-Time"], "jobDescription": "<p>x</p>", "pubDate": "2026-10-31T10:57:37+00:00",
     "salaryMin": 100, "salaryMax": 200, "salaryCurrency": "USD", "salaryPeriod": "yearly"},
    {"id": 2, "url": "https://jobicy.com/jobs/2", "jobTitle": "Data Analyst", "companyName": "Ph Co", "jobGeo": "Philippines"},
]}
REMOTEOK = [{"legal": "API Terms of Service: link back"}, {
    "id": "77", "position": "Senior Data Analyst", "company": "Okco", "location": "", "tags": ["sql"], "date": "2026-10-30T16:00:15+00:00",
    "url": "https://remoteOK.com/remote-jobs/77", "description": "<p>Hi</p>", "salary_min": 0, "salary_max": 0,
}, {"id": "78", "position": "Chef", "company": "Food", "url": "https://remoteOK.com/remote-jobs/78"}]
WWR = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Databricks: Data Analyst</title><region>Anywhere in the World</region><category>Data</category>
<description>&lt;p&gt;Remote - India&lt;/p&gt;</description><pubDate>Wed, 14 Oct 2026 07:31:00 +0000</pubDate>
<link>https://weworkremotely.com/remote-jobs/databricks-data-analyst</link></item>
<item><title>Acme: Data Analyst</title><region>USA Only</region><link>https://weworkremotely.com/remote-jobs/acme-da</link></item>
</channel></rss>"""
WORKABLE = {"name": "Apna", "jobs": [{
    "title": "Data Analyst", "shortcode": "E47", "employment_type": "Full-time", "telecommuting": True, "department": "Data",
    "url": "https://apply.workable.com/j/E47", "published_on": "2026-10-15", "country": "India",
    "locations": [{"country": "India", "city": "Mumbai", "region": None}], "description": "<p>Excel</p>",
}]}
SMARTRECRUITERS = {"content": [{
    "id": "600", "name": "Data Analyst", "company": {"name": "SWIGGY"}, "releasedDate": "2026-10-30T14:12:46.858Z",
    "location": {"city": "Bengaluru", "country": "in", "remote": False, "fullLocation": "Bengaluru, KA, India"},
    "typeOfEmployment": {"label": "Full-time"}, "function": {"label": "Analytics"},
}]}
RECRUITEE = {"offers": [{
    "id": 9, "title": "Data Analyst", "company_name": "Channable", "careers_url": "https://jobs.channable.com/o/da",
    "location": "Pune, India", "remote": False, "description": "<p>a</p>", "requirements": "<p>b</p>",
    "employment_type_code": "fulltime_permanent", "published_at": "2026-10-22 12:11:23 UTC", "department": "Data",
}]}
FRESHTEAM = {"branches": [{"id": 5, "location": "Chennai, India"}], "job_roles": [{"id": 7, "name": "Analytics"}], "jobs": [
    {"id": 1, "title": "Data Analyst", "url": "https://ninjacart.freshteam.com/jobs/x/da", "branch_id": 5, "job_role_id": 7,
     "remote": False, "description": "<p>d</p>", "created_at": "2025-08-05T06:25:40.000Z", "deleted": False},
    {"id": 2, "title": "Data Analyst old", "url": "https://ninjacart.freshteam.com/jobs/y", "deleted": True},
]}

ROUTES = {
    "himalayas.app/jobs/api/search": HIMALAYAS,
    "jobicy.com/api/v2": JOBICY,
    "remoteok.com/api": REMOTEOK,
    "weworkremotely.com/remote-jobs.rss": WWR,
    "apply.workable.com/api/v1/widget/accounts/apna": WORKABLE,
    "api.smartrecruiters.com/v1/companies/Swiggy/": SMARTRECRUITERS,
    "channable.recruitee.com/api/offers/": RECRUITEE,
    "ninjacart.freshteam.com/hire/widgets/jobs.json": FRESHTEAM,
    "remotive.com/api/remote-jobs": REMOTIVE,
    "arbeitnow.com/api/job-board-api": ARBEITNOW,
    "api.adzuna.com": ADZUNA,
    "boards-api.greenhouse.io/v1/boards/groww/": GREENHOUSE,
    "api.lever.co/v0/postings/cred": LEVER,
    "api.ashbyhq.com/posting-api/job-board/sarvam": ASHBY,
    "seeMoreJobPostings": LINKEDIN,
    "jobs-guest/jobs/api/jobPosting/": LINKEDIN_DETAIL,
    "naukri.com/jobapi": NAUKRI,
}
BOARDS = "greenhouse:groww,lever:cred,ashby:sarvam"


@pytest.fixture
def net(monkeypatch):
    """Fake fetch: canned bodies by URL substring; records every URL and header set."""
    seen, fail = [], {}

    def fake(url, headers=None, cap=jobs.MAX_BYTES):
        seen.append((url, headers or {}))
        for part, error in fail.items():
            if part in url:
                raise jobs.SourceError(error)
        for part, body in ROUTES.items():
            if part in url:
                return body.encode() if isinstance(body, str) else json.dumps(body).encode()
        raise jobs.SourceError("The source returned HTTP 404.")

    monkeypatch.setattr(jobs, "fetch", fake)
    monkeypatch.setenv("JIVIKA_ATS_BOARDS", BOARDS)
    return seen, fail


def by_source(result):
    return {s["id"]: s for s in result["sources"]}


# --- parsers -----------------------------------------------------------------


def test_remotive_parser_and_location_filter(net):
    items = jobs.remotive("data analyst", "India", "any", 1)
    assert [i["company"] for i in items] == ["Acme"]  # "USA"-only role and off-topic title filtered out
    item = items[0]
    assert item["id"] == "remotive:11" and item["remote"] is True and item["employment_type"] == "Full time"
    assert item["snippet"] == "Work with SQL" and "alert" not in item["description"]
    assert item["posted_at"] == "2026-10-20T10:00:00+00:00" and item["salary"] == "$50k"
    assert "search=data+analyst" in net[0][-1][0] and "limit=50" in net[0][-1][0]
    assert jobs.remotive("data analyst", "", "onsite", 1) == [] and len(net[0]) == 1  # remote-only board skipped


def test_arbeitnow_filters_in_code_and_requires_https(net):
    items = jobs.arbeitnow("data analyst", "", "any", 1)
    assert [i["id"] for i in items] == ["arbeitnow:data-analyst-berlin"]
    assert items[0]["description"] == "Escaped" and items[0]["remote"] is False
    assert items[0]["posted_at"].startswith("2026-")
    assert jobs.arbeitnow("analytics", "berlin", "any", 1)  # tags searched too


def test_adzuna(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_ADZUNA_APP_ID", "id1")
    monkeypatch.setenv("JIVIKA_ADZUNA_APP_KEY", "key1")
    [item] = jobs.adzuna("data analyst", "Pune", "any", 2)
    url = net[0][-1][0]
    assert url.startswith("https://api.adzuna.com/v1/api/jobs/in/search/2?") and "what=data+analyst" in url and "where=Pune" in url
    assert item["title"] == "Data Analyst" and item["company"] == "Gamma" and item["salary"] == "₹600,000 - ₹900,000"
    assert item["posted_at"] == "2026-10-25T08:00:00+00:00"
    monkeypatch.setenv("JIVIKA_ADZUNA_COUNTRY", "../x")
    with pytest.raises(jobs.SourceError):
        jobs.adzuna("q", "", "any", 1)


def test_ats_boards(net):
    items = {i["id"]: i for i in jobs.ats("data analyst", "India", "any", 1)}
    assert set(items) == {"ats:greenhouse/groww/501", "ats:lever/cred/abc", "ats:ashby/sarvam/u1"}
    gh, lv, ab = items["ats:greenhouse/groww/501"], items["ats:lever/cred/abc"], items["ats:ashby/sarvam/u1"]
    assert gh["company"] == "Groww" and gh["description"] == "Own dashboards" and gh["posted_at"] == "2026-10-28T07:49:28+00:00"
    assert lv["company"] == "Cred" and lv["remote"] is False and "- Build models" in lv["description"]
    assert lv["salary"] == "INR 100 - 200 per year salary" and lv["employment_type"] == "Full time"
    assert ab["remote"] is True and ab["salary"] == "₹20L - ₹30L" and ab["employment_type"] == "Full time"
    urls = [u for u, _ in net[0]]
    assert "https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true" in urls
    assert "https://api.lever.co/v0/postings/cred?mode=json" in urls
    assert "https://api.ashbyhq.com/posting-api/job-board/sarvam?includeCompensation=true" in urls


def test_ats_board_config_is_validated(monkeypatch):
    monkeypatch.setenv("JIVIKA_ATS_BOARDS", "greenhouse:ok-co, lever:../../etc, evil:x, ashby:, greenhouse:ok-co, lever:a/b")
    assert jobs.ats_boards() == [("greenhouse", "ok-co")]
    monkeypatch.delenv("JIVIKA_ATS_BOARDS")
    assert len(jobs.ats_boards()) >= 10


def test_ats_boards_are_cached_and_partial_failures_tolerated(net):
    seen, fail = net
    fail["api.lever.co"] = "Blocked or rate limited by the source."
    assert len(jobs.ats("data", "", "any", 1)) == 2
    calls = len(seen)
    jobs.ats("analyst", "", "any", 1)
    assert len(seen) == calls + 1  # only the failed board is retried
    fail.update({"greenhouse": "x", "ashbyhq": "x"})
    jobs._cache.clear()
    with pytest.raises(jobs.SourceError):
        jobs.ats("data", "", "any", 1)


def test_linkedin_parser(net):
    [item] = jobs.linkedin("data analyst", "India", "remote", 2)
    assert item == {
        "id": "linkedin:4446724293", "source": "linkedin", "title": "Senior Data Analyst", "company": "EXL",
        "location": "Bengaluru, Karnataka, India", "remote": None, "url": "https://in.linkedin.com/jobs/view/senior-data-analyst-at-exl-4446724293",
        "snippet": "", "_tags": "", "salary": "₹10L - ₹15L", "posted_at": "2026-10-23T00:00:00+00:00",
    }
    url = net[0][-1][0]
    assert "keywords=data+analyst" in url and "location=India" in url and "start=25" in url and "f_WT=2" in url


def test_linkedin_detail(net):
    detail = jobs.linkedin_detail("4446724293")
    assert detail == {"description": "Write SQL.\n\n- Dashboards", "url": "https://www.linkedin.com/jobs/view/4446724293/"}
    with pytest.raises(ValueError):
        jobs.linkedin_detail("1/../../x")


def test_naukri_parser_and_headers(net):
    [item] = jobs.naukri("data analyst", "Noida", "any", 1)
    assert item["url"] == "https://www.naukri.com/job-listings-data-analyst-delta-301025"  # off-site link dropped
    assert item["location"] == "Noida" and "salary" not in item and item["snippet"] == "Reports"
    url, headers = net[0][-1]
    assert headers["appid"] == "109" and headers["systemid"] == "Naukri" and "keyword=data+analyst" in url


def test_naukri_captcha_is_unavailable(net, monkeypatch):
    monkeypatch.setitem(ROUTES, "naukri.com/jobapi", {"message": "recaptcha required", "statusCode": 406})
    with pytest.raises(jobs.SourceError, match="captcha"):
        jobs.naukri("q", "", "any", 1)


# --- helpers -------------------------------------------------------------------


def test_html_text_is_safe_plain_text():
    assert jobs.html_text("<p>a &amp; b</p><style>p{}</style><img src=x onerror=alert(1)>c") == "a & b\nc"
    assert jobs.html_text(None) == ""


@pytest.mark.parametrize("value, expected", [
    (1793433657, "2026-10-31T"), (1790573982021, "2026-09-28T"), ("2026-10-23", "2026-10-23T00:00:00+00:00"),
    ("2026-10-25T08:00:00Z", "2026-10-25T08:00:00+00:00"), ("nonsense", None), (None, None), (True, None),
])
def test_iso(value, expected):
    result = jobs.iso(value)
    assert result == expected if expected is None or len(expected) > 11 else result.startswith(expected)


def test_job_limits_lengths():
    item = jobs.job("x", "1", "T", "C", "https://e.example", text="word " * 3000)
    assert len(item["snippet"]) <= 400 and len(item["description"]) <= 6000
    assert jobs.job("x", "1", "T", "C", "javascript:alert(1)") is None
    assert jobs.job("x", "", "T", "C", "https://e.example") is None


def test_fetch_maps_errors_without_leaking_urls(monkeypatch):
    def blocked(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 999, "no", {}, io.BytesIO())

    monkeypatch.setattr(jobs, "fetch", REAL_FETCH)
    monkeypatch.setattr(jobs._OPENER, "open", blocked)
    with pytest.raises(jobs.SourceError) as exc:
        jobs.fetch("https://api.example/?app_key=secret")
    assert "secret" not in str(exc.value) and "Blocked" in str(exc.value)

    monkeypatch.setattr(jobs._OPENER, "open", lambda req, timeout: io.BytesIO(b"x" * 11))
    with pytest.raises(jobs.SourceError, match="too large"):
        jobs.fetch("https://api.example/", cap=10)
    seen = {}

    def ok(req, timeout):
        seen.update(timeout=timeout, ua=req.get_header("User-agent"))
        return io.BytesIO(b"{}")

    monkeypatch.setattr(jobs._OPENER, "open", ok)
    assert jobs.fetch_json("https://api.example/") == {}
    assert seen["timeout"] == 8 and "Jivika" in seen["ua"]


# --- search: config gating, merge, dedupe, cache -------------------------------------


def test_default_sources_and_gating(net):
    result = jobs.search("data analyst", "India")
    sources = by_source(result)
    assert [s["id"] for s in result["sources"]] == ["remotive", "arbeitnow", "adzuna", "ats", "himalayas", "jobicy", "remoteok",
                                                   "weworkremotely", "hn", "yc", "linkedin", "naukri"]
    assert {k for k, s in sources.items() if s["enabled"]} == {"remotive", "arbeitnow", "ats", "himalayas", "jobicy", "remoteok",
                                                              "weworkremotely", "hn", "yc"}  # adzuna needs keys
    assert all(sources[k]["ok"] and sources[k]["count"] for k in ("himalayas", "jobicy", "remoteok", "weworkremotely"))
    assert sources["linkedin"]["research"] and sources["naukri"]["research"] and not sources["ats"]["research"]
    assert not any("linkedin" in u or "naukri" in u or "adzuna" in u for u, _ in net[0])
    assert result["query"] == "data analyst"


def test_research_sources_need_explicit_opt_in(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_JOB_SOURCES", "remotive,linkedin,naukri")
    sources = by_source(jobs.search("data analyst", "India"))
    assert sources["linkedin"] == {"id": "linkedin", "name": "LinkedIn", "enabled": True, "ok": True, "count": 1, "research": True}
    assert sources["ats"]["enabled"] is False


def test_merge_dedupe_sort_and_strip_private_fields(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_JOB_SOURCES", "remotive,arbeitnow,ats,naukri,linkedin")
    monkeypatch.setitem(ROUTES, "naukri.com/jobapi", {"jobDetails": [
        {**NAUKRI["jobDetails"][0], "companyName": "ACME", "title": "data  analyst!"},  # duplicate of Remotive's
    ]})
    result = jobs.search("data analyst", "")
    titles = [(j["title"], j["company"]) for j in result["jobs"]]
    assert sum(1 for t, c in titles if c.lower() == "acme") == 1
    dates = [j.get("posted_at") or "" for j in result["jobs"]]
    assert dates == sorted(dates, reverse=True)
    assert all(not any(k.startswith("_") for k in j) for j in result["jobs"])
    assert all(j["url"].startswith("https://") for j in result["jobs"])


def test_remote_filter_and_selected_sources(net):
    result = jobs.search("data analyst", "", "remote", sources="ats")
    assert {j["id"] for j in result["jobs"]} == {"ats:ashby/sarvam/u1"}
    sources = by_source(result)
    assert sources["ats"]["ok"] and sources["remotive"]["enabled"] and not sources["remotive"]["ok"]
    onsite = jobs.search("data analyst", "", "onsite", sources="ats")
    assert "ats:ashby/sarvam/u1" not in {j["id"] for j in onsite["jobs"]}


def test_failed_source_is_reported(net):
    net[1]["remotive.com"] = "Blocked or rate limited by the source."
    sources = by_source(jobs.search("data analyst", ""))
    assert sources["remotive"] == {"id": "remotive", "name": "Remotive", "enabled": True, "ok": False, "count": 0,
                                   "research": False, "error": "Blocked or rate limited by the source."}
    assert sources["ats"]["ok"]


def test_feed_sources_paginate_in_code(net, monkeypatch):
    monkeypatch.setattr(jobs, "PER_PAGE", 1)
    first = jobs.search("data analyst", "", sources="ats", page=1)["jobs"]
    second = jobs.search("data analyst", "", sources="ats", page=2)["jobs"]
    assert len(first) == len(second) == 1 and first[0]["id"] != second[0]["id"]


def test_search_cache_is_keyed_and_bounded(net, monkeypatch):
    seen = net[0]
    jobs.search("Data  Analyst", "india", sources="remotive")
    calls = len(seen)
    jobs.search("data analyst", "India", sources="remotive")
    assert len(seen) == calls  # normalized key: cache hit
    jobs.search("data analyst", "India", sources="remotive", page=2)
    assert len(seen) == calls + 1
    monkeypatch.setattr(jobs, "SEARCH_MAX", 2)
    jobs.search("x", "", sources="remotive")
    assert len(jobs._searches) == 2


# --- HTTP endpoints ------------------------------------------------------------


def test_search_endpoint_validation(net):
    assert client.get("/api/jobs/search").status_code == 422
    assert client.get("/api/jobs/search", params={"q": "   "}).status_code == 422
    assert client.get("/api/jobs/search", params={"q": "x" * 101}).status_code == 422
    assert client.get("/api/jobs/search", params={"q": "a", "location": "x" * 81}).status_code == 422
    assert client.get("/api/jobs/search", params={"q": "a", "page": 6}).status_code == 422
    assert client.get("/api/jobs/search", params={"q": "a", "remote": "mars"}).status_code == 422
    r = client.get("/api/jobs/search", params={"q": "data analyst", "location": "India", "remote": "any"})
    assert r.status_code == 200 and set(r.json()) == {"jobs", "sources", "query"}


def test_search_rate_limit(net, monkeypatch):
    monkeypatch.setattr(main, "JOBS_RATE_LIMIT", 2)
    codes = [client.get("/api/jobs/search", params={"q": "data"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_detail_endpoint(net, monkeypatch):
    assert client.get("/api/jobs/detail", params={"source": "linkedin", "id": "4446724293"}).status_code == 404  # not enabled
    monkeypatch.setenv("JIVIKA_JOB_SOURCES", "linkedin")
    r = client.get("/api/jobs/detail", params={"source": "linkedin", "id": "4446724293"})
    assert r.json() == {"description": "Write SQL.\n\n- Dashboards", "url": "https://www.linkedin.com/jobs/view/4446724293/"}
    assert client.get("/api/jobs/detail", params={"source": "linkedin", "id": "abc"}).status_code == 422
    assert client.get("/api/jobs/detail", params={"source": "remotive", "id": "1"}).status_code == 404
    net[1]["jobPosting"] = "Blocked or rate limited by the source."
    r = client.get("/api/jobs/detail", params={"source": "linkedin", "id": "4446724293"})
    assert r.status_code == 502 and r.json()["detail"] == "Blocked or rate limited by the source."


def test_fetch_refuses_redirects(monkeypatch):
    import http.server
    import threading

    class Redirect(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Redirect)
    threading.Thread(target=server.handle_request, daemon=True).start()
    monkeypatch.setattr(jobs, "fetch", REAL_FETCH)
    try:
        with pytest.raises(jobs.SourceError, match="HTTP 302"):
            jobs.fetch(f"http://127.0.0.1:{server.server_port}/")
    finally:
        server.server_close()


@pytest.mark.parametrize("have, wanted, ok", [
    ("Bangalore, India", "Bengaluru", True),
    ("Hybrid in Bangalore, India", "Bengaluru, India", True),
    ("Bengaluru", "Bengaluru, India", True),
    ("Gurgaon", "Gurugram", True),
    ("Berlin", "Bengaluru", False),
    ("Pune", "India", True),
])
def test_location_aliases(have, wanted, ok):
    assert jobs.location_ok({"location": have}, wanted) is ok


# --- India-focused public sources ----------------------------------------------


def test_himalayas_parser(net):
    [item] = jobs.himalayas("data analyst", "Bengaluru", "any", 2)  # the US-only role is filtered out
    url = net[0][-1][0]
    assert url.startswith("https://himalayas.app/jobs/api/search?") and "q=data+analyst" in url and "country=India" in url and "page=2" in url
    assert item["url"].endswith("utm_source=api") and item["remote"] is True and item["salary"] == "INR 600,000 - 1,200,000 annual"
    assert item["location"] == "India" and item["posted_at"].startswith("2026-")
    jobs.himalayas("x", "Berlin", "any", 1)
    assert "country=" not in net[0][-1][0]
    assert jobs.himalayas("x", "", "onsite", 1) == []


def test_jobicy_parser(net):
    [item] = jobs.jobicy("data analyst", "India", "remote", 1)  # APAC passes for India, Philippines-only does not
    assert item["id"] == "jobicy:1" and item["salary"] == "USD 100 - 200 yearly" and item["employment_type"] == "Full-Time"
    assert "tag=data+analyst" in net[0][-1][0]


def test_remoteok_parser_skips_legal_notice_and_caches(net):
    [item] = jobs.remoteok("data analyst", "India", "any", 1)
    assert item["url"] == "https://remoteOK.com/remote-jobs/77" and item["location"] == "Worldwide" and "salary" not in item
    jobs.remoteok("chef", "", "any", 1)
    assert sum("remoteok.com" in u for u, _ in net[0]) == 1
    assert by_source(jobs.search("data analyst", "", sources="remoteok"))["remoteok"]["name"] == "Remote OK"


def test_weworkremotely_rss(net):
    [item] = jobs.weworkremotely("data analyst", "Pune", "any", 1)
    assert item["company"] == "Databricks" and item["title"] == "Data Analyst" and item["remote"] is True
    assert item["id"] == "weworkremotely:databricks-data-analyst" and item["posted_at"] == "2026-10-14T07:31:00+00:00"
    net[1]["weworkremotely"] = "x"
    jobs._cache.clear()
    with pytest.raises(jobs.SourceError):
        jobs.weworkremotely("x", "", "any", 1)


def test_new_ats_types(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_ATS_BOARDS", "workable:apna,smartrecruiters:Swiggy,recruitee:channable,freshteam:ninjacart")
    items = {i["id"]: i for i in jobs.ats("data analyst", "India", "any", 1)}
    assert set(items) == {"ats:workable/apna/E47", "ats:smartrecruiters/Swiggy/600", "ats:recruitee/channable/9", "ats:freshteam/ninjacart/1"}
    wk, sr = items["ats:workable/apna/E47"], items["ats:smartrecruiters/Swiggy/600"]
    assert wk["remote"] is True and wk["location"] == "Mumbai, India" and wk["company"] == "Apna"
    assert sr["url"] == "https://jobs.smartrecruiters.com/Swiggy/600" and sr["company"] == "SWIGGY" and sr["remote"] is None
    assert items["ats:recruitee/channable/9"]["posted_at"] == "2026-10-22T12:11:23+00:00"
    assert items["ats:freshteam/ninjacart/1"]["location"] == "Chennai, India"
    urls = [u for u, _ in net[0]]
    assert "https://api.smartrecruiters.com/v1/companies/Swiggy/postings?country=in&limit=100" in urls
    assert "https://channable.recruitee.com/api/offers/" in urls


def test_subdomain_ats_slugs_are_strict(monkeypatch):
    monkeypatch.setenv("JIVIKA_ATS_BOARDS", "recruitee:evil.com#,freshteam:a.b,freshteam:-x,recruitee:ok-co,workable:a.b")
    assert jobs.ats_boards() == [("recruitee", "ok-co"), ("workable", "a.b")]


def test_dedupe_across_new_sources(net, monkeypatch):
    monkeypatch.setitem(ROUTES, "jobicy.com/api/v2", {"jobs": [{**JOBICY["jobs"][0], "companyName": "PONTOON"}]})
    result = jobs.search("data analyst", "India", sources="himalayas,jobicy")
    assert sum(j["company"].lower() == "pontoon" for j in result["jobs"]) == 1


@pytest.mark.parametrize("have, remote, wanted, ok", [
    ("Remote (India)", True, "Bengaluru", True),
    ("India", False, "Bengaluru", False),
    ("APAC", True, "Hyderabad", True),
    ("APAC", True, "Berlin", False),
    ("Anywhere in the World", True, "Bangalore", True),
    ("Philippines", True, "India", False),
])
def test_india_location_filter(have, remote, wanted, ok):
    assert jobs.location_ok({"location": have, "remote": remote}, wanted) is ok

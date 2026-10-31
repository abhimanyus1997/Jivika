import json
import socket

import pytest
from fastapi.testclient import TestClient

import main
from jivika import importer, jobs

client = TestClient(main.app)
PUBLIC = "93.184.215.14"


class FakeResponse:
    def __init__(self, status=200, body=b"", headers=None):
        self.status, self._body, self.original = status, body, body
        self.headers = {"Content-Type": "text/html; charset=utf-8", **(headers or {})}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read(self, n=-1):
        chunk, self._body = (self._body, b"") if n < 0 else (self._body[:n], self._body[n:])
        return chunk

    read1 = read

    def close(self):
        pass


@pytest.fixture
def web(monkeypatch):
    """A fake internet: DNS answers and responses by URL. Records every request made."""
    dns = {"jobs.example.com": [PUBLIC], "careers.example.org": [PUBLIC]}
    pages, seen = {}, []

    def resolve(host, port):
        if host not in dns:
            raise socket.gaierror("not found")
        return dns[host]

    def request(parts, port, addresses, timeout):
        url = f"{parts.scheme}://{parts.hostname}{parts.path or '/'}" + (f"?{parts.query}" if parts.query else "")
        seen.append((url, tuple(addresses)))
        page = pages.get(url)
        return FakeResponse(page.status, page.original, page.headers) if page else FakeResponse(404)  # fresh body each time

    monkeypatch.setattr(importer, "resolve", resolve)
    monkeypatch.setattr(importer, "_request", request)
    return dns, pages, seen


# --- SSRF protection ---------------------------------------------------------


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "240.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1",
    "::ffff:8.8.8.8", "64:ff9b::a00:1", "2002:a00:1::", "ff02::1", "198.18.0.1", "192.0.2.1", "not-an-ip",
])
def test_non_public_addresses_are_rejected(address):
    assert importer.is_public(address) is False


@pytest.mark.parametrize("address", ["8.8.8.8", PUBLIC, "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(address):
    assert importer.is_public(address) is True


@pytest.mark.parametrize("url", [
    "ftp://jobs.example.com/x", "file:///etc/passwd", "javascript:alert(1)", "jobs.example.com/x",
    "https://user:pass@jobs.example.com/x", "https://jobs.example.com:8443/x", "http://jobs.example.com:22/",
    "https://[::1]/x", "http://127.0.0.1/", "http://2130706433/", "https://unknown.invalid/",
])
def test_unsafe_urls_are_rejected_before_any_request(web, url):
    dns, pages, seen = web
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch(url)
    assert e.value.status == 422 and seen == []


def test_every_resolved_address_must_be_public(web):
    dns, pages, seen = web
    dns["mixed.example.com"] = [PUBLIC, "10.0.0.5"]
    with pytest.raises(importer.ImportFailed):
        importer.safe_fetch("https://mixed.example.com/job")
    assert seen == []


def test_redirects_are_revalidated_each_hop(web):
    dns, pages, seen = web
    dns["internal.example.com"] = ["192.168.0.10"]
    pages["https://jobs.example.com/a"] = FakeResponse(302, headers={"Location": "http://internal.example.com/admin"})
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/a")
    assert e.value.status == 422 and [u for u, _ in seen] == ["https://jobs.example.com/a"]


def test_redirect_to_metadata_ip_literal_is_blocked(web):
    dns, pages, seen = web
    pages["https://jobs.example.com/a"] = FakeResponse(301, headers={"Location": "http://169.254.169.254/latest/meta-data/"})
    with pytest.raises(importer.ImportFailed):
        importer.safe_fetch("https://jobs.example.com/a")
    assert len(seen) == 1


def test_at_most_three_redirects(web):
    dns, pages, seen = web
    for i in range(5):
        pages[f"https://jobs.example.com/{i}"] = FakeResponse(302, headers={"Location": f"/{i + 1}"})
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/0")
    assert "too many" in str(e.value) and len(seen) == 4


def test_relative_redirect_is_followed_and_connection_uses_vetted_address(web):
    dns, pages, seen = web
    pages["https://jobs.example.com/old"] = FakeResponse(308, headers={"Location": "/new?x=1"})
    pages["https://jobs.example.com/new?x=1"] = FakeResponse(200, b"<p>ok</p>")
    url, mime, text = importer.safe_fetch("https://jobs.example.com/old")
    assert url == "https://jobs.example.com/new?x=1" and mime == "text/html" and "ok" in text
    assert all(addresses == (PUBLIC,) for _, addresses in seen)


@pytest.mark.parametrize("ctype", ["image/png", "application/pdf", "text/plain", ""])
def test_only_page_content_types(web, ctype):
    dns, pages, seen = web
    pages["https://jobs.example.com/f"] = FakeResponse(200, b"data", {"Content-Type": ctype})
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/f")
    assert e.value.status == 415


def test_size_cap(web, monkeypatch):
    dns, pages, seen = web
    monkeypatch.setattr(importer, "MAX_BYTES", 1000)
    pages["https://jobs.example.com/big"] = FakeResponse(200, b"x" * 70_000)
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/big")
    assert e.value.status == 413


@pytest.mark.parametrize("status", [403, 406, 429])
def test_blocked_sources_say_so(web, status):
    dns, pages, seen = web
    pages["https://jobs.example.com/b"] = FakeResponse(status)
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/b")
    assert str(e.value) == importer.BLOCKED


class FakeSocket:
    def settimeout(self, value):
        pass


def test_pinned_connection_connects_to_the_vetted_ip_not_the_hostname(monkeypatch):
    opened = []
    monkeypatch.setattr(socket, "create_connection", lambda addr, timeout=None: opened.append(addr) or FakeSocket())
    conn = importer._PinnedHTTP("jobs.example.com", 80, ["2606:4700::1", PUBLIC], 5)
    conn.connect()
    assert opened == [(PUBLIC, 80)] and conn.host == "jobs.example.com"  # IPv4 tried first


def test_pinned_https_verifies_the_hostname(monkeypatch):
    wrapped = []

    class Context:
        def wrap_socket(self, sock, server_hostname):
            wrapped.append(server_hostname)
            return sock

    monkeypatch.setattr(socket, "create_connection", lambda addr, timeout=None: FakeSocket())
    monkeypatch.setattr(importer.ssl, "create_default_context", lambda: Context())
    importer._PinnedHTTPS("jobs.example.com", 443, [PUBLIC], 5).connect()
    assert wrapped == ["jobs.example.com"]


# --- parsing -------------------------------------------------------------------

JSONLD_PAGE = """<html><head><title>Ignored</title>
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "Organization", "name": "Acme"},
  {"@type": ["JobPosting"], "title": "Data Analyst", "hiringOrganization": {"@type": "Organization", "name": "Acme Corp"},
   "jobLocation": [{"@type": "Place", "address": {"addressLocality": "Bengaluru", "addressRegion": "KA", "addressCountry": {"name": "IN"}}}],
   "employmentType": ["FULL_TIME"], "datePosted": "2026-10-20",
   "experienceRequirements": {"@type": "OccupationalExperienceRequirements", "monthsOfExperience": 30},
   "baseSalary": {"@type": "MonetaryAmount", "currency": "INR", "value": {"@type": "QuantitativeValue", "minValue": 1200000, "maxValue": 1800000, "unitText": "YEAR"}},
   "description": "&lt;p&gt;Own &lt;b&gt;dashboards&lt;/b&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;/ul&gt;"}
]}</script></head><body>nav</body></html>"""

TEXT_PAGE = """<html><head><title>Backend Engineer | Careers</title><meta property="og:site_name" content="Globex">
<style>.x{}</style></head><body><nav>Home About Careers</nav><header>Menu</header>
<main><h1>Backend Engineer</h1><p>Build Python services. 3+ years required.</p><p>""" + "Details. " * 40 + """</p></main>
<footer>Copyright</footer><script>track()</script></body></html>"""


def test_jsonld_job_posting_with_graph_and_html_description():
    job = importer.parse_jsonld(JSONLD_PAGE, "https://jobs.example.com/1")
    assert job["title"] == "Data Analyst" and job["company"] == "Acme Corp"
    assert job["location"] == "Bengaluru, KA, IN" and job["employment_type"] == "Full time"
    assert job["experience_required"] == "2 years 6 months"
    assert job["salary"] == "INR 1,200,000 - 1,800,000 per year"
    assert job["description"] == "Own dashboards\n\n- SQL" and job["posted_at"].startswith("2026-10-20")
    assert job["source"] == "jsonld"


def test_jsonld_list_and_remote():
    page = '<script type="application/ld+json">[{"@type": "WebPage"}, {"@type": "JobPosting", "title": "SRE", ' \
           '"jobLocationType": "TELECOMMUTE", "hiringOrganization": "Initech", "description": "Keep it up"}]</script>'
    job = importer.parse_jsonld(page, "u")
    assert job["title"] == "SRE" and job["company"] == "Initech" and job["location"] == "Remote"


def test_readable_text_drops_navigation_and_scripts():
    job = importer.parse_text(TEXT_PAGE, "https://careers.example.org/be")
    assert job["title"] == "Backend Engineer | Careers" and job["company"] == "Globex"
    assert job["description"].startswith("Backend Engineer\n\nBuild Python services.")
    for noise in ("Home About", "Menu", "Copyright", "track()", ".x{}"):
        assert noise not in job["description"]


@pytest.mark.parametrize("url, expected", [
    ("https://www.linkedin.com/jobs/view/4446724293/", "4446724293"),
    ("https://in.linkedin.com/jobs/view/senior-data-analyst-at-exl-4446724293?trk=x", "4446724293"),
    ("https://www.linkedin.com/jobs/search/?currentJobId=4446724293&keywords=data", "4446724293"),
    ("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=123456789", "123456789"),
    ("https://www.linkedin.com/in/someone/", None),
    ("https://linkedin.com.evil.com/jobs/view/4446724293/", None),
])
def test_linkedin_ids(url, expected):
    assert importer.linkedin_id(importer.urllib.parse.urlsplit(url)) == expected


def test_naukri_ids():
    split = importer.urllib.parse.urlsplit
    assert importer.naukri_id(split("https://www.naukri.com/job-listings-data-analyst-acme-bengaluru-3-to-5-years-301025500123")) == "301025500123"
    assert importer.naukri_id(split("https://www.naukri.com/data-analyst-jobs")) is None


# --- endpoint ------------------------------------------------------------------

LINKEDIN_GUEST = """
<h2 class="top-card-layout__title topcard__title">Senior Data Analyst</h2>
<a class="topcard__org-name-link topcard__flavor--black-link" href="#">EXL</a>
<span class="topcard__flavor topcard__flavor--bullet">Bengaluru, Karnataka, India</span>
<div class="show-more-less-html__markup"><p>Analyse <b>data</b></p></div>
<h3 class="description__job-criteria-subheader">
  Employment type
</h3>
<span class="description__job-criteria-text description__job-criteria-text--criteria">
  Full-time
</span>
"""


def test_import_linkedin_uses_the_guest_endpoint(monkeypatch, web):
    urls = []
    monkeypatch.setattr(jobs, "fetch", lambda url, *a, **k: urls.append(url) or LINKEDIN_GUEST.encode())
    r = client.post("/api/jobs/import", json={"url": "https://in.linkedin.com/jobs/view/senior-data-analyst-at-exl-4446724293"})
    body = r.json()
    assert r.status_code == 200 and urls == ["https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4446724293"]
    assert body["title"] == "Senior Data Analyst" and body["company"] == "EXL" and body["employment_type"] == "Full-time"
    assert body["location"] == "Bengaluru, Karnataka, India" and body["description"] == "Analyse data"
    assert body["source"] == "linkedin" and body["url"] == "https://www.linkedin.com/jobs/view/4446724293/"
    assert web[2] == []  # never fetched the user's URL itself


def test_import_naukri_blocked(monkeypatch, web):
    def blocked(*args, **kwargs):
        raise jobs.SourceError("Blocked or rate limited by the source.")

    monkeypatch.setattr(jobs, "fetch", blocked)
    dns, pages, seen = web
    dns["www.naukri.com"] = [PUBLIC]
    url = "https://www.naukri.com/job-listings-data-analyst-acme-bengaluru-3-to-5-years-301025500123"
    pages[url] = FakeResponse(403)
    r = client.post("/api/jobs/import", json={"url": url})
    assert r.status_code == 502 and r.json()["detail"] == "Blocked by the source. Paste the job description instead."


def test_import_naukri_json(monkeypatch, web):
    detail = {"jobDetails": {"title": "Data Analyst", "companyDetail": {"name": "Acme"}, "locations": [{"label": "Pune"}],
                             "minimumExperience": 3, "maximumExperience": 5, "salaryDetail": {"label": "Not disclosed"},
                             "description": "<p>SQL and Python</p>", "employmentType": "Full Time, Permanent"}}
    monkeypatch.setattr(jobs, "fetch", lambda url, *a, **k: json.dumps(detail).encode())
    r = client.post("/api/jobs/import", json={"url": "https://www.naukri.com/job-listings-data-analyst-acme-pune-3-to-5-years-301025500123"})
    body = r.json()
    assert body["source"] == "naukri" and body["experience_required"] == "3-5 years" and body["salary"] == ""
    assert body["company"] == "Acme" and body["description"] == "SQL and Python"


def test_import_jsonld_page(web):
    dns, pages, seen = web
    pages["https://jobs.example.com/1"] = FakeResponse(200, JSONLD_PAGE.encode())
    r = client.post("/api/jobs/import", json={"url": "https://jobs.example.com/1"})
    assert r.status_code == 200 and r.json()["source"] == "jsonld" and r.json()["company"] == "Acme Corp"


def test_import_text_page_without_llm_returns_raw_text(web):
    dns, pages, seen = web
    pages["https://careers.example.org/be"] = FakeResponse(200, TEXT_PAGE.encode())
    r = client.post("/api/jobs/import", json={"url": "https://careers.example.org/be"})
    body = r.json()
    assert r.status_code == 200 and body["source"] == "text" and body["title"] == "Backend Engineer | Careers"
    assert "Build Python services" in body["description"] and body["experience_required"] == ""


def test_import_text_page_is_structured_by_the_model(web, monkeypatch):
    dns, pages, seen = web
    pages["https://careers.example.org/be"] = FakeResponse(200, TEXT_PAGE.encode())
    calls = []

    def fake(provider, key, model, system, user, schema_model):
        calls.append(user)
        return schema_model.model_validate({"title": "Backend Engineer", "company": "Globex", "experience_required": "3+ years"})

    monkeypatch.setattr(main, "complete_json", fake)
    r = client.post("/api/jobs/import", json={"url": "https://careers.example.org/be"}, headers={"X-LLM-Provider": "groq", "X-LLM-Key": "k"})
    body = r.json()
    assert body["title"] == "Backend Engineer" and body["experience_required"] == "3+ years" and body["source"] == "text"
    assert "Build Python services" in calls[0]


def test_import_model_failure_still_returns_text(web, monkeypatch):
    dns, pages, seen = web
    pages["https://careers.example.org/be"] = FakeResponse(200, TEXT_PAGE.encode())

    def broken(*args):
        raise main.HTTPException(502, "The model provider returned an error.")

    monkeypatch.setattr(main, "complete_json", broken)
    r = client.post("/api/jobs/import", json={"url": "https://careers.example.org/be"}, headers={"X-LLM-Provider": "groq", "X-LLM-Key": "k"})
    assert r.status_code == 200 and "Build Python services" in r.json()["description"]


def test_import_private_target_is_422(web):
    dns, pages, seen = web
    dns["intranet.example.com"] = ["10.0.0.8"]
    r = client.post("/api/jobs/import", json={"url": "http://intranet.example.com/"})
    assert r.status_code == 422 and seen == []


def test_import_can_be_disabled(monkeypatch, web):
    monkeypatch.setenv("JIVIKA_URL_IMPORT", "0")
    assert client.post("/api/jobs/import", json={"url": "https://jobs.example.com/1"}).status_code == 404


def test_import_rate_limit(web):
    dns, pages, seen = web
    pages["https://jobs.example.com/1"] = FakeResponse(200, JSONLD_PAGE.encode())
    codes = [client.post("/api/jobs/import", json={"url": "https://jobs.example.com/1"}).status_code for _ in range(21)]
    assert codes[:20] == [200] * 20 and codes[20] == 429


def test_import_description_is_capped(web):
    dns, pages, seen = web
    pages["https://jobs.example.com/long"] = FakeResponse(200, ("<main><p>" + "word " * 9000 + "</p></main>").encode())
    body = client.post("/api/jobs/import", json={"url": "https://jobs.example.com/long"}).json()
    assert len(body["description"]) <= importer.MAX_DESCRIPTION


def test_jsonld_literal_backslash_n_is_cleaned():
    page = '<script type="application/ld+json">{"@type": "JobPosting", "title": "AP Manager", "description": "\\\\n<p>Hello</p>\\\\n<p>World</p>"}</script>'  # JSON text \\n
    assert importer.parse_jsonld(page, "u")["description"] == "Hello\n\nWorld"


def test_expired_posting_redirect_to_board_is_404(web):
    dns, pages, seen = web
    dns["job-boards.greenhouse.io"] = [PUBLIC]
    pages["https://job-boards.greenhouse.io/gitlab/jobs/8000000002"] = FakeResponse(302, headers={"Location": "/gitlab?error=true"})
    pages["https://job-boards.greenhouse.io/gitlab?error=true"] = FakeResponse(200, b"<main>Current openings at GitLab. 238 jobs</main>")
    r = client.post("/api/jobs/import", json={"url": "https://job-boards.greenhouse.io/gitlab/jobs/8000000002"})
    assert r.status_code == 404 and "no longer available" in r.json()["detail"]
    assert importer._expired("https://x.io/jobs/12345", "https://x.io/careers") is True
    assert importer._expired("https://x.io/jobs/12345", "https://x.io/en/jobs/12345") is False


def test_unclosed_jsonld_scripts_stay_fast():
    import time

    start = time.monotonic()
    assert importer.parse_jsonld("<script type=application/ld+json>x" * 90_000, "https://x.io") is None
    assert time.monotonic() - start < 2

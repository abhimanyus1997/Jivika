"""Verified learning resources: sources, allow-list, verification, ranking, caching and the endpoint (network faked)."""

import json
import time
import urllib.parse

import pytest
from fastapi.testclient import TestClient

import main
from jivika import importer, jobs, resources
from jivika.schemas import CareerPath, MatchResult, SkillToBuild, TransitionStep

from test_import import PUBLIC, FakeResponse, web  # noqa: F401  (web is a fixture)

client = TestClient(main.app)
HEADERS = {"X-LLM-Provider": "groq", "X-LLM-Key": "user-key"}


def yt_page(*renderers) -> bytes:
    data = {"contents": {"twoColumnSearchResultsRenderer": {"primaryContents": {"sectionListRenderer": {"contents": [
        {"itemSectionRenderer": {"contents": list(renderers)}}]}}}}}
    return f"<html><script>var ytInitialData = {json.dumps(data)};</script></html>".encode()


def video(vid, title, channel):
    return {"videoRenderer": {"videoId": vid, "title": {"runs": [{"text": title}]}, "ownerText": {"runs": [{"text": channel}]}}}


def ddg_page(*links) -> bytes:
    rows = "".join(
        f'<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg={urllib.parse.quote(u, safe="")}&amp;rut=x">{t}</a></div>'
        for u, t in links
    )
    return f'<html><body>{rows}<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></body></html>'.encode()


def bing_rss(*links) -> bytes:
    items = "".join(f"<item><title>{t}</title><link>{u}</link><description>d</description></item>" for u, t in links)
    return f'<?xml version="1.0"?><rss><channel>{items}</channel></rss>'.encode()


def reddit_json(*posts) -> bytes:
    return json.dumps({"data": {"children": [{"data": p} for p in posts]}}).encode()


@pytest.fixture
def net(monkeypatch, web):  # noqa: F811
    """Search endpoints by host (jobs.fetch) plus pages for the SSRF-safe verifier (the importer's fake web)."""
    dns, pages, seen = web
    routes, calls = {}, []

    def fetch(url, headers=None, cap=jobs.MAX_BYTES, data=None):
        parts = urllib.parse.urlsplit(url)
        calls.append((parts.hostname, parts.path, url, data))
        handler = routes.get((parts.hostname, parts.path))
        if handler is None:
            raise jobs.SourceError("Unavailable right now.")
        result = handler(url, data) if callable(handler) else handler
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(jobs, "fetch", fetch)

    def page(url, status=200, body=None, title="Page", headers=None):
        host = urllib.parse.urlsplit(url).hostname
        dns.setdefault(host, [PUBLIC])
        pages[url] = FakeResponse(status, body if body is not None else f"<html><head><title>{title}</title></head></html>".encode(), headers)

    return routes, calls, page, seen


def oembed_ok(title="Video", author="Channel"):
    def handler(url, data):
        target = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["url"][0]
        if "bad" in target:
            return jobs.SourceError("The source returned HTTP 404.")
        return json.dumps({"title": f"{title} {target[-3:]}", "author_name": author}).encode()
    return handler


def resolve(*items, n=3):
    return resources.resolve([{"key": k, "query": q, "kind": kind} for k, q, kind in items], n)


# --- parsers --------------------------------------------------------------------


def test_parse_youtube_videos_and_playlists():
    markup = yt_page(
        video("abcdefghijk", "SAS STAT basics", "SAS Users"),
        {"playlistRenderer": {"playlistId": "PL1234567890", "title": {"simpleText": "SAS course"}, "shortBylineText": {"runs": [{"text": "Stats Hub"}]}}},
        video("bad id!", "Broken", "X"),
    ).decode()
    found = resources.parse_youtube(markup)
    assert found == [
        {"title": "SAS STAT basics", "url": "https://www.youtube.com/watch?v=abcdefghijk", "author": "SAS Users"},
        {"title": "SAS course", "url": "https://www.youtube.com/playlist?list=PL1234567890", "author": "Stats Hub"},
    ]
    with pytest.raises(jobs.SourceError):
        resources.parse_youtube("<html>consent page</html>")


def test_parse_ddg_unwraps_redirects_and_skips_ads():
    markup = ddg_page(("https://www.udemy.com/course/spark-sql/", "Spark <b>SQL</b> &amp; PySpark")).decode()
    assert resources.parse_ddg(markup) == [{"title": "Spark SQL & PySpark", "url": "https://www.udemy.com/course/spark-sql/"}]
    with pytest.raises(jobs.SourceError):
        resources.parse_ddg('<div class="anomaly-modal">bots use DuckDuckGo too</div>')


def test_parse_bing_rss():
    xml = bing_rss(("https://dev.to/a/spark-sql-tips", "Spark SQL &amp; tips")).decode()
    assert resources.parse_bing(xml) == [{"title": "Spark SQL & tips", "url": "https://dev.to/a/spark-sql-tips"}]


# --- allow-list and URLs ----------------------------------------------------------


@pytest.mark.parametrize("url, kind, ok", [
    ("https://www.udemy.com/course/spark-sql/", "course", True),
    ("https://www.udemy.com/topic/spark/", "course", False),  # listing, not a course
    ("https://www.coursera.org/courses?query=spark", "course", False),  # search page
    ("https://www.coursera.org/learn/spark-sql", "course", True),
    ("https://www.kaggle.com/learn/intro-to-sql", "course", True),
    ("https://www.kaggle.com/competitions/titanic", "course", False),
    ("https://www.kaggle.com/competitions/titanic", "practice", True),
    ("https://quant.stackexchange.com/questions/123/model-risk", "discussion", True),
    ("https://quant.stackexchange.com/users/1/someone", "discussion", False),
    ("https://www.reddit.com/r/quant/comments/abc/model_risk/", "discussion", True),
    ("https://spark.apache.org/docs/latest/sql-ref.html", "docs", True),
    ("https://evil.example/course/x", "course", False),
    ("https://udemy.com.evil.example/course/x", "course", False),
    ("https://www.udemy.com:8443/course/x", "course", False),
    ("ftp://www.udemy.com/course/x", "course", False),
    ("https://medium.com/@jane/spark-window-functions-123", "article", True),
    ("https://www.youtube.com/watch?v=abcdefghijk", "course", False),
])
def test_allow_list(url, kind, ok):
    assert bool(resources.allowed(url, kind)) is ok


def test_clean_drops_tracking_and_dedupes():
    url, key = resources.clean("http://www.Udemy.com/course/spark/?utm_source=x&couponCode=A#reviews")
    assert url == "https://www.udemy.com/course/spark/?couponCode=A"
    assert key == resources.clean("https://udemy.com/course/spark?couponCode=A&ref=abc")[1]


def test_provider_names():
    assert resources.provider("https://towardsdatascience.com/x") == "Towards Data Science"
    assert resources.provider("https://spark.apache.org/docs/latest/") == "Official docs"
    assert resources.provider("https://quant.stackexchange.com/questions/1") == "Stack Exchange"


# --- model output: queries only, never URLs -----------------------------------------


def test_model_urls_are_discarded_from_queries():
    step = TransitionStep(step="Learn Spark", resource_queries=[
        {"query": "https://www.udemy.com/course/x Spark SQL course", "kind": "Course"},
        {"query": "www.youtube.com/watch?v=1", "kind": "video"},  # nothing left after stripping
        {"query": "Spark SQL window functions", "kind": "documentation"},
        {"query": "spark sql window functions", "kind": "docs"},  # duplicate
        {"query": "x" * 200, "kind": "podcast"},  # unknown kind
        "Spark tuning discussion", 42,
    ])
    assert [q.model_dump() for q in step.resource_queries] == [
        {"query": "Spark SQL course", "kind": "course"},
        {"query": "Spark SQL window functions", "kind": "docs"},
        {"query": "Spark tuning discussion", "kind": "article"},
    ]
    long = TransitionStep(step="x", resource_queries=[{"query": "word " * 40, "kind": "article"}]).resource_queries[0].query
    assert len(long) <= 80 and not long.endswith(" ")
    assert SkillToBuild(skill="SQL", resource="Course at https://udemy.com/x").resource == "Course at"
    assert TransitionStep(step="x").resource_queries == []


def test_match_and_career_path_carry_resource_queries(monkeypatch):
    def fake(provider, key, model, system, user, schema_model, **_):
        assert "never output URLs" in system
        if schema_model.__name__ == "MatchAnalysis":
            return schema_model.model_validate({"match_score": 50, "transition_plan": [
                {"step": "Learn SAS", "resource_queries": [{"query": "SAS STAT tutorial", "kind": "video"}]}]})
        return schema_model.model_validate({
            "current": {"title": "Analyst"}, "next": {"title": "Senior"}, "future": {"title": "Lead"}, "career_score": 60,
            "skills_to_build": [{"skill": "SQL", "resource_queries": [{"query": "SQL joins practice", "kind": "practice"}]}],
            "roadmap": {"stages": [{"name": "Core", "items": [{"skill": "Spark", "resource_queries": [
                {"query": "see https://x.com", "kind": "course"}, {"query": "Spark SQL course", "kind": "course"}]}]}]},
        })

    monkeypatch.setattr(main, "complete_json", fake)
    match = client.post("/api/match", headers=HEADERS, json={"resume": "cv", "job_description": "jd"}).json()
    assert match["transition_plan"][0]["resource_queries"] == [{"query": "SAS STAT tutorial", "kind": "video"}]
    path = client.post("/api/career/path", headers=HEADERS, json={"resume": "cv"}).json()
    assert path["skills_to_build"][0]["resource_queries"] == [{"query": "SQL joins practice", "kind": "practice"}]
    assert path["roadmap"]["stages"][0]["items"][0]["resource_queries"] == [
        {"query": "see", "kind": "course"}, {"query": "Spark SQL course", "kind": "course"}]
    assert "resource_queries" in json.dumps(MatchResult.model_json_schema()) and "resource_queries" in json.dumps(CareerPath.model_json_schema())


# --- resolve ---------------------------------------------------------------------


def test_courses_verified_blocked_and_dropped(net):
    routes, calls, page, seen = net
    routes[("html.duckduckgo.com", "/html/")] = ddg_page(
        ("https://www.udemy.com/course/spark-sql/", "Spark SQL on Udemy"),
        ("https://www.coursera.org/learn/spark-sql", "Spark SQL (search title)"),
        ("https://www.coursera.org/learn/spark-sql?utm_source=ddg", "duplicate"),
        ("https://www.edx.org/learn/gone", "Removed course"),
        ("https://evil.example/course/spark", "Not allow-listed"),
        ("https://www.coursera.org/courses?query=spark", "Search page"),
        ("https://www.freecodecamp.org/learn/redirected", "Redirects away"),
    )
    page("https://www.udemy.com/course/spark-sql/", status=403)  # Cloudflare
    page("https://www.coursera.org/learn/spark-sql", title="Spark SQL Fundamentals | Coursera")
    page("https://www.edx.org/learn/gone", status=404)
    page("https://www.freecodecamp.org/learn/redirected", status=302, headers={"Location": "https://login.example/"})
    page("https://roadmap.sh/sql", title="SQL Roadmap")

    out = resolve(("plan-0", "Spark SQL course", "course"), n=4)
    links = out["results"]["plan-0"]
    assert [(r["url"], r["verified"]) for r in links] == [
        ("https://www.coursera.org/learn/spark-sql", True),
        ("https://roadmap.sh/sql", True),
        ("https://www.udemy.com/course/spark-sql/", False),
    ]
    coursera, roadmap_sh, udemy = links
    assert coursera == {"title": "Spark SQL Fundamentals | Coursera", "url": "https://www.coursera.org/learn/spark-sql", "kind": "course",
                        "provider": "Coursera", "domain": "coursera.org", "author": None, "found_via": "DuckDuckGo", "verified": True,
                        "checked_at": coursera["checked_at"]}
    assert roadmap_sh["kind"] == "roadmap" and roadmap_sh["provider"] == "roadmap.sh" and roadmap_sh["found_via"] == "roadmap.sh"
    assert udemy["note"] == resources.UNVERIFIED_NOTE and udemy["title"] == "Spark SQL on Udemy" and "note" not in coursera
    assert time.strftime("%Y") in coursera["checked_at"] and len(coursera["checked_at"]) == 10
    # The site filter went into the query; evil.example was never fetched.
    form = urllib.parse.parse_qs(calls[0][3].decode())["q"][0]
    assert form.startswith("Spark SQL course (site:udemy.com OR site:coursera.org")
    assert not any("evil" in url for url, _ in seen)
    assert {s["id"]: s["ok"] for s in out["sources"]} == {"youtube": True, "ddg": True, "bing": True, "reddit": True, "roadmap": True}
    assert [s["research"] for s in out["sources"]] == [True, True, True, False, False]


def test_challenge_pages_and_soft_404s(net):
    routes, calls, page, seen = net
    routes[("html.duckduckgo.com", "/html/")] = ddg_page(
        ("https://www.datacamp.com/tutorial/window-functions", "Window functions"),
        ("https://dev.to/jane/window-functions", "Window functions on dev.to"),
        ("https://medium.com/@jane/window-functions", "Window functions on Medium"),
    )
    page("https://www.datacamp.com/tutorial/window-functions", title="Just a moment...")
    page("https://dev.to/jane/window-functions", title="404 Not Found")
    page("https://medium.com/@jane/window-functions", body=b"<html><title>  Window functions,\n explained </title></html>")
    links = resolve(("a", "window functions", "article"))["results"]["a"]
    assert [(r["provider"], r["verified"], r["title"]) for r in links] == [
        ("Medium", True, "Window functions, explained"), ("DataCamp", False, "Window functions")]


def test_videos_are_verified_with_oembed(net):
    routes, calls, page, seen = net
    routes[("www.youtube.com", "/results")] = yt_page(
        video("aaaaaaaaaaa", "Search title", "Search channel"), video("badbadbad00", "Gone", "X"), video("ccccccccccc", "Third", "Y"))
    routes[("www.youtube.com", "/oembed")] = oembed_ok(title="SAS STAT", author="SAS Users")
    out = resolve(("v", "SAS STAT tutorial video", "video"))
    links = out["results"]["v"]
    assert [r["url"] for r in links] == ["https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://www.youtube.com/watch?v=ccccccccccc"]
    assert links[0] | {"checked_at": ""} == {"title": "SAS STAT aaa", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "kind": "video",
                                             "provider": "YouTube", "domain": "youtube.com", "author": "SAS Users",
                                             "found_via": "YouTube search", "verified": True, "checked_at": ""}
    search = next(url for host, path, url, _ in calls if path == "/results")
    assert urllib.parse.parse_qs(urllib.parse.urlsplit(search).query)["search_query"] == ["SAS STAT tutorial"]  # 'video' dropped


def test_discussions_from_reddit_and_bing_fallback(net):
    routes, calls, page, seen = net
    routes[("www.reddit.com", "/search.json")] = reddit_json(
        {"title": "Model risk management career?", "permalink": "/r/FinancialCareers/comments/abc/model_risk/", "score": 40, "subreddit": "FinancialCareers"},
        {"title": "Model risk validation", "permalink": "/r/quant/comments/def/mrm/", "score": 3, "subreddit": "quant"},  # low score
        {"title": "Model risk NSFW", "permalink": "/r/x/comments/ghi/x/", "score": 99, "subreddit": "x", "over_18": True},
        {"title": "Cute cats", "permalink": "/r/aww/comments/jkl/cats/", "score": 999, "subreddit": "aww"},  # irrelevant
    )
    routes[("html.duckduckgo.com", "/html/")] = jobs.SourceError("Blocked or rate limited by the source.")
    routes[("www.bing.com", "/search")] = bing_rss(("https://quant.stackexchange.com/questions/42/what-is-model-risk", "What is model risk?"))
    page("https://quant.stackexchange.com/questions/42/what-is-model-risk", title="Stack Exchange")  # generic: search title wins
    out = resolve(("d", "model risk management discussion", "discussion"))
    links = out["results"]["d"]
    assert [(r["provider"], r["author"], r["found_via"]) for r in links] == [
        ("Reddit", "r/FinancialCareers", "Reddit search"), ("Stack Exchange", None, "Bing")]
    assert links[0]["url"] == "https://www.reddit.com/r/FinancialCareers/comments/abc/model_risk/" and links[0]["verified"]
    assert links[1]["title"] == "What is model risk?"
    sources = {s["id"]: s for s in out["sources"]}
    assert sources["ddg"] == {"id": "ddg", "name": "DuckDuckGo", "ok": False, "research": True, "error": "Blocked or rate limited by the source."}
    assert sources["bing"]["ok"] and sources["reddit"]["ok"]
    reddit_url = next(url for host, path, url, _ in calls if host == "www.reddit.com")
    assert "sort=relevance" in reddit_url and "t=all" in reddit_url and "limit=10" in reddit_url and "type=link" in reddit_url


def test_ddg_challenge_starts_a_cooldown(net):
    routes, calls, page, seen = net
    routes[("html.duckduckgo.com", "/html/")] = b'<div class="anomaly-modal"></div>'
    resolve(("a", "pandas groupby", "docs"))
    resources._cache.clear()
    resolve(("a", "numpy arrays", "docs"))
    assert sum(1 for host, *_ in calls if host == "html.duckduckgo.com") == 1


def test_all_sources_failing_returns_empty_lists_with_errors(net):
    out = resolve(("a", "SQL joins", "practice"), ("b", "SAS", "video"), ("c", "MRM", "discussion"))
    assert out["results"] == {"a": [], "b": [], "c": []}
    assert {s["id"] for s in out["sources"] if not s["ok"]} == {"youtube", "ddg", "bing", "reddit"}
    assert all(s["error"] for s in out["sources"] if not s["ok"])
    assert resources._cache == {}  # failures are not cached


def test_diversity_and_max_per_item(net):
    routes, calls, page, seen = net
    links = [(f"https://leetcode.com/problems/p{i}/", f"SQL joins {i}") for i in range(4)] + [
        ("https://leetcode.com/problems/two-sum/", "Two Sum"),  # not about the query: dropped before any check
        ("https://www.hackerrank.com/challenges/h1/problem", "Joins in SQL"), ("https://www.geeksforgeeks.org/sql-joins/", "GfG")]
    routes[("html.duckduckgo.com", "/html/")] = ddg_page(*links)
    for url, title in links:
        page(url, title=title)
    out = resolve(("a", "SQL joins practice", "practice"), n=3)
    assert [r["provider"] for r in out["results"]["a"]] == ["LeetCode", "HackerRank", "GeeksforGeeks"]
    assert not any("two-sum" in url for url, _ in seen)


def test_relevance_filter():
    hit = {"_source": "bing", "title": "Python end parameter in print()", "url": "https://www.geeksforgeeks.org/python/end-parameter/"}
    assert not resources.relevant(hit, "End-to-end model monitoring project guide")
    assert resources.relevant({**hit, "title": "Model monitoring in production"}, "End-to-end model monitoring project guide")
    assert resources.relevant({"_source": "youtube", "title": "x", "url": "u"}, "anything at all")


def test_results_are_cached_by_query_and_kind(net):
    routes, calls, page, seen = net
    routes[("www.youtube.com", "/results")] = yt_page(video("aaaaaaaaaaa", "A", "C"))
    routes[("www.youtube.com", "/oembed")] = oembed_ok()
    first = resolve(("x", "SAS STAT", "video"), ("y", "sas  stat", "video"))
    assert first["results"]["x"] == first["results"]["y"] and len(first["results"]["x"]) == 1
    count = len(calls)
    again = resolve(("z", "SAS stat", "video"))
    assert again["results"]["z"] == first["results"]["x"] and len(calls) == count
    assert len([c for c in calls if c[1] == "/results"]) == 1  # the duplicate key shared one search


def test_time_budget_returns_what_is_ready(net, monkeypatch):
    routes, calls, page, seen = net
    monkeypatch.setattr(resources, "BUDGET", 0.3)
    routes[("www.youtube.com", "/results")] = lambda url, data: (time.sleep(1.5), yt_page())[1]
    started = time.monotonic()
    out = resolve(("v", "slow", "video"))
    assert time.monotonic() - started < 1.2 and out["results"] == {"v": []}
    assert resources._cache == {}


def test_enabled_sources_env(net, monkeypatch):
    monkeypatch.setenv("JIVIKA_RESOURCE_SOURCES", "roadmap")
    routes, calls, page, seen = net
    page("https://roadmap.sh/python", title="Python Roadmap")
    out = resolve(("a", "Python course", "course"), ("b", "Python video", "video"))
    assert [s["id"] for s in out["sources"]] == ["roadmap"]
    assert [r["url"] for r in out["results"]["a"]] == ["https://roadmap.sh/python"] and out["results"]["b"] == []
    assert not any(host in ("www.youtube.com", "html.duckduckgo.com") for host, *_ in calls)


# --- endpoint ----------------------------------------------------------------------


def test_resolve_endpoint_validation_and_rate_limit(net):
    item = {"key": "plan-0", "query": "Spark", "kind": "course"}
    assert client.post("/api/resources/resolve", json={"items": [item] * 21}).status_code == 422
    assert client.post("/api/resources/resolve", json={"items": [item], "max_per_item": 5}).status_code == 422
    assert client.post("/api/resources/resolve", json={"items": [{**item, "key": "k" * 65}]}).status_code == 422
    assert client.post("/api/resources/resolve", json={"items": [{**item, "query": "q" * 81}]}).status_code == 422
    assert client.post("/api/resources/resolve", json={"items": [{**item, "kind": "podcast"}]}).status_code == 422
    main._resource_hits.clear()
    for _ in range(30):
        r = client.post("/api/resources/resolve", json={"items": [], "max_per_item": 2})
        assert r.status_code == 200 and r.json()["results"] == {}
    assert client.post("/api/resources/resolve", json={"items": []}).status_code == 429


def test_resolve_endpoint_shape(net):
    routes, calls, page, seen = net
    page("https://roadmap.sh/sql", title="SQL Roadmap")
    r = client.post("/api/resources/resolve", json={"items": [{"key": "skill-0", "query": "SQL", "kind": "docs"}]})
    body = r.json()
    assert r.status_code == 200 and set(body) == {"results", "sources"}
    assert body["results"]["skill-0"][0]["url"] == "https://roadmap.sh/sql"


def test_safe_fetch_truncates_for_link_checks(web):  # noqa: F811
    dns, pages, seen = web
    pages["https://jobs.example.com/big"] = FakeResponse(200, b"<title>Big</title>" + b"x" * 5000)
    url, mime, text = importer.safe_fetch("https://jobs.example.com/big", max_bytes=100, truncate=True)
    assert text.startswith("<title>Big</title>") and len(text) == 100
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/big", max_bytes=100)
    assert e.value.status == 413
    pages["https://jobs.example.com/blocked"] = FakeResponse(503)
    with pytest.raises(importer.ImportFailed) as e:
        importer.safe_fetch("https://jobs.example.com/blocked")
    assert e.value.upstream == 503


def test_ddg_lite_fallback(net):
    routes, calls, page, seen = net
    routes[("html.duckduckgo.com", "/html/")] = b'<div class="anomaly-modal"></div>'
    routes[("lite.duckduckgo.com", "/lite/")] = (
        b"<a rel=\"nofollow\" href=\"https://pandas.pydata.org/docs/user_guide/groupby.html\" class='result-link'>Group by: split-apply-combine</a>")
    page("https://pandas.pydata.org/docs/user_guide/groupby.html", title="Group by: split-apply-combine - pandas documentation")
    links = resolve(("a", "pandas groupby", "docs"))["results"]["a"]
    assert [(r["provider"], r["found_via"]) for r in links] == [("Official docs", "DuckDuckGo")]


# --- round 7: robustness and coverage -------------------------------------------------------


def test_bad_ports_and_urls_are_rejected_not_raised():
    assert resources.allowed("https://www.udemy.com:99999/course/x", "course") is None
    assert resources.allowed("https://www.udemy.com:abc/course/x", "course") is None
    assert resources.provider("https://[bad/x") == ""


def test_blocked_redirect_target_off_the_allow_list_is_dropped(net):
    routes, calls, page, seen = net
    routes[("html.duckduckgo.com", "/html/")] = ddg_page(("https://medium.com/@a/spark-tips", "Spark tips"))
    page("https://medium.com/@a/spark-tips", status=302, headers={"Location": "https://evil.example/spark"})
    page("https://evil.example/spark", status=403)
    assert resolve(("a", "spark tips", "article"))["results"]["a"] == []
    page("https://medium.com/@a/spark-tips", status=403)  # the allow-listed page itself refuses: kept, unverified
    resources._cache.clear()
    [link] = resolve(("a", "spark tips", "article"))["results"]["a"]
    assert link["verified"] is False


def test_ddg_waits_outside_the_lock_and_fails_fast_when_backed_up(net, monkeypatch):
    routes, calls, page, seen = net
    monkeypatch.setattr(resources, "DDG_INTERVAL", 5)
    routes[("html.duckduckgo.com", "/html/")] = lambda url, data: (resources._ddg_lock.locked() and pytest.fail("lock held"), ddg_page())[1]
    assert resources.ddg("a", "course") == []
    started = time.monotonic()
    with pytest.raises(jobs.SourceError):  # the next slot is 5 s away, over DDG_MAX_WAIT
        resources.ddg("b", "course")
    assert time.monotonic() - started < 0.5


def test_search_results_are_cached_per_source(net):
    routes, calls, page, seen = net
    routes[("www.youtube.com", "/results")] = yt_page(video("aaaaaaaaaaa", "A", "C"))
    routes[("www.youtube.com", "/oembed")] = oembed_ok()
    resolve(("x", "SAS STAT", "video"))
    resources._cache.clear()  # finished results gone, raw search results kept
    resolve(("x", "SAS STAT", "video"))
    assert len([c for c in calls if c[1] == "/results"]) == 1


def test_bing_tries_single_site_queries_and_docs_sites(net):
    routes, calls, page, seen = net
    queries = []

    def bing(url, data):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["q"][0]
        queries.append(q)
        if q.endswith("site:pandas.pydata.org"):
            return bing_rss(("https://pandas.pydata.org/docs/user_guide/groupby.html", "pandas groupby guide"))
        return bing_rss(("https://unrelated.example/pandas-groupby", "pandas groupby"))

    routes[("www.bing.com", "/search")] = bing
    found = resources.bing("pandas groupby", "docs")
    assert queries == ["pandas groupby official documentation", "pandas groupby site:pandas.pydata.org"]
    assert found[-1]["url"] == "https://pandas.pydata.org/docs/user_guide/groupby.html"
    queries.clear()
    resources.bing("spark course", "course")
    assert queries[1:] == ["spark course site:udemy.com", "spark course site:coursera.org"]


def test_reddit_falls_back_to_old_reddit(net):
    routes, calls, page, seen = net
    routes[("old.reddit.com", "/search.json")] = reddit_json(
        {"title": "Spark tuning tips", "permalink": "/r/dataengineering/comments/a1/spark/", "score": 50, "subreddit": "dataengineering"})
    [post] = resources.reddit("spark tuning", "discussion")
    assert post["url"] == "https://www.reddit.com/r/dataengineering/comments/a1/spark/"
    assert [c[0] for c in calls] == ["www.reddit.com", "old.reddit.com"]


def test_roadmap_stays_in_view_with_few_slots():
    links = [{"kind": "course", "url": f"u{i}"} for i in range(3)] + [{"kind": "roadmap", "url": "r"}]
    assert [r["url"] for r in resources._pick(links, 2)] == ["u0", "r"]
    assert [r["url"] for r in resources._pick(links[:2], 2)] == ["u0", "u1"]


def test_busy_when_too_many_resolves_run(net, monkeypatch):
    monkeypatch.setattr(resources, "BUSY_WAIT", 0.05)
    held = [resources._slots.acquire() for _ in range(resources.MAX_CONCURRENT)]
    try:
        out = resolve(("a", "SQL", "docs"))
    finally:
        for _ in held:
            resources._slots.release()
    assert out["busy"] is True and out["results"] == {"a": []}

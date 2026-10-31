"""Verified learning resources for search phrases (no LLM, no API keys).

The model only describes what to search for (resource_queries); every link here comes from a keyless public
source and is checked before it is shown:

* youtube: the public results page (ytInitialData), each video or playlist confirmed through oEmbed.
* ddg: DuckDuckGo's HTML endpoint with per-kind site filters; bing (RSS) is the fallback when it fails or is empty.
* reddit: the public search.json; posts are taken from Reddit itself, so they count as verified.
* roadmap: allow-listed roadmap.sh guides (jivika.schemas.ROADMAP_SH).

Search results must be on the per-kind domain allow-list (ALLOW) and are then fetched through the SSRF-safe
importer.safe_fetch (public IPs, ports 80/443, re-validated redirects, 6 s, 1 MB, HTML only). Sites that refuse
automated checks (401/403/429/503, e.g. Cloudflare in front of Udemy or Coursera) are kept as unverified when the
link has a plausible course or article path; any other failure drops the link. Search endpoints are fixed hosts
fetched with jobs.fetch (no redirects); tests replace both fetchers.
"""

import html
import json
import logging
import os
import re
import threading
import time
import urllib.parse
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor, as_completed, wait
from concurrent.futures import TimeoutError as FuturesTimeout
from datetime import datetime, timezone

from jivika import importer, jobs
from jivika.ats import tokens
from jivika.schemas import RESOURCE_KINDS as KINDS, ROADMAP_SH, skill_roadmap, strip_urls

log = logging.getLogger("jivika.resources")

DEFAULT_SOURCES = "youtube,ddg,bing,reddit,roadmap"
SOURCES = {  # id: (name, research)
    "youtube": ("YouTube", True),
    "ddg": ("DuckDuckGo", True),
    "bing": ("Bing", True),
    "reddit": ("Reddit", False),
    "roadmap": ("roadmap.sh", False),
}
FOUND_VIA = {"youtube": "YouTube search", "ddg": "DuckDuckGo", "bing": "Bing", "reddit": "Reddit search", "roadmap": "roadmap.sh"}
WORKERS = 16  # network calls in flight across all requests (one shared pool)
MAX_CONCURRENT, BUSY_WAIT = 4, 1.0  # uncached resolves at once; later ones wait this long, then get busy: true
POOL = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="resources")
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)
BUDGET = 20.0  # seconds per request; whatever is ready by then is returned
VERIFY_TIMEOUT, VERIFY_BYTES = 6, 1024 * 1024
CANDIDATES = 6  # links checked per item
MAX_KEEP = 4  # resources cached per (query, kind); requests take the first max_per_item
CACHE_TTL, CACHE_MAX = 24 * 3600, 500
UNVERIFIED_NOTE = "Link from search results; the site blocks automated checks"
REDDIT_UA = "Jivika/1.0 (learning resource finder; +https://jivika.abhimanyu.fyi)"

OFFICIAL_DOCS = (
    "docs.python.org", "developer.mozilla.org", "spark.apache.org", "docs.databricks.com", "learn.microsoft.com",
    "docs.aws.amazon.com", "cloud.google.com", "postgresql.org", "dev.mysql.com", "sqlite.org", "pandas.pydata.org",
    "numpy.org", "scipy.org", "scikit-learn.org", "statsmodels.org", "pytorch.org", "tensorflow.org", "keras.io",
    "huggingface.co", "react.dev", "nodejs.org", "typescriptlang.org", "go.dev", "docs.oracle.com", "kubernetes.io",
    "docs.docker.com", "git-scm.com", "docs.github.com", "airflow.apache.org", "kafka.apache.org", "docs.snowflake.com",
    "docs.getdbt.com", "fastapi.tiangolo.com", "docs.djangoproject.com", "documentation.sas.com", "support.sas.com",
    "r-project.org", "help.tableau.com", "terraform.io", "developer.hashicorp.com", "docs.mongodb.com", "mongodb.com/docs",
)
# Domains (optionally with a path prefix) whose links are kept for each kind; anything else is dropped.
ALLOW = {
    "course": ("udemy.com", "coursera.org", "edx.org", "freecodecamp.org", "kaggle.com/learn", "khanacademy.org",
               "datacamp.com", "ocw.mit.edu", "learn.microsoft.com/en-us/training", "sas.com/en_us/training"),
    "video": ("youtube.com",),
    "discussion": ("reddit.com", "stackoverflow.com", "stackexchange.com", "news.ycombinator.com", "communities.sas.com"),
    "article": ("medium.com", "towardsdatascience.com", "dev.to", "analyticsvidhya.com", "freecodecamp.org/news",
                "kdnuggets.com", "realpython.com", "datacamp.com/tutorial", "geeksforgeeks.org", "machinelearningmastery.com",
                "martinfowler.com", "baeldung.com", "databricks.com/blog", "sas.com/en_us/insights", "blogs.sas.com"),
    "docs": OFFICIAL_DOCS + ("roadmap.sh",),
    "practice": ("leetcode.com", "hackerrank.com", "geeksforgeeks.org", "kaggle.com", "exercism.org", "codewars.com",
                 "stratascratch.com", "datalemur.com", "sqlbolt.com", "sqlzoo.net"),
}
# site: filters added to web searches (short, so the query stays readable); docs search for "documentation" instead.
SITE_FILTERS = {
    "course": ("udemy.com", "coursera.org", "edx.org", "freecodecamp.org", "kaggle.com/learn"),
    "discussion": ("stackoverflow.com", "stackexchange.com", "reddit.com"),
    "article": ("medium.com", "towardsdatascience.com", "dev.to", "analyticsvidhya.com", "freecodecamp.org/news"),
    "practice": ("leetcode.com", "hackerrank.com", "geeksforgeeks.org"),
}
PROVIDERS = {
    "youtube.com": "YouTube", "udemy.com": "Udemy", "coursera.org": "Coursera", "edx.org": "edX",
    "freecodecamp.org": "freeCodeCamp", "kaggle.com": "Kaggle", "khanacademy.org": "Khan Academy", "datacamp.com": "DataCamp",
    "ocw.mit.edu": "MIT OpenCourseWare", "reddit.com": "Reddit", "stackoverflow.com": "Stack Overflow",
    "stackexchange.com": "Stack Exchange", "news.ycombinator.com": "Hacker News", "communities.sas.com": "SAS Communities",
    "medium.com": "Medium", "towardsdatascience.com": "Towards Data Science", "dev.to": "dev.to",
    "analyticsvidhya.com": "Analytics Vidhya", "kdnuggets.com": "KDnuggets", "realpython.com": "Real Python",
    "geeksforgeeks.org": "GeeksforGeeks", "machinelearningmastery.com": "Machine Learning Mastery",
    "martinfowler.com": "Martin Fowler", "baeldung.com": "Baeldung", "roadmap.sh": "roadmap.sh", "leetcode.com": "LeetCode",
    "hackerrank.com": "HackerRank", "exercism.org": "Exercism", "codewars.com": "Codewars", "stratascratch.com": "StrataScratch",
    "datalemur.com": "DataLemur", "sqlbolt.com": "SQLBolt", "sqlzoo.net": "SQLZoo", "databricks.com": "Databricks",
    "sas.com": "SAS", "blogs.sas.com": "SAS Blogs",
}
# Content pages (not search, listing or profile pages) on sites that have both; other paths there are dropped.
CONTENT_PATHS = {
    "udemy.com": r"/course/[\w-]+", "coursera.org": r"/(learn|specializations|professional-certificates|projects|articles)/[\w-]+",
    "edx.org": r"/(learn|course|certificates|professional-certificate)/[\w-]+", "datacamp.com": r"/(courses|tutorial|tracks)/[\w-]+",
    "medium.com": r"/[@\w.-]+/[\w-]+", "stackoverflow.com": r"/questions/\d+", "stackexchange.com": r"/questions/\d+",
    "reddit.com": r"/r/\w+/comments/\w+", "news.ycombinator.com": r"/item", "leetcode.com": r"/(problems|explore|studyplan|discuss)/",
    "hackerrank.com": r"/(challenges|domains|interview|skills-verification)/",
}
BLOCKED_STATUS = (401, 403, 429, 503, 999)
_BAD_TITLE = re.compile(r"\b(404|not found|page unavailable|error)\b", re.I)
_CHALLENGE = re.compile(r"just a moment|attention required|access denied|are you a robot|captcha|verify you are human", re.I)
_TRACKING = re.compile(r"^(utm_\w+|ref|ref_|fbclid|gclid|si|feature|source|trk)$", re.I)
_SEARCH_NOISE = re.compile(r"\b(video|videos|youtube|discussion|discussions|reddit|thread|forum)\b", re.I)


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def enabled_sources() -> list[str]:
    wanted = {s.strip().lower() for s in os.getenv("JIVIKA_RESOURCE_SOURCES", DEFAULT_SOURCES).split(",")}
    return [s for s in SOURCES if s in wanted]


# ---------------------------------------------------------------------------
# URLs and the allow-list
# ---------------------------------------------------------------------------


def _bare(host: str) -> str:
    host = (host or "").lower().rstrip(".")
    for prefix in ("www.", "m.", "old."):
        host = host.removeprefix(prefix)
    return host


def _on(host: str, path: str, entry: str) -> bool:
    domain, _, prefix = entry.partition("/")
    return (host == domain or host.endswith("." + domain)) and (not prefix or path.lower().startswith("/" + prefix))


def allowed(url: str, kind: str) -> str | None:
    """The matching allow-list entry's domain for a https/http URL, else None."""
    try:
        parts = urllib.parse.urlsplit(url)
        port = parts.port  # ValueError for out-of-range or non-numeric ports
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or port not in (None, 80, 443):
        return None
    host = _bare(parts.hostname)
    pattern = next((p for d, p in CONTENT_PATHS.items() if host == d or host.endswith("." + d)), None)
    if pattern and not re.match(pattern, parts.path):
        return None
    return next((e.split("/")[0] for e in ALLOW.get(kind, ()) if _on(host, parts.path, e)), None)


def provider(url: str) -> str:
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return ""
    host = _bare(parts.hostname or "")
    if any(_on(host, parts.path, d) for d in OFFICIAL_DOCS):
        return "Official docs"
    return next((name for d, name in sorted(PROVIDERS.items(), key=lambda kv: -len(kv[0])) if host == d or host.endswith("." + d)), host)


def clean(url: str) -> tuple[str, str]:
    """(https URL without tracking parameters or fragment, canonical key for dedupe). ValueError for malformed URLs."""
    parts = urllib.parse.urlsplit(url.strip())
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=False) if not _TRACKING.match(k)]
    host = (parts.hostname or "").lower()
    path = parts.path or "/"
    out = urllib.parse.urlunsplit(("https", host, path, urllib.parse.urlencode(query), ""))
    key = urllib.parse.urlunsplit(("https", _bare(host), path.rstrip("/") or "/", urllib.parse.urlencode(sorted(query)), ""))
    return out, key


def _title(markup: str) -> str:
    found = re.search(r"<title[^>]*>(.*?)</title>", markup[:300_000], re.I | re.S)
    return " ".join(html.unescape(found.group(1)).split())[:200] if found else ""


def _sane(title: str) -> bool:
    return 4 <= len(title) <= 160 and not _BAD_TITLE.search(title) and not _CHALLENGE.search(title)


def _plausible(url: str) -> bool:
    """A specific page (allowed() already enforced CONTENT_PATHS), not a site's home page."""
    return bool(urllib.parse.urlsplit(url).path.strip("/"))


# ---------------------------------------------------------------------------
# Sources: each returns candidate dicts {title, url, kind, author?, found_via, _check}
# ---------------------------------------------------------------------------


def _text(value) -> str:
    if isinstance(value, dict):
        if "simpleText" in value:
            return str(value["simpleText"])
        return "".join(str(r.get("text", "")) for r in value.get("runs", []) if isinstance(r, dict))
    return ""


def _renderers(node, out: list, depth: int = 0):
    if depth > 40 or len(out) >= 20:
        return
    if isinstance(node, dict):
        for key in ("videoRenderer", "playlistRenderer"):
            if isinstance(node.get(key), dict):
                out.append((key, node[key]))
        for key, value in node.items():
            if key not in ("videoRenderer", "playlistRenderer"):
                _renderers(value, out, depth + 1)
    elif isinstance(node, list):
        for value in node:
            _renderers(value, out, depth + 1)


def parse_youtube(markup: str) -> list[dict]:
    start = markup.find("ytInitialData")
    start = markup.find("{", start) if start >= 0 else -1
    if start < 0:
        raise jobs.SourceError("The source returned an unexpected page.")
    try:
        data, _ = json.JSONDecoder().raw_decode(markup, start)
    except ValueError:
        raise jobs.SourceError("The source returned an unexpected page.") from None
    found: list = []
    _renderers(data, found)
    out = []
    for key, r in found:
        if key == "videoRenderer" and re.fullmatch(r"[\w-]{11}", str(r.get("videoId", ""))):
            url = f"https://www.youtube.com/watch?v={r['videoId']}"
            author = _text(r.get("ownerText")) or _text(r.get("longBylineText"))
        elif key == "playlistRenderer" and re.fullmatch(r"[\w-]{10,64}", str(r.get("playlistId", ""))):
            url = f"https://www.youtube.com/playlist?list={r['playlistId']}"
            author = _text(r.get("shortBylineText")) or _text(r.get("longBylineText"))
        else:
            continue
        out.append({"title": _text(r.get("title")), "url": url, "author": author or None})
    return out


def youtube(query: str, kind: str) -> list[dict]:
    q = " ".join(_SEARCH_NOISE.sub(" ", query).split()) or query
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": q, "hl": "en"})
    markup = jobs.fetch(url, {"Accept": "text/html", "Accept-Language": "en"}, cap=4 * 1024 * 1024).decode("utf-8", "replace")
    return [{**c, "kind": "video", "_source": "youtube"} for c in parse_youtube(markup)]


def _web_query(query: str, kind: str) -> str:
    if kind == "docs":
        return f"{query} official documentation"
    sites = SITE_FILTERS.get(kind)
    return f"{query} ({' OR '.join('site:' + s for s in sites)})" if sites else query


# Result links on the html (class="result__a") and lite (class='result-link') endpoints.
_DDG_A = re.compile(r"<a\b[^>]*\bclass=[\"'][^\"']*\b(?:result__a|result-link)\b[^\"']*[\"'][^>]*>(.*?)</a>", re.I | re.S)
_HREF = re.compile(r"\bhref=\"([^\"]+)\"", re.I)


def _unwrap(href: str) -> str:
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    parts = urllib.parse.urlsplit(href)
    if (parts.hostname or "").endswith("duckduckgo.com"):
        if parts.path.startswith("/l/"):
            return (urllib.parse.parse_qs(parts.query).get("uddg") or [""])[0]
        return ""  # ads (/y.js) and internal links
    return href


def parse_ddg(markup: str) -> list[dict]:
    if "anomaly-modal" in markup or "bots use DuckDuckGo too" in markup:
        raise jobs.SourceError("Blocked or rate limited by the source.")
    out = []
    for match in _DDG_A.finditer(markup):
        href = _HREF.search(match.group(0))
        url = _unwrap(href.group(1)) if href else ""
        title = " ".join(html.unescape(re.sub(r"<[^>]+>", "", match.group(1))).split())
        if url:
            out.append({"title": title, "url": url})
    return out


DDG_ENDPOINTS = ("https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/")
DDG_INTERVAL, DDG_COOLDOWN = 1.5, 20  # DuckDuckGo answers a few quick queries per IP, then shows a challenge
DDG_MAX_WAIT = 2.0  # a query that would wait longer for its slot fails fast, so the chain moves on to Bing
DDG_RATE_LIMITED = "Rate limited by the source. Try again shortly."
_ddg_lock = threading.Lock()
_ddg_state = {"next": 0.0, "cool_until": 0.0, **{url: 0.0 for url in DDG_ENDPOINTS}}


def _ddg_slot(endpoint: str) -> float | None:
    """Reserve the next request slot (DDG_INTERVAL apart, process-wide); seconds to wait, None if the endpoint is
    cooling down. The lock covers only this bookkeeping, never the network call or the wait."""
    with _ddg_lock:
        now = time.monotonic()
        if now < _ddg_state["cool_until"] or now < _ddg_state[endpoint]:
            return None
        slot = max(now, _ddg_state["next"])
        if slot - now > DDG_MAX_WAIT:
            raise jobs.SourceError(DDG_RATE_LIMITED)
        _ddg_state["next"] = slot + DDG_INTERVAL
        return slot - now


def ddg(query: str, kind: str) -> list[dict]:
    """Queries are spaced DDG_INTERVAL apart. An endpoint that shows a challenge page is skipped for DDG_COOLDOWN
    seconds and the other one (html, then lite) is tried."""
    # ponytail: per-process throttle; instances behind one IP do not share it
    form = urllib.parse.urlencode({"q": _web_query(query, kind), "kl": "wt-wt"}).encode()
    headers = {"Accept": "text/html", "Accept-Language": "en", "Content-Type": "application/x-www-form-urlencoded"}
    errors = []
    for endpoint in DDG_ENDPOINTS:
        if (pause := _ddg_slot(endpoint)) is None:
            continue
        time.sleep(pause)
        try:
            found = parse_ddg(jobs.fetch(endpoint, headers, data=form).decode("utf-8", "replace"))
        except jobs.SourceError as exc:
            errors.append(exc)
            if "Blocked" in str(exc):
                with _ddg_lock:
                    _ddg_state[endpoint] = time.monotonic() + DDG_COOLDOWN
            continue
        return [{**c, "kind": kind, "_source": "ddg"} for c in found]
    raise errors[0] if errors else jobs.SourceError(DDG_RATE_LIMITED)


def parse_bing(xml: str) -> list[dict]:
    out = []
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S)[:20]:
        title, link = re.search(r"<title>(.*?)</title>", item, re.S), re.search(r"<link>(.*?)</link>", item, re.S)
        if link:
            out.append({"title": " ".join(html.unescape(title.group(1) if title else "").split()), "url": html.unescape(link.group(1).strip())})
    return out


def _bing(q: str) -> list[dict]:
    url = "https://www.bing.com/search?" + urllib.parse.urlencode({"format": "rss", "q": q, "setlang": "en"})
    return parse_bing(jobs.fetch(url, {"Accept": "application/rss+xml, text/xml"}).decode("utf-8", "replace"))


# Parts of official-docs domains too generic to tie a query to a site.
_DOC_NOISE = {"docs", "doc", "com", "org", "io", "dev", "net", "www", "learn", "cloud", "developer", "help", "support",
              "documentation", "apache", "aws", "amazon", "google", "microsoft", "github", "oracle", "mozilla"}


def _site_filters(query: str, kind: str) -> tuple[str, ...]:
    """Single-site Bing queries to try when the combined query finds nothing on the allow-list. Docs use the official
    docs sites named in the query (pandas -> pandas.pydata.org)."""
    if kind != "docs":
        return SITE_FILTERS.get(kind, ())[:2]
    words = tokens(query)
    return tuple(d for d in OFFICIAL_DOCS if set(re.split(r"[./-]", d)) - _DOC_NOISE & words)[:2]


def bing(query: str, kind: str) -> list[dict]:
    """The combined site-filtered query, then up to two single-site queries if it found nothing usable."""
    found = _bing(_web_query(query, kind))
    allow_kind = "docs" if kind == "roadmap" else kind
    for site in _site_filters(query, kind):
        if any(allowed(c["url"], allow_kind) for c in found):
            break
        try:
            found += _bing(f"{query} site:{site}")
        except jobs.SourceError:
            break  # the first query already answered; keep what it found
    return [{**c, "kind": kind, "_source": "bing"} for c in found]


def reddit(query: str, kind: str) -> list[dict]:
    q = " ".join(_SEARCH_NOISE.sub(" ", query).split()) or query
    params = urllib.parse.urlencode({"q": q, "sort": "relevance", "t": "all", "limit": 10, "type": "link"})
    # www.reddit.com blocks some server IPs that old.reddit.com still answers.
    for host in ("www.reddit.com", "old.reddit.com"):
        try:
            data = jobs.fetch_json(f"https://{host}/search.json?{params}", {"User-Agent": REDDIT_UA, "Accept": "application/json"})
            break
        except jobs.SourceError as exc:
            failure = exc
    else:
        raise failure
    terms = tokens(q)
    out = []
    for child in (data.get("data", {}).get("children", []) if isinstance(data, dict) else []):
        post = child.get("data") if isinstance(child, dict) else None
        if not isinstance(post, dict) or post.get("over_18") or not isinstance(post.get("score"), int) or post["score"] < 5:
            continue
        permalink, sub, title = str(post.get("permalink") or ""), str(post.get("subreddit") or ""), str(post.get("title") or "")
        # Relevant: the title or subreddit shares a term with the query (search also matches comments and noise).
        if not permalink.startswith("/r/") or not (terms & (tokens(title) | tokens(sub.replace("_", " ")))):
            continue
        out.append({"title": " ".join(html.unescape(title).split()), "url": "https://www.reddit.com" + permalink,
                    "author": f"r/{sub}" if sub else None, "kind": "discussion", "_source": "reddit", "_verified": True})
    return out


def roadmap(query: str, kind: str) -> list[dict]:
    slug = skill_roadmap(query)
    if not slug:
        return []
    return [{"title": f"{ROADMAP_SH[slug]} roadmap", "url": f"https://roadmap.sh/{slug}", "kind": "roadmap", "_source": "roadmap"}]


SEARCH = {"youtube": youtube, "ddg": ddg, "bing": bing, "reddit": reddit, "roadmap": roadmap}


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def verify(candidate: dict) -> dict | None:
    """The finished Resource, or None when the link must be dropped."""
    kind = candidate["kind"]
    allow_kind = "docs" if kind == "roadmap" else kind
    if not allowed(candidate["url"], allow_kind):
        return None
    url, _ = clean(candidate["url"])
    base = {"title": candidate.get("title") or "", "url": url, "kind": kind, "author": candidate.get("author"),
            "found_via": FOUND_VIA[candidate["_source"]], "verified": True, "checked_at": _today()}
    if candidate.get("_verified"):
        return _finish(base)
    if candidate["_source"] == "youtube":
        try:
            data = jobs.fetch_json("https://www.youtube.com/oembed?" + urllib.parse.urlencode({"url": url, "format": "json"}))
        except jobs.SourceError:
            return None
        if not isinstance(data, dict) or not data.get("title"):
            return None
        return _finish({**base, "title": str(data["title"]), "author": str(data.get("author_name") or "") or base["author"]})
    try:
        final, _, markup = importer.safe_fetch(url, timeout=VERIFY_TIMEOUT, max_bytes=VERIFY_BYTES,
                                               content_types=("text/html", "application/xhtml+xml"), truncate=True)
    except importer.ImportFailed as exc:
        # Kept unverified only when the refusing address itself is on the allow-list, so an open redirect to
        # another site answering 403 is dropped rather than shown as a search result.
        if exc.upstream in BLOCKED_STATUS and _plausible(url) and allowed(exc.url or url, allow_kind):
            return _finish({**base, "verified": False, "note": UNVERIFIED_NOTE})
        return None
    if not allowed(final, allow_kind):  # redirected off the allow-list (or to a login page elsewhere)
        return None
    title = _title(markup)
    if _CHALLENGE.search(title):
        return _finish({**base, "verified": False, "note": UNVERIFIED_NOTE}) if _plausible(url) else None
    if _BAD_TITLE.search(title) and not _BAD_TITLE.search(base["title"]):
        return None  # a soft 404
    final_url, _ = clean(final)
    # Generic page titles ('Reddit', 'Home') lose to the search result's own title.
    generic = len(title.split()) <= 2 and len(base["title"].split()) > 2
    return _finish({**base, "url": final_url, "title": title if _sane(title) and not generic else base["title"]})


def _finish(resource: dict) -> dict | None:
    host = urllib.parse.urlsplit(resource["url"]).hostname or ""
    resource["title"] = " ".join(str(resource["title"]).split())[:200]
    if not resource["title"]:
        return None
    out = {"title": resource["title"], "url": resource["url"], "kind": resource["kind"], "provider": provider(resource["url"]),
           "domain": _bare(host), "author": resource.get("author") or None,
           "found_via": resource["found_via"], "verified": resource["verified"], "checked_at": resource["checked_at"]}
    if resource.get("note"):
        out["note"] = resource["note"]
    return out


def rank(resources: list[dict]) -> list[dict]:
    """Verified first; within each group, one per provider before repeats (diversity), keeping source order."""
    out, seen_urls = [], set()
    for group in ([r for r in resources if r["verified"]], [r for r in resources if not r["verified"]]):
        providers = {r["provider"] for r in out}
        fresh, repeats = [], []
        for r in group:
            if r["url"] in seen_urls:
                continue
            seen_urls.add(r["url"])
            (repeats if r["provider"] in providers else fresh).append(r)
            providers.add(r["provider"])
        out += fresh + repeats
    return out


# ---------------------------------------------------------------------------
# Resolve
# ---------------------------------------------------------------------------

_cache: OrderedDict = OrderedDict()  # (query, kind) -> finished resources
_search_cache: OrderedDict = OrderedDict()  # (source, query, kind) -> raw search results, so repeats skip the source
_cache_lock = threading.Lock()
SEARCH_CACHE_MAX = 2000


def _cache_get(key, cache: OrderedDict = _cache):
    with _cache_lock:
        hit = cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL:
            cache.move_to_end(key)
            return hit[1]
    return None


def _cache_put(key, value, cache: OrderedDict = _cache, limit: int = CACHE_MAX):
    with _cache_lock:
        cache[key] = (time.monotonic(), value)
        cache.move_to_end(key)
        while len(cache) > limit:
            cache.popitem(last=False)


class _Report:
    """Per-source outcome across the request: ok unless a call to it failed (error is the last failure)."""

    def __init__(self):
        self.lock, self.errors = threading.Lock(), {}

    def record(self, source: str, error: str):
        with self.lock:
            self.errors[source] = error

    def sources(self, enabled: list[str]) -> list[dict]:
        out = []
        for sid in enabled:
            name, research = SOURCES[sid]
            entry = {"id": sid, "name": name, "ok": sid not in self.errors, "research": research}
            if not entry["ok"]:
                entry["error"] = self.errors[sid]
            out.append(entry)
        return out


def _call(source: str, query: str, kind: str, report: _Report) -> list[dict] | None:
    """A source's results (cached CACHE_TTL per source, query and kind), or None when it failed."""
    key = (source, query.lower(), kind)
    if (hit := _cache_get(key, _search_cache)) is not None:
        return [dict(c) for c in hit]
    try:
        found = SEARCH[source](query, kind)
        _cache_put(key, found, _search_cache, SEARCH_CACHE_MAX)
    except jobs.SourceError as exc:
        report.record(source, str(exc))
        return None
    except Exception:
        log.exception("Resource source %s failed", source)
        report.record(source, "Unavailable right now.")
        return None
    return found


def _searches(kind: str, enabled: list[str]) -> list[list[str]]:
    """Source chains to run for a kind; each chain stops at its first source with results (ddg, then bing)."""
    web = [s for s in ("ddg", "bing") if s in enabled]
    chains = {"video": [["youtube"]], "discussion": [["reddit"], web]}.get(kind, [web, ["roadmap"]])
    return [[s for s in chain if s in enabled] for chain in chains if any(s in enabled for s in chain)]


# Words that describe the kind of resource rather than its topic; they do not count for relevance.
_GENERIC = {"course", "courses", "tutorial", "tutorials", "article", "articles", "guide", "video", "videos", "practice",
            "discussion", "discussions", "forum", "beginner", "beginners", "introduction", "intro", "overview", "project",
            "projects", "documentation", "docs", "exercise", "exercises", "labs", "lab", "learn", "learning", "basics",
            "online", "free", "best", "case", "study", "end"}


def relevant(candidate: dict, query: str) -> bool:
    """At least half of the query's topic words appear in the result's title or URL (search engines pad weak
    queries with unrelated pages). Sources with their own matching (YouTube, Reddit, roadmap.sh) are trusted."""
    if candidate["_source"] not in ("ddg", "bing"):
        return True
    topic = tokens(query) - _GENERIC
    if not topic:
        return True
    words = tokens(candidate.get("title") or "") | tokens(urllib.parse.unquote(candidate["url"]).replace("-", " ").replace("_", " "))
    return len(topic & words) * 2 >= len(topic)


def _chain(chain: list[str], query: str, kind: str, report: _Report) -> tuple[list[dict], bool]:
    """(candidates on the allow-list, whether a source answered rather than failed)."""
    answered = False
    allow_kind = "docs" if chain == ["roadmap"] else kind
    for source in chain:
        found = _call(source, query, kind, report)
        if found is None:
            continue
        answered = True
        found = [c for c in found if allowed(c["url"], allow_kind) and relevant(c, query)]
        if found:
            return found, True
    return [], answered


def _candidates(futures: list[Future]) -> tuple[list[dict], bool]:
    """Deduplicated candidates from an item's finished chains (source order, so ranking is stable), and whether
    every chain finished with a source answering."""
    candidates, seen, complete = [], set(), True
    for future in futures:
        if not future.done() or future.cancelled():
            complete = False
            continue
        try:
            found, ok = future.result()
        except Exception:
            log.exception("Resource search failed")
            found, ok = [], False
        complete &= ok
        for c in found:
            try:
                k = clean(c["url"])[1]
            except ValueError:
                continue
            if k not in seen:
                seen.add(k)
                candidates.append(c)
    return candidates, complete


def _check_result(future: Future) -> dict | None:
    if not future.done() or future.cancelled():
        return None
    try:
        return future.result()
    except Exception:
        log.exception("Resource check failed")
        return None


def _resolve_many(todo: list[tuple[str, str]], queries: dict, enabled: list[str], report: _Report, deadline: float, partial: dict):
    """Search every item's chains on the shared pool; as soon as an item's chains are done, check its candidates.
    Whatever is finished at the deadline is returned; queued work is cancelled. Complete items are cached."""
    chains = {ck: [POOL.submit(_chain, chain, queries[ck], ck[1], report) for chain in _searches(ck[1], enabled)] for ck in todo}
    owner = {f: ck for ck, futures in chains.items() for f in futures}
    left = {ck: len(futures) for ck, futures in chains.items()}
    checks: dict = {}
    complete: dict = {}

    def start(ck):
        candidates, complete[ck] = _candidates(chains[ck])
        checks[ck] = [POOL.submit(verify, c) for c in candidates[:CANDIDATES]]

    for ck in todo:
        if not left[ck]:
            start(ck)
    try:
        for future in as_completed(owner, timeout=max(0, deadline - time.monotonic())):
            ck = owner[future]
            left[ck] -= 1
            if not left[ck]:
                start(ck)
    except FuturesTimeout:
        pass
    pending = [f for futures in checks.values() for f in futures]
    wait(pending, timeout=max(0, deadline - time.monotonic()))
    for future in [*owner, *pending]:
        future.cancel()  # not started yet: dropped; running ones finish in the background, unreported
    for ck in todo:
        futures = checks.get(ck, [])
        final = rank([r for r in map(_check_result, futures) if r])[:MAX_KEEP]
        partial[ck] = final
        if ck in checks and complete[ck] and all(f.done() and not f.cancelled() for f in futures):
            _cache_put(ck, final)  # a failed or late source is retried on the next request


def _pick(resources: list[dict], n: int) -> list[dict]:
    """The first n, keeping a roadmap.sh guide in view when one was found."""
    out = [dict(r) for r in resources[:n]]
    roadmap_hit = next((r for r in resources if r["kind"] == "roadmap"), None)
    if roadmap_hit and n and not any(r["kind"] == "roadmap" for r in out):
        out = out[: n - 1] + [dict(roadmap_hit)]
    return out


def resolve(items: list[dict], max_per_item: int = 3) -> dict:
    """{results: {item key: [Resource]}, sources: [...], busy?: true} for items [{key, query, kind}]. busy means the
    server was already resolving MAX_CONCURRENT requests; cached items are still returned."""
    enabled = enabled_sources()
    report = _Report()
    deadline = time.monotonic() + BUDGET
    wanted, queries = {}, {}  # cache key (query lowercased, kind) -> item keys, and the query as first written
    for item in items:
        query = " ".join(strip_urls(item["query"]).split())[:80]
        ck = (query.lower(), item["kind"])
        wanted.setdefault(ck, []).append(item["key"])
        queries.setdefault(ck, query)
    partial: dict = {}
    todo = []
    for ck in wanted:
        if (hit := _cache_get(ck)) is not None:
            partial[ck] = hit
        elif ck[0]:
            todo.append(ck)
    busy = False
    if todo:
        if _slots.acquire(timeout=BUSY_WAIT):
            try:
                _resolve_many(todo, queries, enabled, report, deadline, partial)
            finally:
                _slots.release()
        else:
            busy = True
    results = {k: _pick(partial.get(ck, []), max_per_item) for ck, keys in wanted.items() for k in keys}
    out = {"results": results, "sources": report.sources(enabled)}
    if busy:
        out["busy"] = True
    return out

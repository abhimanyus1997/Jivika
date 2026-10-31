"""Live job search across public job boards and company career pages.

Every source is a fixed https URL template. User input only fills URL-encoded query
parameters (or a validated path segment), never the host, so requests cannot be steered
elsewhere. All network access goes through fetch(), which the tests replace.
"""

import email.utils
import http.client
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import datetime, timezone
from html.parser import HTMLParser

log = logging.getLogger("jivika.jobs")

TIMEOUT = 8
MAX_BYTES = 2 * 1024 * 1024
FEED_MAX_BYTES = 4 * 1024 * 1024  # the Arbeitnow feed alone is about 3 MB
PER_PAGE = 20  # page size for sources whose whole feed is filtered here
SEARCH_TTL, SEARCH_MAX = 600, 50  # an entry can hold ~1 MB of descriptions
BOARD_TTL, FEED_TTL = 1800, 900
USER_AGENT = "Mozilla/5.0 (compatible; Jivika/1.0; +https://abhimanyu.fyi/jivika)"

DEFAULT_SOURCES = "remotive,arbeitnow,adzuna,ats,himalayas,jobicy,remoteok,weworkremotely"
# Verified live (HTTP 200, India roles, response under the size cap) on 2026-10-31.
DEFAULT_ATS_BOARDS = (
    "greenhouse:groww,greenhouse:inmobi,greenhouse:hackerrank,greenhouse:druva,greenhouse:observeai,"
    "greenhouse:turing,greenhouse:newrelic,lever:cred,lever:meesho,lever:mindtickle,lever:fampay,lever:hevodata,"
    "lever:nium,lever:pocketfm,lever:zeta,ashby:sarvam,ashby:atlan,ashby:composio,workable:apna,"
    "smartrecruiters:Freshworks,smartrecruiters:ServiceNow,smartrecruiters:LinkedIn3,smartrecruiters:BoschGroup,"
    "smartrecruiters:Swiggy,smartrecruiters:Sutherland,smartrecruiters:Experian,smartrecruiters:NielsenIQ,"
    "smartrecruiters:Continental,smartrecruiters:Eurofins,smartrecruiters:Unacademy,freshteam:ninjacart,freshteam:zolve"
)
INDIA_CITIES = (
    "india", "bengaluru", "bangalore", "mumbai", "delhi", "gurgaon", "gurugram", "noida", "pune",
    "hyderabad", "chennai", "kolkata", "ahmedabad", "jaipur", "kochi", "chandigarh", "indore",
)
ANYWHERE = ("worldwide", "anywhere", "global")


class SourceError(Exception):
    """A source could not be used; the message is shown to users, so it never contains URLs or keys."""


# ---------------------------------------------------------------------------
# Network and text helpers
# ---------------------------------------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects could point a fixed URL at any host (SSRF), so a 3xx is reported as an HTTP error instead."""

    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def fetch(url: str, headers: dict | None = None, cap: int = MAX_BYTES, data: bytes | None = None) -> bytes:
    """GET (or POST when data is given) a fixed URL, without following redirects."""
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/html;q=0.9", **(headers or {})})
    deadline = time.monotonic() + TIMEOUT  # the socket timeout is per read; this bounds the whole download
    chunks, size = [], 0
    try:
        with _OPENER.open(req, timeout=TIMEOUT) as response:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > cap:
                    break
                if time.monotonic() > deadline:
                    raise SourceError("The source took too long to respond.")
                chunks.append(chunk)
        body = b"".join(chunks)
    except urllib.error.HTTPError as exc:
        blocked = exc.code in (403, 406, 429, 999)
        raise SourceError("Blocked or rate limited by the source." if blocked else f"The source returned HTTP {exc.code}.") from None
    except (OSError, http.client.HTTPException, ValueError):
        raise SourceError("Unavailable right now.") from None
    if size > cap:
        raise SourceError("The source response was too large.")
    return body


def fetch_json(url: str, headers: dict | None = None, cap: int = MAX_BYTES):
    try:
        return json.loads(fetch(url, headers, cap))
    except ValueError:
        raise SourceError("The source returned an invalid response.") from None


class _Text(HTMLParser):
    """Plain text from HTML: keeps line breaks for block tags, drops scripts. With only_class, reads just that element."""

    BLOCK = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article"}

    def __init__(self, only_class: str = ""):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip, self.only_class = [], 0, only_class
        self.inside_tag, self.depth = None, 0

    def handle_starttag(self, tag, attrs):
        if self.only_class and self.inside_tag is None:
            if self.only_class in (dict(attrs).get("class") or "").split():
                self.inside_tag, self.depth = tag, 1
            return
        if tag == self.inside_tag:
            self.depth += 1
        if tag in ("script", "style"):
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n- " if tag == "li" else "\n")

    def handle_endtag(self, tag):
        if self.only_class and tag == self.inside_tag:
            self.depth -= 1
            if self.depth == 0:
                self.inside_tag, self.only_class = None, "\0"  # done: ignore anything after
                return
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip and (not self.only_class or self.inside_tag):
            self.parts.append(data)


def html_text(value, only_class: str = "") -> str:
    if not value:
        return ""
    text = str(value)
    for _ in range(2):  # a second pass for entity-escaped HTML (Greenhouse, some Arbeitnow posts)
        parser = _Text(only_class)
        parser.feed(text)
        parser.close()
        text, only_class = "".join(parser.parts), ""
        if not re.search(r"</?[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?/?>", text):
            break
    lines = (re.sub(r"[ \t\r\f\v\xa0]+", " ", line).strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def iso(value) -> str | None:
    """Epoch seconds or milliseconds, or an ISO date/datetime, as a UTC ISO timestamp (sortable as text)."""
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool) or (isinstance(value, str) and value.isdigit()):
            number = float(value)
            moment = datetime.fromtimestamp(number / 1000 if number > 1e11 else number, timezone.utc)
        elif isinstance(value, str) and value.strip():
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        else:
            return None
    except (ValueError, OverflowError, OSError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def _clean(value, limit: int = 200) -> str:
    return clip(" ".join(str(value or "").split()), limit)


def humanize(value) -> str:
    """'full_time', 'FullTime' or 'full time' -> 'Full time'."""
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", str(value or "")).replace("_", " ").replace("-", " ")
    text = " ".join(text.split()).lower()
    return text[:1].upper() + text[1:]


def job(source, native_id, title, company, url, *, location="", remote=None, text="", employment_type="",
        salary="", posted_at=None, tags=""):
    """One normalized Job, or None when it lacks a title, an id or an https link."""
    url, title = str(url or "").strip(), _clean(title)
    if not title or not native_id or urllib.parse.urlsplit(url).scheme != "https":
        return None
    location = _clean(location)
    if remote is None and re.search(r"\bremote\b", f"{title} {location}", re.I):
        remote = True
    out = {
        "id": f"{source}:{native_id}",
        "source": source,
        "title": title,
        "company": _clean(company) or "Unknown company",
        "location": location,
        "remote": remote,
        "url": url,
        "snippet": clip(" ".join(text.split()), 400),
        "_tags": str(tags or "").lower(),  # used for filtering, removed before responding
    }
    if employment_type := _clean(employment_type, 60):
        out["employment_type"] = employment_type
    if salary := _clean(salary, 80):
        out["salary"] = salary
    if posted := iso(posted_at):
        out["posted_at"] = posted
    if text:
        out["description"] = clip(text, 6000)
    return out


def _terms(text: str) -> list[str]:
    return re.findall(r"[a-z0-9+#]+", text.lower())


CITY_ALIASES = {"bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai", "madras": "chennai", "new delhi": "delhi", "calcutta": "kolkata"}


def _aliased(text: str) -> str:
    for old, new in CITY_ALIASES.items():
        text = text.replace(old, new)
    return text


def location_ok(item: dict, location: str) -> bool:
    """Any comma-separated part of the wanted location matches ("Bengaluru, India" matches "Bangalore")."""
    parts = [_aliased(p.strip()) for p in location.lower().split(",") if p.strip()]
    if not parts:
        return True
    have = _aliased(item["location"].lower())
    if any(word in have for word in ANYWHERE):
        return True
    # India-wide remote roles ("Remote (India)", "APAC") are open to someone in any Indian city.
    if any(p in INDIA_CITIES for p in parts) and (re.search(r"\b(apac|asia)\b", have) or (item.get("remote") is True and "india" in have)):
        return True
    # ponytail: only India gets a city list (the default audience); add a country table if needed
    return any(part in have or (part == "india" and any(city in have for city in INDIA_CITIES)) for part in parts)


def matches(item: dict, q: str, location: str) -> bool:
    """For feeds filtered here: every query word in the title or tags, plus the location rule."""
    haystack = f"{item['title']} {item['_tags']}".lower()
    return all(term in haystack for term in _terms(q)) and location_ok(item, location)


def remote_ok(item: dict, remote: str) -> bool:
    return remote == "any" or (remote == "remote") == (item["remote"] is True)


_cache: dict = {}
_cache_lock = threading.Lock()


def cached(key: str, ttl: int, load):
    """Small TTL cache for feeds and boards. Failures are not cached."""
    with _cache_lock:
        hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
    return value


# ---------------------------------------------------------------------------
# Sources: each returns a list of jobs for (q, location, remote, page)
# ---------------------------------------------------------------------------


def remotive(q, location, remote, page):
    if remote == "onsite":
        return []
    data = fetch_json("https://remotive.com/api/remote-jobs?" + urllib.parse.urlencode({"search": q, "limit": 50}))
    items = (
        job("remotive", j.get("id"), j.get("title"), j.get("company_name"), j.get("url"),
            location=j.get("candidate_required_location") or "Worldwide", remote=True,
            text=html_text(j.get("description")), employment_type=humanize(j.get("job_type")),
            salary=j.get("salary"), posted_at=j.get("publication_date"),
            tags=" ".join(map(str, [j.get("category") or "", *(j.get("tags") or [])])))
        for j in (data.get("jobs") or [] if isinstance(data, dict) else [])
    )
    # The API's search is loose (it returned the same postings for unrelated queries), so filter here too.
    return [i for i in items if i and matches(i, q, location)]


def arbeitnow(q, location, remote, page):
    data = cached("arbeitnow", FEED_TTL, lambda: fetch_json("https://www.arbeitnow.com/api/job-board-api", cap=FEED_MAX_BYTES))
    items = (
        job("arbeitnow", j.get("slug"), j.get("title"), j.get("company_name"), j.get("url"),
            location=j.get("location"), remote=bool(j.get("remote")) if j.get("remote") is not None else None,
            text=html_text(j.get("description")), employment_type=", ".join(str(t) for t in (j.get("job_types") or [])[:2]),
            posted_at=j.get("created_at"), tags=" ".join(map(str, j.get("tags") or [])))
        for j in (data.get("data") or [] if isinstance(data, dict) else [])
    )
    return [i for i in items if i and matches(i, q, location)]


def _wants_india(location: str) -> bool:
    return any(_aliased(p.strip()) in INDIA_CITIES for p in location.lower().split(","))


def _pay(low, high, currency="", period="") -> str:
    try:
        low, high = float(low or 0), float(high or 0)
    except (TypeError, ValueError):
        return ""
    if not low and not high:
        return ""
    amount = f"{low:,.0f}" if not high or low == high else f"{low:,.0f} - {high:,.0f}"
    return " ".join(p for p in (str(currency or ""), amount, str(period or "")) if p)


def himalayas(q, location, remote, page):
    """Himalayas search API. Terms: every Apply link must be the supplied applicationLink (kept as url)."""
    if remote == "onsite":
        return []
    params = {"q": q, "page": page}
    if _wants_india(location):
        params["country"] = "India"  # also returns roles open worldwide
    data = fetch_json("https://himalayas.app/jobs/api/search?" + urllib.parse.urlencode(params))
    items = (
        job("himalayas", j.get("guid"), j.get("title"), j.get("companyName"), j.get("applicationLink"),
            location=", ".join(map(str, j.get("locationRestrictions") or [])) or "Worldwide", remote=True,
            text=html_text(j.get("description")), employment_type=j.get("employmentType"),
            salary=_pay(j.get("minSalary"), j.get("maxSalary"), j.get("currency"), j.get("salaryPeriod")),
            posted_at=j.get("pubDate"), tags=" ".join(map(str, [*(j.get("categories") or []), *(j.get("parentCategories") or [])])))
        for j in (data.get("jobs") or [] if isinstance(data, dict) else [])
    )
    return [i for i in items if i and location_ok(i, location)]


def jobicy(q, location, remote, page):
    """Jobicy API. Terms: credit Jobicy with a link and apply via the original job URL (kept as url)."""
    if remote == "onsite":
        return []
    # ponytail: Jobicy has no India geo slug, so location is filtered here (APAC/Anywhere pass for India)
    data = fetch_json("https://jobicy.com/api/v2/remote-jobs?" + urllib.parse.urlencode({"count": 50, "tag": q}))
    items = (
        job("jobicy", j.get("id"), html_text(j.get("jobTitle")), html_text(j.get("companyName")), j.get("url"),
            location=j.get("jobGeo") or "Anywhere", remote=True, text=html_text(j.get("jobDescription")),
            employment_type=", ".join(map(str, j.get("jobType") or [])),
            salary=_pay(j.get("salaryMin"), j.get("salaryMax"), j.get("salaryCurrency"), j.get("salaryPeriod")),
            posted_at=j.get("pubDate"), tags=" ".join(map(str, j.get("jobIndustry") or [])))
        for j in (data.get("jobs") or [] if isinstance(data, dict) else [])
    )
    return [i for i in items if i and location_ok(i, location)]


def remoteok(q, location, remote, page):
    """Remote OK feed. Terms: link back to the Remote OK listing (url) and name Remote OK as the source."""
    if remote == "onsite":
        return []
    data = cached("remoteok", FEED_TTL, lambda: fetch_json("https://remoteok.com/api", cap=FEED_MAX_BYTES))
    items = (
        job("remoteok", j.get("id"), j.get("position"), j.get("company"), j.get("url"),
            location=j.get("location") or "Worldwide", remote=True, text=html_text(j.get("description")),
            salary=_pay(j.get("salary_min"), j.get("salary_max"), "USD"), posted_at=j.get("date"),
            tags=" ".join(map(str, j.get("tags") or [])))
        for j in (data if isinstance(data, list) else []) if isinstance(j, dict) and j.get("id")  # item 0 is the legal notice
    )
    return [i for i in items if i and matches(i, q, location)]


def weworkremotely(q, location, remote, page):
    """We Work Remotely all-jobs RSS feed (every category in one feed)."""
    if remote == "onsite":
        return []

    def load():
        try:
            root = ET.fromstring(fetch("https://weworkremotely.com/remote-jobs.rss", cap=FEED_MAX_BYTES))
        except ET.ParseError:
            raise SourceError("The source returned an invalid response.") from None
        out = []
        for it in root.iter("item"):
            company, _, title = (it.findtext("title") or "").partition(": ")
            link = it.findtext("link") or ""
            out.append(job("weworkremotely", link.rstrip("/").rsplit("/", 1)[-1], title or company, company if title else "",
                           link, location=it.findtext("region") or "Anywhere", remote=True,
                           text=html_text(it.findtext("description")), posted_at=_rfc822(it.findtext("pubDate")),
                           tags=it.findtext("category")))
        return [i for i in out if i]

    return [i for i in cached("weworkremotely", FEED_TTL, load) if matches(i, q, location)]


def _rfc822(value):
    try:
        return email.utils.parsedate_to_datetime(value).isoformat()
    except (TypeError, ValueError):
        return None


ADZUNA_SYMBOLS = {"in": "₹", "gb": "£", "us": "$", "ca": "$", "au": "$", "sg": "$", "nz": "$", "de": "€", "fr": "€", "nl": "€", "it": "€", "es": "€", "at": "€", "be": "€"}


def adzuna_keys() -> tuple[str, str] | None:
    app_id, app_key = os.getenv("JIVIKA_ADZUNA_APP_ID", "").strip(), os.getenv("JIVIKA_ADZUNA_APP_KEY", "").strip()
    return (app_id, app_key) if app_id and app_key else None


def adzuna(q, location, remote, page):
    app_id, app_key = adzuna_keys() or ("", "")
    country = os.getenv("JIVIKA_ADZUNA_COUNTRY", "in").strip().lower()
    if not re.fullmatch(r"[a-z]{2}", country):
        raise SourceError("JIVIKA_ADZUNA_COUNTRY must be a two-letter country code.")
    params = {"app_id": app_id, "app_key": app_key, "what": q, "results_per_page": 30, "content-type": "application/json"}
    if location:
        params["where"] = location
    data = fetch_json(f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?" + urllib.parse.urlencode(params))
    symbol, out = ADZUNA_SYMBOLS.get(country, ""), []
    for j in data.get("results") or [] if isinstance(data, dict) else []:
        low, high = j.get("salary_min"), j.get("salary_max")
        salary = ""
        if isinstance(low, (int, float)) and isinstance(high, (int, float)) and str(j.get("salary_is_predicted")) != "1":
            salary = f"{symbol}{low:,.0f}" if low == high else f"{symbol}{low:,.0f} - {symbol}{high:,.0f}"
        item = job("adzuna", j.get("id"), html_text(j.get("title")), (j.get("company") or {}).get("display_name"),
                   j.get("redirect_url"), location=(j.get("location") or {}).get("display_name"),
                   text=html_text(j.get("description")), employment_type=humanize(j.get("contract_time")),
                   salary=salary, posted_at=j.get("created"))
        if item:
            out.append(item)
    return out


SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
ATS_URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true",
    "lever": "https://api.lever.co/v0/postings/{slug}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true",
    "workable": "https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true",
    # ponytail: India-only (country=in) keeps big global boards under the size cap; drop it to go global
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{slug}/postings?country=in&limit=100",
    "recruitee": "https://{slug}.recruitee.com/api/offers/",
    "freshteam": "https://{slug}.freshteam.com/hire/widgets/jobs.json",
}
SUBDOMAIN_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")  # slugs that become a host label


def ats_boards() -> list[tuple[str, str]]:
    raw = os.getenv("JIVIKA_ATS_BOARDS", "").strip() or DEFAULT_ATS_BOARDS
    boards = []
    for entry in raw.split(","):
        kind, _, slug = entry.strip().partition(":")
        kind, slug = kind.strip().lower(), slug.strip()
        label_ok = not ATS_URLS.get(kind, "").startswith("https://{slug}") or SUBDOMAIN_RE.fullmatch(slug)
        if kind in ATS_URLS and SLUG_RE.fullmatch(slug) and label_ok and (kind, slug) not in boards:
            boards.append((kind, slug))
        elif entry.strip():
            log.warning("Ignoring invalid JIVIKA_ATS_BOARDS entry %r", entry.strip()[:80])
    return boards


def _company(slug: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[-_.]+", slug) if part)


def greenhouse_jobs(slug, data):
    for j in data.get("jobs") or [] if isinstance(data, dict) else []:
        yield job("ats", f"greenhouse/{slug}/{j.get('id')}", j.get("title"), j.get("company_name") or _company(slug),
                  j.get("absolute_url"), location=(j.get("location") or {}).get("name"), text=html_text(j.get("content")),
                  posted_at=j.get("first_published") or j.get("updated_at"),
                  tags=" ".join(str(d.get("name", "")) for d in j.get("departments") or [] if isinstance(d, dict)))


def lever_jobs(slug, data):
    for j in data if isinstance(data, list) else []:
        cats = j.get("categories") or {}
        sections = [j.get("descriptionPlain") or ""]
        for block in j.get("lists") or []:
            sections.append(f"{block.get('text', '')}\n{html_text(block.get('content'))}")
        sections.append(j.get("additionalPlain") or "")
        pay, salary = j.get("salaryRange") or {}, ""
        if isinstance(pay.get("min"), (int, float)) and isinstance(pay.get("max"), (int, float)):
            salary = f"{pay.get('currency') or ''} {pay['min']:,.0f} - {pay['max']:,.0f} {humanize(pay.get('interval')).lower()}"
        workplace = str(j.get("workplaceType") or "").lower()
        yield job("ats", f"lever/{slug}/{j.get('id')}", j.get("text"), _company(slug), j.get("hostedUrl"),
                  location=cats.get("location") or ", ".join(map(str, cats.get("allLocations") or [])),
                  remote=True if workplace == "remote" else (False if workplace in ("onsite", "hybrid") else None),
                  text="\n\n".join(s.strip() for s in sections if s.strip()), employment_type=humanize(cats.get("commitment")),
                  salary=salary, posted_at=j.get("createdAt"), tags=f"{cats.get('team') or ''} {cats.get('department') or ''}")


def ashby_jobs(slug, data):
    for j in data.get("jobs") or [] if isinstance(data, dict) else []:
        if j.get("isListed") is False:
            continue
        places = [j.get("location") or ""] + [str(s.get("location", "")) for s in j.get("secondaryLocations") or [] if isinstance(s, dict)]
        yield job("ats", f"ashby/{slug}/{j.get('id')}", j.get("title"), _company(slug), j.get("jobUrl"),
                  location=", ".join(p for p in places if p), remote=j.get("isRemote") if isinstance(j.get("isRemote"), bool) else None,
                  text=j.get("descriptionPlain") or html_text(j.get("descriptionHtml")),
                  employment_type=humanize(j.get("employmentType")),
                  salary=((j.get("compensation") or {}).get("compensationTierSummary") or ""),
                  posted_at=j.get("publishedAt"), tags=f"{j.get('department') or ''} {j.get('team') or ''}")


def workable_jobs(slug, data):
    for j in data.get("jobs") or [] if isinstance(data, dict) else []:
        places = [", ".join(str(p) for p in (l.get("city"), l.get("region"), l.get("country")) if p)
                  for l in j.get("locations") or [] if isinstance(l, dict)]
        yield job("ats", f"workable/{slug}/{j.get('shortcode')}", j.get("title"), data.get("name") or _company(slug), j.get("url"),
                  location="; ".join(p for p in places if p) or j.get("country"),
                  remote=j.get("telecommuting") if isinstance(j.get("telecommuting"), bool) else None,
                  text=html_text(j.get("description")), employment_type=j.get("employment_type"),
                  posted_at=j.get("published_on"), tags=f"{j.get('department') or ''} {j.get('function') or ''}")


def smartrecruiters_jobs(slug, data):
    for j in data.get("content") or [] if isinstance(data, dict) else []:
        place = j.get("location") or {}
        yield job("ats", f"smartrecruiters/{slug}/{j.get('id')}", j.get("name"), (j.get("company") or {}).get("name") or _company(slug),
                  f"https://jobs.smartrecruiters.com/{urllib.parse.quote(slug, safe='')}/{urllib.parse.quote(str(j.get('id') or ''), safe='')}",
                  location=place.get("fullLocation") or place.get("city"),
                  remote=True if place.get("remote") is True else None,
                  employment_type=(j.get("typeOfEmployment") or {}).get("label"), posted_at=j.get("releasedDate"),
                  tags=f"{(j.get('function') or {}).get('label') or ''} {(j.get('department') or {}).get('label') or ''}")


def recruitee_jobs(slug, data):
    for j in data.get("offers") or [] if isinstance(data, dict) else []:
        yield job("ats", f"recruitee/{slug}/{j.get('id')}", j.get("title"), j.get("company_name") or _company(slug), j.get("careers_url"),
                  location=j.get("location"), remote=j.get("remote") if isinstance(j.get("remote"), bool) else None,
                  text=html_text(f"{j.get('description') or ''}{j.get('requirements') or ''}"),
                  employment_type=humanize(j.get("employment_type_code")),
                  posted_at=str(j.get("published_at") or "").replace(" UTC", "+00:00"), tags=j.get("department"))


def freshteam_jobs(slug, data):
    if not isinstance(data, dict):
        return
    branches = {b.get("id"): b.get("location") or b.get("city") for b in data.get("branches") or [] if isinstance(b, dict)}
    roles = {r.get("id"): r.get("name") for r in data.get("job_roles") or [] if isinstance(r, dict)}
    for j in data.get("jobs") or []:
        if j.get("deleted"):
            continue
        yield job("ats", f"freshteam/{slug}/{j.get('id')}", j.get("title"), _company(slug), j.get("url"),
                  location=branches.get(j.get("branch_id")) or "", remote=True if j.get("remote") is True else None,
                  text=html_text(j.get("description")), posted_at=j.get("created_at"), tags=roles.get(j.get("job_role_id")))


ATS_PARSERS = {"greenhouse": greenhouse_jobs, "lever": lever_jobs, "ashby": ashby_jobs, "workable": workable_jobs,
               "smartrecruiters": smartrecruiters_jobs, "recruitee": recruitee_jobs, "freshteam": freshteam_jobs}


def board(kind: str, slug: str) -> list[dict]:
    def load():
        data = fetch_json(ATS_URLS[kind].format(slug=urllib.parse.quote(slug, safe="")))
        return [i for i in ATS_PARSERS[kind](slug, data) if i]

    return cached(f"{kind}:{slug}", BOARD_TTL, load)


def ats(q, location, remote, page):
    boards = ats_boards()
    if not boards:
        return []
    results, failed = [], 0
    with ThreadPoolExecutor(max_workers=min(8, len(boards))) as pool:
        for outcome in pool.map(lambda b: _try(board, *b), boards):
            if outcome is None:
                failed += 1
            else:
                results.extend(outcome)
    if failed == len(boards):
        raise SourceError("Company career pages are unavailable right now.")
    return [i for i in results if matches(i, q, location)]


def _try(fn, *args):
    try:
        return fn(*args)
    except SourceError:
        return None
    except Exception:  # a malformed board must not sink the others
        log.exception("Board parse failed")
        return None


class _LinkedInCards(HTMLParser):
    FIELDS = {
        "base-search-card__title": "title",
        "base-search-card__subtitle": "company",
        "job-search-card__location": "location",
        "job-search-card__salary-info": "salary",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards, self.field, self.field_tag, self.depth, self.buf = [], None, None, 0, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        urn = a.get("data-entity-urn") or ""
        if urn.startswith("urn:li:jobPosting:"):
            self.cards.append({"id": urn.rsplit(":", 1)[1], **({"url": a["href"]} if tag == "a" and a.get("href") else {})})
        if not self.cards:
            return
        card, classes = self.cards[-1], (a.get("class") or "").split()
        if tag == "a" and "base-card__full-link" in classes and a.get("href"):
            card["url"] = a["href"]
        if tag == "time" and a.get("datetime"):
            card["posted"] = a["datetime"]
        if self.field:
            self.depth += tag == self.field_tag
            return
        if field := next((self.FIELDS[c] for c in classes if c in self.FIELDS), None):
            self.field, self.field_tag, self.depth, self.buf = field, tag, 1, []

    def handle_endtag(self, tag):
        if self.field and tag == self.field_tag:
            self.depth -= 1
            if self.depth == 0:
                self.cards[-1].setdefault(self.field, " ".join("".join(self.buf).split()))
                self.field = None

    def handle_data(self, data):
        if self.field:
            self.buf.append(data)


def parse_linkedin(markup: str) -> list[dict]:
    parser = _LinkedInCards()
    parser.feed(markup)
    parser.close()
    out = []
    for c in parser.cards:
        if not c["id"].isdigit():
            continue
        item = job("linkedin", c["id"], c.get("title"), c.get("company"), str(c.get("url") or "").split("?")[0],
                   location=c.get("location"), salary=c.get("salary"), posted_at=c.get("posted"))
        if item:
            out.append(item)
    return out


def linkedin(q, location, remote, page):
    params = {"keywords": q, "location": location, "start": (page - 1) * 25}
    if remote != "any":
        params["f_WT"] = 2 if remote == "remote" else 1  # LinkedIn's workplace filter: 1 on-site, 2 remote
    body = fetch("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?" + urllib.parse.urlencode(params))
    return parse_linkedin(body.decode("utf-8", "replace"))


def linkedin_detail(native_id: str) -> dict:
    if not re.fullmatch(r"\d{1,20}", native_id):
        raise ValueError("invalid id")
    body = fetch(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{native_id}").decode("utf-8", "replace")
    text = html_text(body, only_class="show-more-less-html__markup")
    if not text:
        raise SourceError("The job description could not be read.")
    return {"description": clip(text, 6000), "url": f"https://www.linkedin.com/jobs/view/{native_id}/"}


NAUKRI_HEADERS = {"appid": "109", "systemid": "Naukri", "Accept": "application/json", "Content-Type": "application/json"}


def naukri(q, location, remote, page):
    params = {"noOfResults": 20, "urlType": "search_by_keyword", "searchType": "adv", "keyword": q, "pageNo": page}
    if location:
        params["location"] = location
    if remote == "remote":
        params["wfhType"] = 2
    data = fetch_json("https://www.naukri.com/jobapi/v3/search?" + urllib.parse.urlencode(params), NAUKRI_HEADERS)
    if not isinstance(data, dict) or "jobDetails" not in data:
        raise SourceError("Unavailable (the source asked for a captcha)." if "captcha" in json.dumps(data).lower() else "The source returned an unexpected response.")
    out = []
    for j in data.get("jobDetails") or []:
        places = {p.get("type"): p.get("label") for p in j.get("placeholders") or [] if isinstance(p, dict)}
        url = urllib.parse.urljoin("https://www.naukri.com/", str(j.get("jdURL") or ""))
        host = urllib.parse.urlsplit(url).hostname or ""
        if host != "naukri.com" and not host.endswith(".naukri.com"):
            continue
        salary = places.get("salary") or ""
        item = job("naukri", j.get("jobId"), j.get("title"), j.get("companyName"), url, location=places.get("location"),
                   text=html_text(j.get("jobDescription")),
                   salary="" if salary.lower().startswith("not disclosed") else salary,
                   posted_at=j.get("createdDate"), tags=j.get("tagsAndSkills"))
        if item:
            out.append(item)
    return out


# id -> (name, function, research, paged by the source itself)
SOURCES = {
    "remotive": ("Remotive", remotive, False, False),
    "arbeitnow": ("Arbeitnow", arbeitnow, False, False),
    "adzuna": ("Adzuna", adzuna, False, True),
    "ats": ("Company career pages", ats, False, False),
    "himalayas": ("Himalayas", himalayas, False, True),
    "jobicy": ("Jobicy", jobicy, False, False),
    "remoteok": ("Remote OK", remoteok, False, False),
    "weworkremotely": ("We Work Remotely", weworkremotely, False, False),
    "linkedin": ("LinkedIn", linkedin, True, True),
    "naukri": ("Naukri", naukri, True, True),
}
DETAIL = {"linkedin": linkedin_detail}


def enabled_sources() -> list[str]:
    """JIVIKA_JOB_SOURCES in SOURCES order. Adzuna also needs its keys; research sources only when listed."""
    wanted = {s.strip().lower() for s in os.getenv("JIVIKA_JOB_SOURCES", DEFAULT_SOURCES).split(",")}
    return [s for s in SOURCES if s in wanted and (s != "adzuna" or adzuna_keys())]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

_searches: OrderedDict = OrderedDict()
_searches_lock = threading.Lock()


def _dedupe_key(item: dict) -> tuple[str, str]:
    norm = lambda s: " ".join(_terms(s))  # noqa: E731
    return norm(item["title"]), norm(item["company"])


def _run(source: str, q: str, location: str, remote: str, page: int):
    name, fn, _, paged = SOURCES[source]
    try:
        items = [i for i in fn(q, location, remote, page) if remote_ok(i, remote)]
    except SourceError as exc:
        return None, str(exc)
    except Exception:
        log.exception("Job source %s failed", source)
        return None, "Unavailable right now."
    return (items if paged else items[(page - 1) * PER_PAGE : page * PER_PAGE]), None


def search(q: str, location: str = "", remote: str = "any", sources: str = "", page: int = 1) -> dict:
    q, location = " ".join(q.split()), " ".join(location.split())
    enabled = enabled_sources()
    picked = {s.strip().lower() for s in sources.split(",") if s.strip()}
    requested = [s for s in enabled if s in picked] if picked else enabled
    key = (q.lower(), location.lower(), remote, tuple(requested), page)
    with _searches_lock:
        hit = _searches.get(key)
        if hit and time.monotonic() - hit[0] < SEARCH_TTL:
            _searches.move_to_end(key)
            return hit[1]

    pool = ThreadPoolExecutor(max_workers=max(1, len(requested)))
    futures = {s: pool.submit(_run, s, q, location, remote, page) for s in requested}
    outcomes, deadline = {}, time.monotonic() + TIMEOUT + 4
    for sid, future in futures.items():
        try:
            outcomes[sid] = future.result(timeout=max(0, deadline - time.monotonic()))
        except FutureTimeout:
            outcomes[sid] = (None, "The source took too long to respond.")
    pool.shutdown(wait=False, cancel_futures=True)  # a slow source finishes in the background, unreported

    jobs, seen, report = [], set(), []
    for sid, (name, _, research, _) in SOURCES.items():
        entry = {"id": sid, "name": name, "enabled": sid in enabled, "ok": False, "count": 0, "research": research}
        if sid in outcomes:
            items, error = outcomes[sid]
            if error:
                entry["error"] = error
            else:
                entry["ok"], entry["count"] = True, len(items)
                for item in items:
                    if (dk := _dedupe_key(item)) not in seen:
                        seen.add(dk)
                        jobs.append({k: v for k, v in item.items() if not k.startswith("_")})
        report.append(entry)
    jobs.sort(key=lambda j: j.get("posted_at") or "", reverse=True)  # all UTC ISO, so text order is time order
    result = {"jobs": jobs, "sources": report, "query": q}

    with _searches_lock:
        _searches[key] = (time.monotonic(), result)
        while len(_searches) > SEARCH_MAX:
            _searches.popitem(last=False)
    return result


def detail(source: str, native_id: str) -> dict:
    """Full description for a job whose search result lacks it. Raises KeyError for unsupported sources."""
    if source not in enabled_sources():
        raise KeyError(source)
    return DETAIL[source](native_id)

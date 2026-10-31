"""Market salary ranges from Adzuna (official API), live job postings, and opt-in Levels.fyi research.

Ranges stay in the currency the source reports; nothing is converted (no FX rates are invented).
Network access goes through jobs.fetch / jobs.fetch_json (fixed hosts, no redirects), which tests replace.
"""

import json
import os
import re
import statistics
import threading
import time
import urllib.parse
from collections import OrderedDict
from datetime import datetime, timezone

from jivika import importer, jobs

DEFAULT_SOURCES = "adzuna,postings"
CACHE_TTL, CACHE_MAX = 6 * 3600, 200
MIN_SAMPLES = 3
COUNTRY_CURRENCY = {"in": "INR", "gb": "GBP", "us": "USD", "de": "EUR", "fr": "EUR", "nl": "EUR", "it": "EUR", "es": "EUR", "at": "EUR", "be": "EUR"}
ADZUNA_SITES = {"in": "https://www.adzuna.in", "gb": "https://www.adzuna.co.uk", "us": "https://www.adzuna.com"}
# Plausible yearly amounts per currency; parsed values outside are dropped as misreads.
BOUNDS = {"INR": (50_000, 100_000_000), "USD": (5_000, 2_000_000), "GBP": (5_000, 2_000_000), "EUR": (5_000, 2_000_000)}

_cache: OrderedDict = OrderedDict()
_lock = threading.Lock()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


# Levels.fyi only has pages for its own job families, so free-text titles map onto them by keyword
# (first hit wins); anything else links to Software Engineer. Sub-titles live under software-engineer.
LEVELS_TITLES = (
    (("machine learning", "ml engineer", "ai engineer", "ai/ml", "ml/ai", "deep learning", "mlops", "llm"), "software-engineer/title/machine-learning-engineer"),
    (("backend", "back end", "back-end"), "software-engineer/title/backend-software-engineer"),
    (("frontend", "front end", "front-end"), "software-engineer/title/frontend-software-engineer"),
    (("full stack", "full-stack", "fullstack"), "software-engineer/title/full-stack-software-engineer"),
    (("engineering manager", "manager, engineering", "head of engineering"), "software-engineering-manager"),
    (("technical program manager", "tpm"), "technical-program-manager"),
    (("product manager", "product owner"), "product-manager"),
    (("product designer", "ux designer", "ui designer", "ux/ui", "ui/ux"), "product-designer"),
    (("data scientist", "data science"), "data-scientist"),
    (("data analyst", "business analyst", "analytics"), "data-analyst"),
    (("solution architect", "solutions architect"), "solution-architect"),
)
_SENIORITY = re.compile(r"\b(?:senior|sr|junior|jr|lead|staff|principal|associate|intern)\b\.?", re.I)


def levels_title(title: str) -> str:
    text = " ".join(_SENIORITY.sub(" ", re.sub(r"[^a-z/ ,-]+", " ", title.lower())).split())
    for words, path in LEVELS_TITLES:
        if any(re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", text) for w in words):
            return path
    return "software-engineer"


def levels_url(title: str, company: str = "", location: str = "") -> str:
    """A Levels.fyi page to link to, built only from slugged text or a fixed list, so it cannot point anywhere else."""
    if company and slug(company):
        return f"https://www.levels.fyi/companies/{slug(company)}/salaries/"
    path = levels_title(title)
    base = f"https://www.levels.fyi/t/{path}"
    # Location pages only for the top-level families, and only for a location that is actually Indian.
    return f"{base}/locations/india" if location.strip() and "/" not in path and _india(location) else base


def _india(location: str) -> bool:
    lower = location.lower()
    return not lower or any(city in lower for city in jobs.INDIA_CITIES)


# ---------------------------------------------------------------------------
# Salary text parsing
# ---------------------------------------------------------------------------

_UNITS = {"k": 1e3, "l": 1e5, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5, "lpa": 1e5, "cr": 1e7, "crore": 1e7, "crores": 1e7, "m": 1e6, "mn": 1e6, "million": 1e6}
_AMOUNT = re.compile(r"(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?|lpa|l|crores?|cr|mn|million|m)?(?![a-z])")


def parse_salary(text: str) -> tuple[float, float, str] | None:
    """(yearly min, yearly max, currency) from posting text such as '₹12L - ₹18L', '12-18 LPA',
    '₹1,200,000', 'INR 5,00,000 - 8,00,000', '$100k - $150k' or '£45,000 per year'. None when unclear,
    hourly, or in a currency other than INR, USD, GBP or EUR."""
    t = str(text or "").lower().replace(",", "")
    if not t.strip() or re.search(r"\b(?:hour|hr|hourly)\b|/h\b", t):
        return None
    if re.search(r"\b(?:cad|aud|sgd|nzd|hkd)\b|[acs]\$", t):
        return None
    if "₹" in t or re.search(r"\b(?:inr|rs\.?|lpa|lakhs?|lacs?|crores?)\b", t):
        currency = "INR"
    elif "$" in t or "usd" in t:
        currency = "USD"
    elif "£" in t or "gbp" in t:
        currency = "GBP"
    elif "€" in t or "eur" in t:
        currency = "EUR"
    else:
        return None
    amounts = [(float(n), unit) for n, unit in _AMOUNT.findall(t)][:2]
    if not amounts:
        return None
    shared = next((u for _, u in reversed(amounts) if u), "")  # '12-18 LPA': the unit applies to both
    values = [n * _UNITS.get(u or shared, 1) for n, u in amounts]
    if re.search(r"\b(?:per month|a month|monthly|pm|p\.m\.|/month|/mo)\b", t):
        values = [v * 12 for v in values]
    low, high = min(values), max(values)
    floor, ceiling = BOUNDS[currency]
    if low < floor or high > ceiling:
        return None
    return low, high, currency


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


# ---------------------------------------------------------------------------
# Sources: each returns a list of ranges or raises jobs.SourceError
# ---------------------------------------------------------------------------


def adzuna(title, location, company, currency):
    app_id, app_key = jobs.adzuna_keys() or ("", "")
    country = os.getenv("JIVIKA_ADZUNA_COUNTRY", "in").strip().lower()
    if not re.fullmatch(r"[a-z]{2}", country):
        raise jobs.SourceError("JIVIKA_ADZUNA_COUNTRY must be a two-letter country code.")
    params = {"app_id": app_id, "app_key": app_key, "what": f"{title} {company}".strip(), "content-type": "application/json"}
    if location:
        params["where"] = location
    data = jobs.fetch_json(f"https://api.adzuna.com/v1/api/jobs/{country}/histogram?" + urllib.parse.urlencode(params))
    histogram = data.get("histogram") if isinstance(data, dict) else None
    buckets = sorted((float(k), int(v)) for k, v in (histogram or {}).items() if str(k).replace(".", "", 1).isdigit() and isinstance(v, (int, float)) and v > 0)
    total = sum(n for _, n in buckets)
    if total < MIN_SAMPLES:
        return []
    # Each bucket key is its lower bound; a bucket is represented by its midpoint (the last by its bound).
    points = [((low + buckets[i + 1][0]) / 2 if i + 1 < len(buckets) else low, n) for i, (low, n) in enumerate(buckets)]

    def quantile(q):
        target, running = q * total, 0
        for value, n in points:
            running += n
            if running >= target:
                return value
        return points[-1][0]

    site = ADZUNA_SITES.get(country)
    return [{
        "source": "adzuna", "source_name": "Adzuna", "label": "Advertised salaries, middle 50%",
        "min": round(quantile(0.25)), "max": round(quantile(0.75)), "median": round(quantile(0.5)),
        "currency": COUNTRY_CURRENCY.get(country, ""), "period": "year", "sample_size": total, "as_of": _today(),
        "url": f"{site}/search?" + urllib.parse.urlencode({"q": title, **({"w": location} if location else {})}) if site else None,
        "research": False,
    }]


def postings(title, location, company, currency):
    found = jobs.search(title, location)
    samples: dict[str, list[tuple[float, float]]] = {}
    for item in found["jobs"]:
        if company and company.lower() not in item.get("company", "").lower():
            continue
        if parsed := parse_salary(item.get("salary", "")):
            samples.setdefault(parsed[2], []).append(parsed[:2])
    if not samples:
        return []
    # The requested currency when it has enough samples, else the currency most postings use.
    pick = currency if len(samples.get(currency, [])) >= MIN_SAMPLES else max(samples, key=lambda c: len(samples[c]))
    pairs = samples[pick]
    if len(pairs) < MIN_SAMPLES:
        return []
    return [{
        "source": "postings", "source_name": "Live job postings", "label": f"Advertised in {len(pairs)} current postings",
        "min": round(_percentile([lo for lo, _ in pairs], 0.25)), "max": round(_percentile([hi for _, hi in pairs], 0.75)),
        "median": round(statistics.median((lo + hi) / 2 for lo, hi in pairs)),
        "currency": pick, "period": "year", "sample_size": len(pairs), "as_of": _today(), "url": None, "research": False,
    }]


_NEXT_DATA = re.compile(r'\bid="__NEXT_DATA__"')


def _percentiles(node, depth=0):
    """First dict holding p25/p50/p75-style numbers in Levels.fyi's page data."""
    if depth > 12:
        return None
    if isinstance(node, dict):
        keys = {k.lower(): v for k, v in node.items()}
        trio = [keys.get(k) for k in ("p25", "p50", "p75")] if "p50" in keys else [keys.get(k) for k in ("percentile25", "median", "percentile75")]
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in trio):
            return trio, keys.get("currency") or keys.get("currencycode"), keys.get("count") or keys.get("samplesize")
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        if found := _percentiles(child, depth + 1):
            return found
    return None


def levelsfyi(title, location, company, currency):
    """Research source (opt-in): reads the public page's embedded data. No login, no evasion; a block is reported."""
    url = levels_url(title, company, location)
    markup = jobs.fetch(url, {"Accept": "text/html"}).decode("utf-8", "replace")
    blocks = importer.script_blocks(markup, _NEXT_DATA)
    if not blocks:
        raise jobs.SourceError("No salary data on the page.")
    try:
        found = _percentiles(json.loads(blocks[0]).get("props", {}).get("pageProps", {}))
    except (ValueError, AttributeError):
        raise jobs.SourceError("The source returned an unexpected response.") from None
    if not found:
        return []
    (p25, p50, p75), code, count = found
    code = str(code or ("INR" if _india(location) else "USD")).upper()
    return [{
        "source": "levelsfyi", "source_name": "Levels.fyi", "label": "Reported total compensation, middle 50%",
        "min": round(p25), "max": round(p75), "median": round(p50), "currency": code, "period": "year",
        "sample_size": int(count) if isinstance(count, (int, float)) else None, "as_of": _today(), "url": url, "research": True,
    }]


# id -> (name, function, research)
SOURCES = {
    "adzuna": ("Adzuna", adzuna, False),
    "postings": ("Live job postings", postings, False),
    "levelsfyi": ("Levels.fyi", levelsfyi, True),
}


def enabled_sources() -> list[str]:
    wanted = {s.strip().lower() for s in os.getenv("JIVIKA_SALARY_SOURCES", DEFAULT_SOURCES).split(",")}
    return [s for s in SOURCES if s in wanted and (s != "adzuna" or jobs.adzuna_keys())]


def lookup(title: str, location: str = "", company: str = "", currency: str = "INR") -> dict:
    title, location, company = (" ".join(v.split()) for v in (title, location, company))
    enabled = enabled_sources()
    key = (title.lower(), location.lower(), company.lower(), currency, tuple(enabled))
    with _lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL:
            _cache.move_to_end(key)
            return hit[1]
    ranges, report = [], []
    for sid, (name, fn, research) in SOURCES.items():
        entry = {"id": sid, "name": name, "enabled": sid in enabled, "ok": False, "research": research}
        if sid in enabled:
            try:
                ranges += fn(title, location, company, currency)
                entry["ok"] = True
            except jobs.SourceError as exc:
                entry["error"] = str(exc)
            except Exception:  # one broken source must not sink the others
                jobs.log.exception("Salary source %s failed", sid)
                entry["error"] = "Unavailable right now."
        report.append(entry)
    result = {
        "query": {"title": title, "location": location, "company": company, "currency": currency},
        "ranges": ranges, "sources": report, "levels_url": levels_url(title, company, location),
    }
    if any("error" in entry for entry in report):
        return result  # partial failures are not cached, so a recovered source is used on the next request
    with _lock:
        _cache[key] = (time.monotonic(), result)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
    return result

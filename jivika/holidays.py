"""Public holidays from Google's public holiday calendars (iCal feeds).

Only countries in COUNTRIES can be fetched: the URL is built from a fixed feed id, never from user input.
All network access goes through jobs.fetch (8 s timeout, size cap, no redirects), which the tests replace.
"""

import re
from jivika import jobs

SOURCE = "Google public holiday calendar"
FEED = "https://calendar.google.com/calendar/ical/en.{}%23holiday%40group.v.calendar.google.com/public/basic.ics"
TTL = 24 * 3600
MAX_BYTES = 2 * 1024 * 1024

# ISO 3166-1 alpha-2 -> Google feed id. Each feed answered HTTP 200 with VEVENTs on 2026-11-02.
COUNTRIES = {
    "ae": "ae", "ar": "ar", "at": "austrian", "au": "australian", "bd": "bd", "be": "be", "bg": "bulgarian",
    "bh": "bh", "br": "brazilian", "ca": "canadian", "ch": "ch", "cl": "cl", "cn": "china", "co": "co",
    "cz": "czech", "de": "german", "dk": "danish", "eg": "eg", "es": "spain", "fi": "finnish", "fr": "french",
    "gb": "uk", "gr": "greek", "hk": "hong_kong", "hr": "croatian", "hu": "hungarian", "id": "indonesian",
    "ie": "irish", "il": "jewish", "in": "indian", "it": "italian", "jp": "japanese", "ke": "ke",
    "kr": "south_korea", "kw": "kw", "lk": "lk", "lt": "lithuanian", "lv": "latvian", "mx": "mexican",
    "my": "malaysia", "ng": "ng", "nl": "dutch", "no": "norwegian", "np": "np", "nz": "new_zealand",
    "om": "om", "pe": "pe", "ph": "philippines", "pk": "pk", "pl": "polish", "pt": "portuguese", "qa": "qa",
    "ro": "romanian", "ru": "russian", "sa": "saudiarabian", "se": "swedish", "sg": "singapore", "sk": "slovak",
    "th": "th", "tr": "turkish", "tw": "taiwan", "ua": "ukrainian", "us": "usa", "vn": "vietnamese", "za": "sa",
}

_REGION = re.compile(r"^(?:Public holiday|Observance) in (.+)$")


def _unescape(s: str) -> str:
    return re.sub(r"\\(.)", lambda m: "\n" if m.group(1) in "nN" else m.group(1), s)


def parse(text: str) -> list[dict]:
    """VEVENTs with an all-day DTSTART -> [{date, name, kind, region?}], sorted by date, without duplicates."""
    lines = re.sub(r"\r?\n[ \t]", "", text).splitlines()  # unfold continuation lines (RFC 5545 3.1)
    out, seen, ev = [], set(), None
    for line in lines:
        if line == "BEGIN:VEVENT":
            ev = {}
        elif line == "END:VEVENT" and ev is not None:
            day, name = ev.get("DTSTART", ""), _unescape(ev.get("SUMMARY", "")).strip()
            if re.fullmatch(r"\d{8}", day) and name and (day, name) not in seen:
                seen.add((day, name))
                first = _unescape(ev.get("DESCRIPTION", "")).split("\n")[0].strip()
                item = {"date": f"{day[:4]}-{day[4:6]}-{day[6:]}", "name": name[:200]}
                if m := _REGION.match(first):
                    item.update(kind="regional", region=m.group(1)[:500])
                else:
                    item["kind"] = "observance" if first.startswith("Observance") else "public"
                out.append(item)
            ev = None
        elif ev is not None and ":" in line:
            key, value = line.split(":", 1)
            ev.setdefault(key.split(";")[0].upper(), value)
    return sorted(out, key=lambda h: (h["date"], h["name"]))


def _load(feed: str) -> list[dict]:
    text = jobs.fetch(FEED.format(feed), {"Accept": "text/calendar"}, MAX_BYTES).decode("utf-8", "replace")
    if "BEGIN:VCALENDAR" not in text:
        raise jobs.SourceError("The holiday calendar returned an invalid response.")
    return parse(text)


def holidays(country: str, year: int) -> dict:
    """KeyError for a country outside the allow-list; jobs.SourceError when the feed is unavailable."""
    feed = COUNTRIES[country]
    # ponytail: one cached feed per country (bounded by the allow-list, ~200 KB each); each feed spans several years
    items = jobs.cached(f"holidays:{feed}", TTL, lambda: _load(feed))
    prefix = f"{year:04d}-"
    return {"country": country, "year": year, "source": SOURCE, "holidays": [h for h in items if h["date"].startswith(prefix)]}

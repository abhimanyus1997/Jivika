"""Import a job posting from a link: LinkedIn and Naukri by id, any other page by JSON-LD or readable text.

Arbitrary URLs are fetched only through safe_fetch(), which blocks server-side request forgery: http(s) on
ports 80/443 only, every DNS answer must be a public address, the connection goes to the vetted address
(so a second DNS answer cannot rebind it to an internal one), redirects are followed manually (at most 3,
each re-validated), with an overall timeout, a size cap and a content-type allow-list.
"""

import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
import urllib.parse
from html.parser import HTMLParser

from jivika import jobs

TIMEOUT = 8
MAX_BYTES = 3 * 1024 * 1024
MAX_REDIRECTS = 3
MAX_DESCRIPTION = 20_000
CONTENT_TYPES = ("text/html", "application/xhtml+xml", "application/ld+json", "application/json")
BLOCKED = "Blocked by the source. Paste the job description instead."
CGNAT = ipaddress.ip_network("100.64.0.0/10")
NAT64 = ipaddress.ip_network("64:ff9b::/96")


class ImportFailed(Exception):
    """Shown to users. status is the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# SSRF-safe fetching
# ---------------------------------------------------------------------------


def is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo or ip in NAT64):
        return False  # IPv6 forms that carry an IPv4 address could reach an internal host
    if ip.version == 4 and ip in CGNAT:
        return False
    return ip.is_global and not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


def resolve(host: str, port: int) -> list[str]:
    """All addresses for host (replaced in tests). An IP literal resolves to itself."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(info[4][0] for info in infos))


def vet(url: str):
    """(parts, port, addresses) for a fetchable URL, or ImportFailed(422)."""
    try:
        parts = urllib.parse.urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise ImportFailed("Enter a valid http or https link.", 422) from None
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ImportFailed("Enter a valid http or https link.", 422)
    port = port or (443 if parts.scheme == "https" else 80)
    if port not in (80, 443):
        raise ImportFailed("Only links on the standard web ports (80 and 443) can be imported.", 422)
    host = parts.hostname.rstrip(".")
    try:
        addresses = resolve(host, port)
    except (OSError, UnicodeError):
        raise ImportFailed("That website could not be found.", 422) from None
    if not addresses or not all(is_public(a) for a in addresses):
        raise ImportFailed("That address cannot be imported.", 422)
    return parts, port, addresses


class _PinnedHTTP(http.client.HTTPConnection):
    """Connects to the vetted addresses instead of resolving the host again."""

    def __init__(self, host, port, addresses, timeout):
        super().__init__(host, port, timeout=timeout)
        self._addresses = addresses

    def _connect_pinned(self):
        error = None
        # IPv4 first and a short connect timeout per address: hosts without IPv6 routes would otherwise
        # spend the whole budget on an unreachable IPv6 address.
        for address in sorted(self._addresses, key=lambda a: ":" in a):
            try:
                sock = socket.create_connection((address, self.port), min(self.timeout, 3))
                sock.settimeout(min(self.timeout, 3))  # per recv; the overall deadline is the watchdog's job
                return sock
            except OSError as exc:
                error = exc
        raise error or OSError("no address")

    def connect(self):
        self.sock = self._connect_pinned()


class _PinnedHTTPS(_PinnedHTTP):
    default_port = 443

    def connect(self):
        # Certificate and SNI use the hostname, so a pinned address cannot impersonate another site.
        self.sock = ssl.create_default_context().wrap_socket(self._connect_pinned(), server_hostname=self.host)


def _abort(conn) -> None:
    """Watchdog: shutting the socket down wakes a recv blocked by a server that trickles bytes."""
    try:
        if conn.sock:
            conn.sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def _request(parts, port: int, addresses: list[str], timeout: float):
    """One GET without following redirects. Returns the open http.client response; its .watchdog timer
    cuts the connection when timeout runs out (headers and body included) and is cancelled by the caller."""
    cls = _PinnedHTTPS if parts.scheme == "https" else _PinnedHTTP
    conn = cls(parts.hostname.rstrip("."), port, addresses, timeout)
    watchdog = threading.Timer(timeout, _abort, (conn,))
    watchdog.daemon = True
    watchdog.start()
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    try:
        conn.request("GET", path, headers={
            "User-Agent": jobs.USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/ld+json;q=0.9,application/json;q=0.8",
            "Accept-Encoding": "identity",
        })
        response = conn.getresponse()
    except BaseException:
        watchdog.cancel()
        conn.close()
        raise
    response.watchdog = watchdog
    return response


def safe_fetch(url: str) -> tuple[str, str, str]:
    """(final url, content type, text) of a public web page."""
    deadline = time.monotonic() + TIMEOUT
    for _ in range(MAX_REDIRECTS + 1):
        parts, port, addresses = vet(url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ImportFailed("The page took too long to respond.", 504)
        try:
            response = _request(parts, port, addresses, remaining)
            try:
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader("Location") or ""
                    if not location:
                        raise ImportFailed("The page redirected without a destination.")
                    url = urllib.parse.urljoin(url, location.strip())
                    continue
                if response.status in (401, 403, 406, 429, 999):
                    raise ImportFailed(BLOCKED)
                if response.status >= 400:
                    raise ImportFailed(f"The page returned HTTP {response.status}.")
                content_type = (response.getheader("Content-Type") or "").lower()
                mime = content_type.split(";", 1)[0].strip()
                if mime not in CONTENT_TYPES:
                    raise ImportFailed("That link is not a web page.", 415)
                chunks, size = [], 0
                while chunk := response.read1(65536):  # one recv per call, so the deadline is checked often
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ImportFailed("The page is too large to import.", 413)
                    if time.monotonic() > deadline:
                        raise ImportFailed("The page took too long to respond.", 504)
                    chunks.append(chunk)
                if time.monotonic() > deadline:  # the watchdog cut the connection short
                    raise ImportFailed("The page took too long to respond.", 504)
            finally:
                if watchdog := getattr(response, "watchdog", None):
                    watchdog.cancel()
                response.close()
        except (OSError, http.client.HTTPException, ValueError):  # timeouts, TLS errors, resets
            raise ImportFailed("The page could not be reached.") from None
        charset = re.search(r"charset=([\w-]+)", content_type)
        try:
            text = b"".join(chunks).decode(charset.group(1) if charset else "utf-8", "replace")
        except LookupError:
            text = b"".join(chunks).decode("utf-8", "replace")
        return url, mime, text
    raise ImportFailed("The page redirected too many times.")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_SCRIPT_OPEN = re.compile(r"<script\b([^>]{0,500})>", re.I)  # \b: script, not scripts
_LD_TYPE = re.compile(r"type\s*=\s*[\"']?application/ld\+json", re.I)


def script_blocks(markup: str, attrs: re.Pattern) -> list[str]:
    """Bodies of <script> tags whose attributes match attrs. The closing tag is found with str.find, which
    stays linear on hostile pages full of unclosed tags (a lazy (.*?) regex would be quadratic)."""
    lower, out = markup.lower(), []
    for match in _SCRIPT_OPEN.finditer(markup):
        if not attrs.search(match.group(1)):
            continue
        end = lower.find("</script>", match.end())
        if end < 0:
            break
        out.append(markup[match.end():end])
    return out


def _job_postings(node):
    """Every schema.org JobPosting in a JSON-LD value (lists, @graph and nesting handled)."""
    if isinstance(node, list):
        for value in node:
            yield from _job_postings(value)
    elif isinstance(node, dict):
        kind = node.get("@type")
        if kind == "JobPosting" or (isinstance(kind, list) and "JobPosting" in kind):
            yield node
        for key in ("@graph", "mainEntity", "itemListElement", "item"):
            if key in node:
                yield from _job_postings(node[key])


def _name(value) -> str:
    if isinstance(value, list):
        return ", ".join(filter(None, (_name(v) for v in value)))
    if isinstance(value, dict):
        return str(value.get("name") or "")
    return str(value or "")


def _place(value) -> str:
    if isinstance(value, list):
        return "; ".join(dict.fromkeys(filter(None, (_place(v) for v in value))))
    if not isinstance(value, dict):
        return str(value or "")
    address = value.get("address", value)
    if isinstance(address, str):
        return address
    if not isinstance(address, dict):
        return _name(value)
    parts = [address.get("addressLocality"), address.get("addressRegion"), _name(address.get("addressCountry"))]
    return ", ".join(dict.fromkeys(str(p).strip() for p in parts if p and str(p).strip()))


def _salary(value) -> str:
    if isinstance(value, list):
        value = value[0] if value else None
    if not isinstance(value, dict):
        return str(value or "") if isinstance(value, (str, int, float)) else ""
    currency, amount = value.get("currency") or "", value.get("value")
    unit = ""
    if isinstance(amount, dict):
        unit = str(amount.get("unitText") or "").lower()
        currency = currency or amount.get("currency") or ""
        low, high = amount.get("minValue"), amount.get("maxValue")
        if not isinstance(low, (int, float)) and not isinstance(high, (int, float)):
            low = high = amount.get("value")
    else:
        low = high = amount
    numbers = [n for n in (low, high) if isinstance(n, (int, float)) and not isinstance(n, bool)]
    if not numbers:
        return ""
    text = f"{numbers[0]:,.0f}" if len(numbers) == 1 or numbers[0] == numbers[1] else f"{numbers[0]:,.0f} - {numbers[1]:,.0f}"
    period = {"year": "per year", "month": "per month", "week": "per week", "day": "per day", "hour": "per hour"}.get(unit, "")
    return " ".join(filter(None, [str(currency), text, period]))


def _experience(value) -> str:
    if isinstance(value, dict):
        months = value.get("monthsOfExperience")
        if isinstance(months, (int, float)) and months > 0:
            years, rest = divmod(int(months), 12)
            return " ".join(filter(None, [f"{years} years" if years else "", f"{rest} months" if rest else ""]))
        return jobs._clean(value.get("description") or "", 120)
    return jobs._clean(value, 120)


def parse_jsonld(markup: str, url: str) -> dict | None:
    for block in script_blocks(markup, _LD_TYPE):
        try:
            data = json.loads(block.strip().removeprefix("<!--").removesuffix("-->"), strict=False)
        except ValueError:
            continue
        for posting in _job_postings(data):
            title = jobs._clean(jobs.html_text(posting.get("title") or ""))
            if not title:
                continue
            location = _place(posting.get("jobLocation"))
            if str(posting.get("jobLocationType") or "").upper() == "TELECOMMUTE":
                location = ", ".join(filter(None, [location, "Remote"]))
            kinds = posting.get("employmentType")
            kinds = kinds if isinstance(kinds, list) else [kinds] if kinds else []
            return {
                "title": title,
                "company": jobs._clean(_name(posting.get("hiringOrganization"))),
                "location": jobs._clean(location),
                "employment_type": jobs._clean(", ".join(jobs.humanize(k) for k in kinds), 80),
                "experience_required": _experience(posting.get("experienceRequirements")),
                "salary": jobs._clean(_salary(posting.get("baseSalary") or posting.get("estimatedSalary")), 120),
                # Some boards (Lever) double-escape newlines, leaving a literal backslash-n in the text.
                "description": jobs.html_text(str(posting.get("description") or "").replace("\\n", "\n")),
                "url": str(posting.get("url") or "") if str(posting.get("url") or "").startswith("https://") else url,
                "posted_at": jobs.iso(posting.get("datePosted")),
                "source": "jsonld",
            }
    return None


class _Readable(HTMLParser):
    """Title, meta tags and visible text; nav, header, footer, forms and scripts are dropped. Text inside
    <main> or <article> is kept separately, since it is usually the posting itself."""

    SKIP = {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "template", "iframe", "button", "select"}
    BLOCK = jobs._Text.BLOCK | {"main", "header", "footer", "table", "dd", "dt"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip, self.main, self.in_title = 0, 0, False
        self.all, self.main_parts, self.meta, self.title = [], [], {}, ""

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:title", "og:site_name", "og:description", "description", "twitter:title"):
                self.meta.setdefault(key, a.get("content", ""))
            return
        if tag in self.VOID:
            if tag == "br":
                self._add("\n")
            return
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP:
            self.skip += 1
        elif tag in ("main", "article"):
            self.main += 1
        if tag in self.BLOCK:
            self._add("\n- " if tag == "li" else "\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag in ("main", "article") and self.main:
            self.main -= 1
        if tag in self.BLOCK:
            self._add("\n")

    def _add(self, text):
        if not self.skip:
            self.all.append(text)
            if self.main:
                self.main_parts.append(text)

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        else:
            self._add(data)


def _tidy(parts: list[str]) -> str:
    lines = (re.sub(r"[ \t\r\f\v\xa0]+", " ", line).strip() for line in "".join(parts).split("\n"))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(line for line in lines if line != "-")).strip()


def parse_text(markup: str, url: str) -> dict:
    parser = _Readable()
    parser.feed(markup)
    parser.close()
    main_text, all_text = _tidy(parser.main_parts), _tidy(parser.all)
    text = main_text if len(main_text) >= 200 else all_text
    title = parser.meta.get("og:title") or parser.meta.get("twitter:title") or parser.title
    return {
        "title": jobs._clean(title),
        "company": jobs._clean(parser.meta.get("og:site_name") or ""),
        "description": text or jobs._clean(parser.meta.get("og:description") or parser.meta.get("description") or "", 2000),
        "url": url,
        "source": "text",
    }


# ---------------------------------------------------------------------------
# Known job sites
# ---------------------------------------------------------------------------


def _host_is(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def linkedin_id(parts) -> str | None:
    if not _host_is(parts.hostname or "", "linkedin.com"):
        return None
    query = urllib.parse.parse_qs(parts.query)
    for key in ("currentJobId", "jobId"):
        if (value := (query.get(key) or [""])[0]).isdigit() and len(value) <= 20:
            return value
    found = re.search(r"/jobs/(?:view|collections/[^/]+)/(?:[^/]*?-)?(\d{6,20})/?$", parts.path) or re.search(
        r"/jobs-guest/jobs/api/jobPosting/(\d{6,20})", parts.path
    )
    return found.group(1) if found else None


def naukri_id(parts) -> str | None:
    if not _host_is(parts.hostname or "", "naukri.com"):
        return None
    found = re.search(r"/job-listings-[^/?#]*?-(\d{6,20})/?$", parts.path)
    return found.group(1) if found else None


_CRITERIA = re.compile(
    r'job-criteria-subheader">\s*Employment type\s*</h3>\s*<span class="description__job-criteria-text[^"]*">\s*([^<]+?)\s*</span>', re.I
)


def from_linkedin(native_id: str) -> dict:
    try:
        markup = jobs.fetch(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{native_id}").decode("utf-8", "replace")
    except jobs.SourceError as exc:
        raise ImportFailed(BLOCKED if "Blocked" in str(exc) else f"LinkedIn: {exc}") from None
    description = jobs.html_text(markup, only_class="show-more-less-html__markup")
    title = jobs._clean(jobs.html_text(markup, only_class="top-card-layout__title"))
    if not description and not title:
        raise ImportFailed(BLOCKED)
    kind = _CRITERIA.search(markup)
    return {
        "title": title,
        "company": jobs._clean(jobs.html_text(markup, only_class="topcard__org-name-link")),
        "location": jobs._clean(jobs.html_text(markup, only_class="topcard__flavor--bullet")),
        "employment_type": jobs._clean(kind.group(1)) if kind else "",
        "salary": jobs._clean(jobs.html_text(markup, only_class="salary"), 120),
        "description": description,
        "url": f"https://www.linkedin.com/jobs/view/{native_id}/",
        "source": "linkedin",
    }


def from_naukri(native_id: str, url: str) -> dict:
    """Naukri's job details JSON with the web client's public headers. Raises ImportFailed when blocked."""
    try:
        data = jobs.fetch_json(f"https://www.naukri.com/jobapi/v4/job/{native_id}", {**jobs.NAUKRI_HEADERS, "appid": "121"})
    except jobs.SourceError as exc:
        raise ImportFailed(BLOCKED if "Blocked" in str(exc) else f"Naukri: {exc}") from None
    detail = data.get("jobDetails") if isinstance(data, dict) else None
    if not isinstance(detail, dict) or not detail.get("title"):
        raise ImportFailed(BLOCKED)
    low, high = detail.get("minimumExperience"), detail.get("maximumExperience")
    experience = f"{low}-{high} years" if low not in (None, "") and high not in (None, "") else ""
    salary = (detail.get("salaryDetail") or {}).get("label") if isinstance(detail.get("salaryDetail"), dict) else ""
    places = detail.get("locations") or []
    return {
        "title": jobs._clean(detail.get("title")),
        "company": jobs._clean((detail.get("companyDetail") or {}).get("name") if isinstance(detail.get("companyDetail"), dict) else ""),
        "location": jobs._clean(", ".join(str(p.get("label", "")) for p in places if isinstance(p, dict))),
        "employment_type": jobs._clean(detail.get("employmentType"), 80),
        "experience_required": experience,
        "salary": "" if str(salary or "").lower().startswith("not disclosed") else jobs._clean(salary, 120),
        "description": jobs.html_text(detail.get("description") or ""),
        "url": url,
        "posted_at": jobs.iso(detail.get("createdDate")),
        "source": "naukri",
    }


def import_job(url: str) -> tuple[dict, bool]:
    """(job fields, needs_structuring). needs_structuring is True for plain-text pages, which the caller
    may send to a model to fill title/company/location and so on."""
    try:
        parts = urllib.parse.urlsplit(url.strip())
    except ValueError:
        raise ImportFailed("Enter a valid http or https link.", 422) from None
    if native_id := linkedin_id(parts):
        return _finish(from_linkedin(native_id)), False
    if native_id := naukri_id(parts):
        try:
            return _finish(from_naukri(native_id, url.strip())), False
        except ImportFailed:
            pass  # fall back to the page itself; still reports BLOCKED below if that is refused too
    final_url, mime, body = safe_fetch(url)
    if _expired(url, final_url):
        raise ImportFailed("That job posting is no longer available. Paste the description instead.", 404)
    if mime in ("application/json", "application/ld+json"):
        try:
            data = json.loads(body)
        except ValueError:
            raise ImportFailed("The link returned an invalid response.") from None
        body = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    job = parse_jsonld(body, final_url)
    if job and job["description"]:
        return _finish(job), False
    job = parse_text(body, final_url)
    if not job["description"]:
        raise ImportFailed("No job description was found on that page. Paste it instead.", 422)
    if "captcha" in job["description"][:2000].lower() and len(job["description"]) < 2000:
        raise ImportFailed(BLOCKED)  # a challenge page, not a posting
    if naukri_id(urllib.parse.urlsplit(url.strip())):
        job["source"] = "naukri"
    return _finish(job), True


_JOB_SEGMENT = re.compile(r"/jobs?/[^/]*\d{4,}", re.I)


def _expired(url: str, final_url: str) -> bool:
    """Boards such as Greenhouse redirect an expired posting to the board root (often with ?error=true)."""
    if final_url == url:
        return False
    final = urllib.parse.urlsplit(final_url)
    if "true" in (v.lower() for v in urllib.parse.parse_qs(final.query).get("error", [])):
        return True
    found = _JOB_SEGMENT.search(urllib.parse.urlsplit(url.strip()).path)
    return bool(found) and found.group(0).lower() not in final.path.lower()


def _finish(job: dict) -> dict:
    out = {k: "" for k in ("title", "company", "location", "employment_type", "experience_required", "salary", "description", "url")}
    out.update({k: v for k, v in job.items() if v is not None})
    out["description"] = jobs.clip(out["description"], MAX_DESCRIPTION)
    out.setdefault("posted_at", None)
    return out

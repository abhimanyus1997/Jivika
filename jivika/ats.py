"""ATS checker: deterministic resume checks (no model involved), PDF layout metadata and the score.

The model only adds skill extraction, a title-match judgement, content notes and a summary (see
main.ats_check); every check and the score here are computed from the text and PDF metadata alone.
"""

import re
from collections import Counter

STOPWORDS = set(
    """
    the and for with you your our are will that this from have has can all any not but
    who what when where why how into about across within over under per via etc also
    their they them his her its was were been being able must should would could may
    more most other such than then there these those use using used work working role
    team teams job position candidate candidates company we us experience years year
    including include includes strong excellent good great ability skills skill knowledge
    understanding preferred required requirements responsibilities plus well new one two
    """.split()
)


def tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= 3 and t not in STOPWORDS}


# ---------------------------------------------------------------------------
# PDF metadata
# ---------------------------------------------------------------------------

LAYOUT_PAGES = 6  # layout heuristics only look at the first pages


def _resolve(value):
    return value.get_object() if hasattr(value, "get_object") else value


def pdf_text_and_meta(reader) -> tuple[str, dict]:
    """Text plus {pages, images, fonts, has_text_layer, avg_chars_per_page, suspected_columns, suspected_tables}.

    Columns: at least 6 runs of 20+ characters start in the middle band (35-70% of the page width) and they
    are a quarter or more of all such runs, which single-column text does not produce. Tables: 4 or more
    rows (same baseline) with 3+ text runs whose starts are each 80pt or more apart.
    ponytail: x/y heuristics on pypdf text runs; a layout-analysis library would be more exact.
    """
    texts, fonts, images, page_chars = [], set(), 0, []
    long_runs = mid_runs = table_rows = 0
    for index, page in enumerate(reader.pages):
        runs = []

        def visit(text, cm, tm, font, size, runs=runs):
            if text.strip():
                x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
                y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
                runs.append((x, y, len(text.strip())))

        text = (page.extract_text(visitor_text=visit if index < LAYOUT_PAGES else None) or "").strip()
        texts.append(text)
        page_chars.append(len(text))
        try:
            resources = _resolve(page.get("/Resources")) or {}
            for font in (_resolve(resources.get("/Font")) or {}).values():
                if name := _resolve(font).get("/BaseFont"):
                    fonts.add(str(name).lstrip("/").split("+")[-1])  # subset prefix ABCDEF+Name
            for xobject in (_resolve(resources.get("/XObject")) or {}).values():
                images += _resolve(xobject).get("/Subtype") == "/Image"
        except (AttributeError, TypeError, KeyError, ValueError):
            pass
        if index < LAYOUT_PAGES and runs:
            width = float(page.mediabox.width) or 612
            long = [r for r in runs if r[2] >= 20]
            long_runs += len(long)
            mid_runs += sum(1 for r in long if 0.35 * width <= r[0] <= 0.7 * width)
            rows: dict[int, list[float]] = {}
            for x, y, _ in runs:
                rows.setdefault(round(y / 2), []).append(x)
            for xs in rows.values():
                xs = sorted(xs)
                if len(xs) >= 3 and all(b - a >= 80 for a, b in zip(xs, xs[1:])):
                    table_rows += 1
    pages = len(reader.pages)
    meta = {
        "pages": pages,
        "images": images,
        "fonts": len(fonts),
        "has_text_layer": bool(pages) and all(chars >= 20 for chars in page_chars),
        "avg_chars_per_page": round(sum(page_chars) / pages) if pages else 0,
        "suspected_columns": mid_runs >= 6 and mid_runs >= 0.25 * long_runs,
        "suspected_tables": table_rows >= 4,
    }
    return "\n".join(texts).strip(), meta


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

SECTIONS = {
    "experience": ("Work experience", r"(professional |work |relevant )?(experience|employment( history)?|work history|career history)", True),
    "education": ("Education", r"education(al)?( background| qualifications?)?|academics?|qualifications", True),
    "skills": ("Skills", r"(technical |key |core )?(skills|competencies|technologies|tech stack|tools)( & tools| and tools)?", True),
    "summary": ("Summary", r"(professional |career )?(summary|profile|objective)|about( me)?", False),
    "projects": ("Projects", r"(key |personal |academic )?projects", False),
    "certifications": ("Certifications", r"certifications?|licenses?( (&|and) certifications?)?|courses", False),
}
# Symbol/Wingdings bullets from Word and Docs exports arrive as private-use characters (U+E000-U+F8FF).
BULLET = re.compile(r"^\s*(?:[•●○◦▪■□►▸‣⁃\-–—*✓✔➢➤∙·-]|o(?=\s))\s*")
EMAIL = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}")  # bounded, so long word runs cannot backtrack
PHONE = re.compile(r"(?:\+91[\s-]?|\b0)?[6-9]\d{4}[\s-]?\d{5}\b|\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}")
LINKEDIN = re.compile(r"linkedin\.com/in/[\w%-]+", re.I)
CITIES = (
    "bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|noida|pune|hyderabad|chennai|kolkata|ahmedabad|"
    "jaipur|kochi|chandigarh|indore|london|new york|san francisco|seattle|singapore|dubai|berlin|toronto|remote|india"
)
# Only the city list ignores case; "City, Region" needs capitals so a list like "python, sql" does not count.
LOCATION = re.compile(rf"(?i:\b(?:{CITIES})\b)|\b[A-Z][a-z]+,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b")
MONTHS = r"jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec"
DATE_STYLES = {
    "Mon YYYY": re.compile(rf"\b(?:{MONTHS})\.?\s+(?:19|20)\d\d\b", re.I),
    "Month YYYY": re.compile(r"\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d\d\b", re.I),
    "MM/YYYY": re.compile(r"\b(?:0?[1-9]|1[0-2])\s*[/.-]\s*(?:19|20)\d\d\b"),
    "YYYY-MM": re.compile(r"\b(?:19|20)\d\d-(?:0[1-9]|1[0-2])\b"),
}
YEAR = re.compile(r"\b(?:19|20)\d\d\b")
ACTION_VERBS = set(
    """
    achieved accelerated added analysed analyzed architected automated boosted built championed coached collaborated
    conducted configured consolidated created cut debugged decreased defined delivered deployed designed developed
    devised directed doubled drove eliminated enabled engineered established evaluated executed expanded facilitated
    founded generated grew guided identified implemented improved increased initiated integrated introduced launched
    led maintained managed mentored migrated modernised modernized monitored negotiated optimised optimized
    orchestrated organised organized oversaw owned partnered pioneered planned presented prioritised prioritized
    produced programmed proposed prototyped published raised rebuilt redesigned reduced refactored resolved
    restructured revamped saved scaled secured shipped simplified spearheaded standardised standardized
    streamlined strengthened supervised tested trained transformed tripled troubleshot unified upgraded validated wrote
    """.split()
)
BUZZWORDS = (
    "team player", "hard working", "hard-working", "hardworking", "detail-oriented", "detail oriented", "go-getter",
    "synergy", "results-driven", "results driven", "self-starter", "self starter", "think outside the box",
    "dynamic", "passionate", "highly motivated", "proven track record", "strategic thinker", "go-to person",
    "responsible for", "duties included", "references available", "best of breed", "rockstar", "ninja", "guru",
)

# Category weights for the score (percent). Keywords count only when a job description is given, and then
# weigh the most; categories without checks are left out and the rest re-normalised.
WEIGHTS_NO_JD = {"parsing": 20, "sections": 20, "contact": 15, "formatting": 15, "content": 30}
WEIGHTS_JD = {"parsing": 15, "sections": 15, "contact": 10, "formatting": 10, "content": 20, "keywords": 30}
POINTS = {"pass": 1.0, "warn": 0.5, "fail": 0.0}


def _check(id, category, label, status, detail, fix=None, weight=1.0):
    return {"id": id, "category": category, "label": label, "status": status, "detail": detail, "fix": fix if status != "pass" else None, "_weight": weight}


def _lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _heading(line: str, pattern: str) -> bool:
    clean = re.sub(r"[^\w&/ ]+", " ", line).strip().lower()
    return len(clean) <= 40 and len(clean.split()) <= 5 and re.fullmatch(rf"(?:{pattern})", " ".join(clean.split())) is not None


def bullet_lines(lines: list[str]) -> list[str]:
    return [BULLET.sub("", line) for line in lines if BULLET.match(line) and len(BULLET.sub("", line).split()) >= 3]


def deterministic_checks(resume: str, meta: dict | None) -> list[dict]:
    lines = _lines(resume)
    words = len(resume.split())
    checks = []

    # Parsing
    if words < 150:
        advice = ("Your resume is short. Add 3 to 6 bullets per role with outcomes, and a skills section."
                  if meta and meta.get("has_text_layer") else
                  "Make sure the resume is a text-based PDF and covers your experience in full sentences or bullets.")
        checks.append(_check("text_length", "parsing", "Readable text", "fail", f"Only {words} words could be read.", advice, 2))
    elif words < 300 or words > 1200:
        checks.append(_check("text_length", "parsing", "Readable text", "warn",
                             f"{words} words were read; 300 to 1,200 is typical.",
                             "Expand thin sections." if words < 300 else "Trim older or less relevant detail.", 2))
    else:
        checks.append(_check("text_length", "parsing", "Readable text", "pass", f"{words} words were read.", weight=2))
    if meta is not None:
        if meta.get("has_text_layer", True):
            checks.append(_check("text_layer", "parsing", "Text layer", "pass", "Every page has selectable text.", weight=2))
        else:
            checks.append(_check("text_layer", "parsing", "Text layer", "fail", "Some pages have little or no selectable text (scanned or image-based).",
                                 "Export the resume directly from your editor as a PDF instead of scanning or printing to image.", 2))

    # Sections
    found = {key: any(_heading(line, pattern) for line in lines) for key, (_, pattern, _) in SECTIONS.items()}
    for key, (label, _, required) in SECTIONS.items():
        if found[key]:
            checks.append(_check(f"section_{key}", "sections", label, "pass", f"Found the '{label}' heading.", weight=2 if required else 0.5))
        elif required:
            checks.append(_check(f"section_{key}", "sections", label, "fail", f"No '{label}' heading was found.",
                                 f"Add a clearly labelled '{label}' section heading on its own line.", 2))
        else:
            checks.append(_check(f"section_{key}", "sections", label, "warn", f"No '{label}' section.",
                                 f"Consider a short '{label}' section if it is relevant to the roles you target.", 0.5))

    # Contact
    head = "\n".join(lines[:15])
    email = EMAIL.search(resume)
    checks.append(_check("contact_email", "contact", "Email", "pass" if email else "fail",
                         "Email address found." if email else "No email address found.", "Add a professional email address near your name.", 2))
    phone = PHONE.search(resume)
    checks.append(_check("contact_phone", "contact", "Phone", "pass" if phone else "fail",
                         "Phone number found." if phone else "No phone number found.", "Add a phone number with the country code, for example +91 98765 43210.", 2))
    checks.append(_check("contact_linkedin", "contact", "LinkedIn", "pass" if LINKEDIN.search(resume) else "warn",
                         "LinkedIn profile URL found." if LINKEDIN.search(resume) else "No LinkedIn profile URL found.",
                         "Add your LinkedIn URL (linkedin.com/in/your-name)."))
    location = LOCATION.search(head)
    checks.append(_check("contact_location", "contact", "Location", "pass" if location else "warn",
                         "A location appears in the header." if location else "No city or location in the header.",
                         "Add your city and country (for example Bengaluru, India) to the header.", 0.5))

    # Formatting
    styles = [name for name, rx in DATE_STYLES.items() if rx.search(resume)]
    # May/June/July match both patterns, so a resume that only uses them in one style is not mixed.
    if {"Mon YYYY", "Month YYYY"} <= set(styles):
        ambiguous = lambda name: all(  # noqa: E731
            m.group(0).split()[0].lower().rstrip(".") in ("may", "june", "july") for m in DATE_STYLES[name].finditer(resume)
        )
        if ambiguous("Month YYYY"):
            styles.remove("Month YYYY")
        elif ambiguous("Mon YYYY"):
            styles.remove("Mon YYYY")
    years = YEAR.findall(resume)
    if not years:
        checks.append(_check("dates", "formatting", "Dates", "warn", "No dates found.", "Add start and end dates (for example Jan 2022 - Mar 2024) to each role."))
    elif len(styles) > 1:
        checks.append(_check("dates", "formatting", "Dates", "warn", f"Mixed date formats: {', '.join(styles)}.",
                             "Use one date format throughout, for example 'Jan 2022 - Mar 2024'."))
    elif not styles:
        checks.append(_check("dates", "formatting", "Dates", "warn", "Dates show years only.", "Add months to dates (for example Jan 2022) so tenure is clear.", 0.5))
    else:
        checks.append(_check("dates", "formatting", "Dates", "pass", f"Dates use one format ({styles[0]})."))
    bullets = bullet_lines(lines)
    # Without bullet markers (often drawn as shapes and lost in extraction) long lines stand in for bullets.
    achievement = bullets or [line for line in lines if len(line.split()) >= 8]
    unit = "bullets" if bullets else "achievement lines"
    verbs = sum(1 for line in achievement if re.sub(r"[^a-z]", "", line.split()[0].lower()) in ACTION_VERBS)
    if len(bullets) >= 5:
        checks.append(_check("bullets", "formatting", "Bullet points", "pass", f"{len(bullets)} bullet points found."))
    elif not bullets and verbs >= 5:
        checks.append(_check("bullets", "formatting", "Bullet points", "pass",
                             f"No bullet markers were read, but {verbs} lines start with an action verb."))
    else:
        checks.append(_check("bullets", "formatting", "Bullet points", "warn",
                             f"{len(bullets)} bullet points found." if bullets else "No bullet points detected.",
                             "Describe each role with 3 to 6 bullet points starting with an action verb."))
    if meta is not None:
        pages = int(meta.get("pages") or 0)
        if pages:
            status = "pass" if pages <= 2 else "warn" if pages == 3 else "fail"
            checks.append(_check("page_count", "formatting", "Length", status, f"{pages} page{'s' if pages != 1 else ''}.",
                                 "Keep the resume to one or two pages.", 1))
        if meta.get("images"):
            checks.append(_check("images", "formatting", "Images", "warn", f"{meta['images']} image(s) found. ATS software ignores images, and text inside them is lost.",
                                 "Remove photos, logos and skill charts, or make sure the same information is in text."))
        else:
            checks.append(_check("images", "formatting", "Images", "pass", "No images.", weight=0.5))
        checks.append(_check("columns", "formatting", "Single column", "warn" if meta.get("suspected_columns") else "pass",
                             "The layout looks like multiple columns, which some ATS read in the wrong order." if meta.get("suspected_columns") else "The layout reads as a single column.",
                             "Use a single-column layout so sections are read in order."))
        checks.append(_check("tables", "formatting", "Tables", "warn" if meta.get("suspected_tables") else "pass",
                             "Table-like rows were detected; ATS often scramble table cells." if meta.get("suspected_tables") else "No tables detected.",
                             "Replace tables with plain text lines or bullets.", 0.5))

    # Content
    if achievement:
        quantified = sum(1 for line in achievement if re.search(r"\d|%", line))
        ratio = quantified / len(achievement)
        status = "pass" if ratio >= 0.4 else "warn" if ratio >= 0.2 else "fail"
        checks.append(_check("quantified", "content", "Quantified results", status,
                             f"{quantified} of {len(achievement)} {unit} include a number or percentage.",
                             "Add numbers to more bullets: scale, time saved, revenue, users, percentages.", 2))
        ratio = verbs / len(achievement)
        status = "pass" if ratio >= 0.5 else "warn" if ratio >= 0.25 else "fail"
        checks.append(_check("action_verbs", "content", "Action verbs", status,
                             f"{verbs} of {len(achievement)} {unit} start with an action verb.",
                             "Start bullets with strong verbs such as Built, Led, Reduced or Automated.", 1.5))
        lengths = [len(line.split()) for line in achievement]
        average, long = sum(lengths) / len(lengths), sum(1 for n in lengths if n > 35)
        if long > len(lengths) / 4:
            checks.append(_check("bullet_length", "content", "Bullet length", "warn", f"{long} bullets run over 35 words.", "Split long bullets; aim for 12 to 25 words each."))
        elif average < 6:
            checks.append(_check("bullet_length", "content", "Bullet length", "warn", f"Bullets average {average:.0f} words.", "Add context and outcome to short bullets."))
        else:
            checks.append(_check("bullet_length", "content", "Bullet length", "pass", f"Bullets average {average:.0f} words."))
    lower = resume.lower()
    cliches = [b for b in BUZZWORDS if b in lower]
    count = len(cliches)
    status = "pass" if count <= 2 else "warn" if count <= 5 else "fail"
    checks.append(_check("buzzwords", "content", "Buzzwords", status,
                         f"Cliches found: {', '.join(cliches)}." if cliches else "No common cliches found.",
                         "Replace cliches with concrete evidence of the same quality.", 0.5))
    return checks


# ---------------------------------------------------------------------------
# Keywords
# ---------------------------------------------------------------------------


def contains(text_lower: str, term: str) -> bool:
    """Whole-term match, so 'go' does not match 'good' and 'c++' or '.net' still match."""
    term = term.strip().lower()
    return bool(term) and re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text_lower) is not None


def top_terms(resume: str, job_description: str, limit: int = 15) -> list[dict]:
    jd_words = [t for t in re.findall(r"[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]", job_description.lower()) if len(t) >= 3 and t not in STOPWORDS and not t.isdigit()]
    resume_words = Counter(re.findall(r"[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]", resume.lower()))
    return [{"term": term, "jd_count": n, "resume_count": resume_words.get(term, 0)} for term, n in Counter(jd_words).most_common(limit)]


def keyword_report(resume: str, job_description: str, insights) -> dict:
    """Found/missing skills. Uses the model's skill lists when given (insights), else frequent JD terms."""
    lower = resume.lower()
    terms = top_terms(resume, job_description)
    if insights is not None and insights.required_skills:
        required, preferred, title_match = insights.required_skills, insights.preferred_skills, insights.title_match
    else:
        required, preferred = [t["term"] for t in terms[:12]], []
        first = next((line.strip() for line in job_description.splitlines() if line.strip()), "")[:80]
        title_words = tokens(first)
        title_match = bool(title_words) and title_words <= tokens(resume)
    dedupe = lambda items: list(dict.fromkeys(s.strip() for s in items if s and s.strip()))[:20]  # noqa: E731
    required, preferred = dedupe(required), dedupe(preferred)
    return {
        "title_match": bool(title_match),
        "required_found": [s for s in required if contains(lower, s)],
        "required_missing": [s for s in required if not contains(lower, s)],
        "preferred_found": [s for s in preferred if contains(lower, s)],
        "preferred_missing": [s for s in preferred if not contains(lower, s)],
        "top_terms": terms,
    }


def keyword_checks(keywords: dict) -> list[dict]:
    checks = []
    required = len(keywords["required_found"]) + len(keywords["required_missing"])
    if required:
        ratio = len(keywords["required_found"]) / required
        status = "pass" if ratio >= 0.75 else "warn" if ratio >= 0.5 else "fail"
        missing = ", ".join(keywords["required_missing"][:8])
        checks.append(_check("keywords_required", "keywords", "Required skills", status,
                             f"{len(keywords['required_found'])} of {required} required skills appear in the resume.",
                             f"Add these where you genuinely have them: {missing}." if missing else None, 3))
    preferred = len(keywords["preferred_found"]) + len(keywords["preferred_missing"])
    if preferred:
        ratio = len(keywords["preferred_found"]) / preferred
        checks.append(_check("keywords_preferred", "keywords", "Preferred skills", "pass" if ratio >= 0.5 else "warn",
                             f"{len(keywords['preferred_found'])} of {preferred} preferred skills appear in the resume.",
                             "Mention preferred skills you have, with evidence.", 1))
    checks.append(_check("title_match", "keywords", "Job title", "pass" if keywords["title_match"] else "warn",
                         "Your experience matches the job title." if keywords["title_match"] else "The resume does not show the job's title or a close equivalent.",
                         "Use the job's title wording in your summary or headline where it honestly fits.", 1.5))
    return checks


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------


def grade(score: int) -> str:
    return "Excellent" if score >= 85 else "Good" if score >= 70 else "Fair" if score >= 50 else "Needs work"


def score(checks: list[dict], with_jd: bool) -> tuple[int, dict[str, int]]:
    """Each category: weighted mean of its checks (pass 1, warn 0.5, fail 0). Score: categories weighted by
    WEIGHTS_JD or WEIGHTS_NO_JD."""
    weights = WEIGHTS_JD if with_jd else WEIGHTS_NO_JD
    categories = {}
    for category in weights:
        own = [c for c in checks if c["category"] == category]
        if own:
            total = sum(c["_weight"] for c in own)
            categories[category] = round(100 * sum(POINTS[c["status"]] * c["_weight"] for c in own) / total)
    if not categories:
        return 0, {}
    overall = sum(weights[c] * s for c, s in categories.items()) / sum(weights[c] for c in categories)
    return round(overall), categories


def fixes(checks: list[dict], notes: list[str]) -> list[dict]:
    out = []
    for c in checks:
        if c["status"] != "pass" and c.get("fix"):
            priority = "high" if c["status"] == "fail" else "medium" if c["_weight"] >= 1 else "low"
            out.append({"priority": priority, "text": c["fix"]})
    out += [{"priority": "medium", "text": note.strip()} for note in notes[:5] if note.strip()]
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda f: order[f["priority"]])[:15]

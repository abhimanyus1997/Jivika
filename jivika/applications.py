"""Application helpers: requirement matching against the profile, and employer email triage and replies.

The model proposes; these checks keep the answer grounded. Requirement evidence may only cite real profile
entries and names written in the profile, and inbox summaries, senders, linked applications and proposed times
must come from the email or the request.
"""

import re
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

from jivika.resume import EmailBasics, Line, Short, StructuredProfile, _capped, _norm, _squash, _str, numbers, profile_text, verbatim

STATUSES = ("Draft", "Applied", "Screening", "Interview", "Offer", "Accepted", "Declined", "Rejected", "Withdrawn")
KINDS = ("interview_invite", "question", "rejection", "offer", "acknowledgement", "assessment", "other")


def _one_of(options: tuple, default: str = ""):
    """Case-insensitive choice; anything else becomes default, so odd model output never fails validation."""
    key = lambda v: str(v or "").strip().lower().replace(" ", "_")  # noqa: E731
    lookup = {key(o): o for o in options}
    return BeforeValidator(lambda v: lookup.get(key(v), default))


# ---------------------------------------------------------------------------
# Grounded text
# ---------------------------------------------------------------------------

_CAP = re.compile(r"(?<![\w+#&-])[A-Z][\w+#&-]*")
# Capitalised words that may appear mid-sentence without being names from the source.
_GENERIC = {"I", "Your", "You", "Shown", "Listed", "Not", "No", "Experience", "Projects", "Project", "Education", "Skills",
            "Summary", "Profile", "Certifications", "Certification", "Related", "They", "The", "We"}
# Month and weekday names: dates are checked through their numbers, and a paraphrase may abbreviate or resolve them.
_GENERIC |= {name[:n] for name in ("January", "February", "March", "April", "May", "June", "July", "August", "September",
                                   "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday",
                                   "Friday", "Saturday", "Sunday") for n in (3, len(name))} | {"Sept", "Tues", "Thurs"}


def grounded_text(text: str, source: str, *, forbid: str = "", counts: bool = False, allow: frozenset = frozenset()) -> bool:
    """True when text adds no numbers and no capitalised names that source lacks. Sentence-initial words are only
    rejected when forbid (e.g. the job description) contains them; counts allows small whole numbers (1 to 30) and
    allow any other given numbers."""
    extra = numbers(text) - numbers(source) - allow
    if counts:
        extra = {n for n in extra if not (n.isdigit() and 0 < int(n) <= 30)}
    if extra:
        return False
    for found in _CAP.finditer(text):
        word, before = found.group(0), text[: found.start()].rstrip()
        if word in _GENERIC or verbatim(word, source):
            continue
        if not before or before[-1] in ".!?:;\"'(":
            if forbid and verbatim(word, forbid):
                return False
            continue
        return False
    return True


# ---------------------------------------------------------------------------
# Requirements
# ---------------------------------------------------------------------------

class RequirementsRequest(BaseModel):
    job_description: Annotated[str, Field(min_length=1, max_length=20_000), AfterValidator(str.strip), Field(min_length=1)]
    profile: StructuredProfile


class RequirementDraft(BaseModel):
    text: Line = ""
    kind: Annotated[str, _one_of(("required", "preferred"), "required")] = "required"
    status: Annotated[str, _one_of(("met", "partial", "missing"), "missing")] = "missing"
    evidence: Line = ""
    evidence_refs: Annotated[list[Short], _capped(10)] = []


class RequirementsDraft(BaseModel):
    title: Short = ""
    company: Short = ""
    location: Short = ""
    work_mode: Short = ""
    salary: Short = ""
    deadline: Short = ""
    requirements: Annotated[list[RequirementDraft], _capped(25)] = []


class Requirement(BaseModel):
    id: str
    text: str
    kind: Literal["required", "preferred"]
    status: Literal["met", "partial", "missing"]
    evidence: str
    evidence_refs: list[str]


class RequirementSummary(BaseModel):
    met: int
    partial: int
    missing: int
    total: int


class RequirementResult(BaseModel):
    title: str = ""
    company: str = ""
    location: str = ""
    work_mode: Literal["On-site", "Hybrid", "Remote", ""] = ""
    salary: str = ""
    deadline: str = ""
    requirements: list[Requirement] = []
    summary: RequirementSummary


_ENTRY_SECTIONS = ("experience", "projects", "education", "certifications", "publications", "references")
_MODES = (("Remote", r"remote|work from home|wfh|anywhere"), ("Hybrid", r"hybrid"),
          ("On-site", r"on-?site|on site|in[- ]office|in person|office-based"))


def work_mode(value: str, job_description: str) -> str:
    """'Remote', 'Hybrid', 'On-site' or '': the model's choice, kept only when the job description says so."""
    for mode, words in _MODES:
        if re.search(words, value or "", re.I) or _norm(value) == mode.lower():
            return mode if re.search(rf"\b(?:{words})\b", job_description, re.I) else ""
    return ""


def deadline(value: str, job_description: str) -> str:
    """yyyy-mm-dd when valid and its day of the month is written in the job description, else ''."""
    try:
        day = date.fromisoformat((value or "").strip()[:10])
    except ValueError:
        return ""
    return day.isoformat() if str(day.day) in {n.lstrip("0") for n in numbers(job_description)} else ""


def _describe(entry, section: str) -> str:
    if section == "experience":
        role = " at ".join(filter(None, (entry.title, entry.company)))
        dates = " - ".join(filter(None, (entry.start, "Present" if entry.current and not entry.end else entry.end)))
        return f"{role} ({dates})" if role and dates else role
    if section == "projects":
        return entry.name
    if section == "education":
        return ", ".join(filter(None, (" ".join(filter(None, (entry.degree, entry.field))), entry.institution)))
    if section == "certifications":
        return " ".join(filter(None, (entry.name, f"({entry.issuer})" if entry.issuer else "")))
    return getattr(entry, "name", "") or getattr(entry, "citation", "")[:80]


_TOKEN = re.compile(r"[\w+#]+(?:[.-][\w+#]+)*")
# Words that describe a requirement rather than name the thing required.
_REQ_STOP = set("""a an and or of in on at to for with the as by from into using use used plus etc is are be
    year years yr yrs month months experience experienced strong solid good great excellent deep proven hands-on hands
    working work knowledge understanding familiarity familiar ability able skill skills proficiency proficient expertise
    background track record minimum least preferred required nice have having demonstrated relevant related similar
    equivalent level degree bonus""".split())


def requirement_terms(requirement: str, job_description: str) -> list[str]:
    """The words that name what a requirement asks for: its tokens that the job description writes, minus filler."""
    return [t for t in dict.fromkeys(_TOKEN.findall(requirement)) if len(t) >= 2 and re.search(r"[a-z]", t, re.I)
            and t.lower() not in _REQ_STOP and verbatim(t, job_description)]


def ground_requirements(draft: RequirementsDraft, profile: StructuredProfile, job_description: str) -> list[Requirement]:
    """Requirements whose refs are real profile entries and whose evidence names only what the profile contains.
    'met' needs a valid ref whose entry shows every term of the requirement; evidence that fails the check is
    rewritten from the cited entries and the status is capped at 'partial'."""
    text = profile_text(profile)
    entries = {e.id: _describe(e, s) for s in _ENTRY_SECTIONS for e in getattr(profile, s) if e.id}
    entry_text = {e.id: str(e.model_dump(exclude={"id"})) for s in _ENTRY_SECTIONS for e in getattr(profile, s) if e.id}
    skills = list(dict.fromkeys(i for g in profile.skills for i in g.items))
    out, seen = [], set()
    for item in draft.requirements:
        if not item.text or _norm(item.text) in seen:
            continue
        seen.add(_norm(item.text))
        named = [s for s in skills if verbatim(s, f"{item.text} {item.evidence}")]
        refs = []
        for ref in dict.fromkeys(r.strip() for r in item.evidence_refs):
            if ref in entries or (ref == "skills" and named) or (ref == "summary" and profile.basics.summary):
                refs.append(ref)
        status, evidence = item.status, item.evidence
        terms = requirement_terms(item.text, job_description)
        # Any case: 'Used aws at Northwind' must not pass because 'aws' is lowercase.
        # ponytail: covers the requirement's own words; other lowercase job terms rely on the term check below.
        invented = [t for t in terms if verbatim(t, evidence) and not verbatim(t, text)]
        if status == "missing":
            refs = []
            ok = evidence and not invented and grounded_text(evidence, text, forbid=job_description)
            evidence = evidence if ok else "Not shown in your profile."
        else:
            if evidence and (invented or not grounded_text(evidence, text, forbid=job_description, counts=True)):
                evidence = ""
                status = "partial"  # the model's own reason did not hold up
            if refs and terms:
                cited = " ".join(entry_text.get(r, "") for r in refs)
                cited += " " + (" ".join(skills) if "skills" in refs else "") + " " + (profile.basics.summary if "summary" in refs else "")
                shown = sum(verbatim(t, cited) for t in terms)
                if not shown:
                    status, refs, evidence = "missing", [], ""
                elif shown < len(terms):
                    status = "partial"
            if not evidence and refs:
                cited = [entries[r] for r in refs if r in entries]
                if "skills" in refs:
                    cited.append(f"your skills ({', '.join(named[:3])})")
                if "summary" in refs:
                    cited.append("your summary")
                evidence = "Shown in " + "; ".join(cited) + "."
            if status == "met" and not refs:
                status = "partial" if evidence else "missing"
            if status == "partial" and not (refs or evidence):
                status = "missing"
            if status == "missing":
                evidence = "Not shown in your profile."
        out.append(Requirement(id=f"req-{len(out) + 1}", text=item.text, kind=item.kind, status=status,
                               evidence=evidence, evidence_refs=refs))
    return out


def requirement_summary(requirements: list[Requirement]) -> RequirementSummary:
    count = lambda s: sum(r.status == s for r in requirements)  # noqa: E731
    return RequirementSummary(met=count("met"), partial=count("partial"), missing=count("missing"), total=len(requirements))


# ---------------------------------------------------------------------------
# Inbox: classify an employer email, draft a reply
# ---------------------------------------------------------------------------

EmailText = Annotated[str, Field(min_length=1, max_length=12_000), AfterValidator(str.strip), Field(min_length=1)]


class TrackedApplication(BaseModel):
    id: Annotated[str, Field(min_length=1, max_length=100)]
    company: Short = ""
    role: Short = ""
    status: Short = ""


class ClassifyRequest(BaseModel):
    email_text: EmailText
    applications: Annotated[list[TrackedApplication], Field(max_length=200)] = []


class ClassifyDraft(BaseModel):
    kind: Annotated[str, _one_of(KINDS, "other")] = "other"
    summary: _str(400) = ""
    sender_name: Short = ""
    sender_company: Short = ""
    application_id: Short = ""
    suggested_status: Annotated[str, _one_of(STATUSES)] = ""
    proposed_times: Annotated[list[Short], _capped(20)] = []
    reply_needed: Annotated[bool, BeforeValidator(lambda v: bool(v) if v is not None else False)] = False


class Classification(BaseModel):
    kind: Literal["interview_invite", "question", "rejection", "offer", "acknowledgement", "assessment", "other"]
    summary: str
    sender_name: str
    sender_company: str
    application_id: str
    suggested_status: Literal["Draft", "Applied", "Screening", "Interview", "Offer", "Accepted", "Declined", "Rejected", "Withdrawn", ""]
    proposed_times: list[str]
    reply_needed: bool


FALLBACK_SUMMARY = {
    "interview_invite": "They would like to schedule an interview with you.",
    "question": "They have a question about your application.",
    "rejection": "They have decided not to move forward with your application.",
    "offer": "They are making you an offer.",
    "acknowledgement": "They confirmed they received your application.",
    "assessment": "They have sent you an assessment to complete.",
    "other": "An update about your application.",
}
DEFAULT_STATUS = {"interview_invite": "Interview", "rejection": "Rejected", "offer": "Offer", "assessment": "Screening"}
_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _mentions(value: str, text: str) -> bool:
    return len(_squash(value)) >= 2 and verbatim(value, text)


def link_application(model_id: str, applications: list[TrackedApplication], email: str) -> str:
    """The model's id when it is one of the given ids and the email names that company or role; otherwise the only
    application whose company the email names; else ''."""
    by_id = {a.id: a for a in applications}
    chosen = by_id.get(model_id.strip())
    if chosen and (_mentions(chosen.company, email) or _mentions(chosen.role, email)):
        return chosen.id
    named = [a for a in applications if len(_squash(a.company)) >= 3 and verbatim(a.company, email)]
    return named[0].id if len(named) == 1 else ""


def proposed_times(values: list[str], email: str) -> list[str]:
    """ISO datetimes (yyyy-mm-ddThh:mm, offsets kept) whose day and hour the email states (as a number, weekday,
    'today' or 'tomorrow'; 'noon' for 12:00). Others are dropped as invented."""
    lower, nums = email.lower(), {n.lstrip("0") or "0" for n in numbers(email)}
    out = []
    for value in values:
        try:
            when = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            continue
        day_ok = (str(when.day) in nums or _WEEKDAYS[when.weekday()][:3] in lower or "today" in lower or "tomorrow" in lower)
        hour = when.hour
        hour_ok = (str(hour) in nums or (hour > 12 and str(hour - 12) in nums)
                   or (hour == 12 and re.search(r"\b(?:noon|midday)\b", lower) is not None))
        if day_ok and hour_ok:
            out.append(when.isoformat(timespec="minutes"))
    return sorted(dict.fromkeys(out))[:10]


def check_classification(draft: ClassifyDraft, body: ClassifyRequest, grounded) -> Classification:
    """grounded(value, source) returns value when source states it, else '' (main._grounded)."""
    email = body.email_text
    summary = " ".join(draft.summary.split())
    summary = re.split(r"(?<=[.!?])\s+", summary)[0][:300] if summary else ""
    times = proposed_times(draft.proposed_times, email)
    # A paraphrase may restate a checked proposed time (24-hour clock, resolved day or year) and this year.
    year = date.today().year
    allow = {str(year), str(year + 1)} | {str(int(part)) for t in times for part in re.findall(r"\d+", t[:16])}
    if not summary or not grounded_text(summary, email, allow=frozenset(allow | {a.zfill(2) for a in allow})):
        summary = FALLBACK_SUMMARY[draft.kind]
    return Classification(
        kind=draft.kind,
        summary=summary,
        sender_name=grounded(draft.sender_name, email),
        sender_company=grounded(draft.sender_company, email),
        application_id=link_application(draft.application_id, body.applications, email),
        suggested_status=draft.suggested_status or DEFAULT_STATUS.get(draft.kind, ""),
        proposed_times=times,
        reply_needed=draft.reply_needed,
    )


class ReplyApplication(BaseModel):
    company: Short = ""
    role: Short = ""


class ReplyRequest(BaseModel):
    email_text: EmailText
    kind: Annotated[str, _one_of(KINDS, "other")] = "other"
    basics: EmailBasics = Field(default_factory=EmailBasics)
    application: ReplyApplication = Field(default_factory=ReplyApplication)
    profile_summary: Annotated[str, Field(max_length=2000), AfterValidator(str.strip)] = ""
    availability: Annotated[str, Field(max_length=500), AfterValidator(str.strip)] = ""
    tone: Literal["formal", "warm", "concise"] = "formal"


class Reply(BaseModel):
    subject: str
    body: str


_SUBJECT = re.compile(r"^\s*subject:\s*(.+)$", re.I | re.M)


def reply_subject(draft_subject: str, email: str, application: ReplyApplication) -> str:
    """'Re: <the email's subject line>' when the pasted email has one, else the model's subject, else role and company."""
    if found := _SUBJECT.search(email):
        original = found.group(1).strip()[:150]
        return original if original.lower().startswith("re:") else f"Re: {original}"
    fallback = " at ".join(filter(None, (application.role, application.company)))
    return draft_subject or (f"Re: {fallback}" if fallback else "Re: your email")


def facts_only(body: str, facts: str) -> str:
    """The body without sentences that state numbers or names the facts do not contain (invented dates, times,
    figures, employers or skills)."""
    known = numbers(facts)
    paragraphs = []
    for paragraph in body.split("\n\n"):
        kept = [s for s in re.split(r"(?<=[.!?])\s+", paragraph.strip()) if numbers(s) <= known and grounded_text(s, facts)]
        if kept:
            paragraphs.append(" ".join(kept))
    return "\n\n".join(paragraphs)

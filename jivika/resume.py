"""Structured resumes: the schema, tailoring and refining checks that keep the model from inventing experience,
and application email helpers.

Every tailored or refined resume goes through enforce(): entries must match the source profile (by id, else by
their identifying fields), identifying fields are restored from the source, and skills, bullets and summaries that
introduce numbers or skills the source does not contain are dropped. The model may reorder, select and rephrase;
it cannot add facts.
"""

import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

from jivika.schemas import RequiredText


def _to_str(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return value


def _str(limit: int):
    """Tolerant string: null and numbers accepted, whitespace collapsed, clipped to limit."""
    return Annotated[str, BeforeValidator(_to_str), AfterValidator(lambda s: " ".join(s.split())[:limit])]


def _capped(limit: int):
    """Lists are clipped instead of rejected, so long model output or requests never fail validation."""
    return BeforeValidator(lambda v: [x for x in v if x is not None][:limit] if isinstance(v, list) else ([] if v is None else v))


Short = _str(200)
Line = _str(600)
Long = _str(3000)
Lines = Annotated[list[Line], _capped(20), AfterValidator(lambda items: [i for i in items if i])]
Flag = Annotated[bool, BeforeValidator(lambda v: bool(v) if v is not None else False)]


class Basics(BaseModel):
    name: Short = ""
    headline: Short = ""
    email: Short = ""
    phone: Short = ""
    location: Short = ""
    linkedin: Short = ""
    website: Short = ""
    summary: Long = ""


class Experience(BaseModel):
    id: Short = ""
    company: Short = ""
    title: Short = ""
    location: Short = ""
    start: Short = ""
    end: Short = ""
    current: Flag = False
    bullets: Lines = []


class Project(BaseModel):
    id: Short = ""
    name: Short = ""
    role: Short = ""
    link: Short = ""
    description: _str(2000) = ""
    bullets: Lines = []


class Education(BaseModel):
    id: Short = ""
    institution: Short = ""
    degree: Short = ""
    field: Short = ""
    start: Short = ""
    end: Short = ""
    grade: Short = ""


class SkillGroup(BaseModel):
    group: Short = ""
    items: Annotated[list[Short], _capped(60), AfterValidator(lambda items: [i for i in items if i])] = []


class Language(BaseModel):
    name: Short = ""
    level: Short = ""


class Certification(BaseModel):
    id: Short = ""
    name: Short = ""
    issuer: Short = ""
    year: Short = ""


class Publication(BaseModel):
    id: Short = ""
    citation: Line = ""


class Reference(BaseModel):
    id: Short = ""
    name: Short = ""
    relation: Short = ""
    contact: Short = ""


class StructuredProfile(BaseModel):
    basics: Annotated[Basics, BeforeValidator(lambda v: v or {})] = Field(default_factory=Basics)
    experience: Annotated[list[Experience], _capped(30)] = []
    projects: Annotated[list[Project], _capped(30)] = []
    education: Annotated[list[Education], _capped(15)] = []
    skills: Annotated[list[SkillGroup], _capped(20)] = []
    languages: Annotated[list[Language], _capped(20)] = []
    certifications: Annotated[list[Certification], _capped(40)] = []
    publications: Annotated[list[Publication], _capped(40)] = []
    references: Annotated[list[Reference], _capped(10)] = []


class Gap(BaseModel):
    requirement: Line = ""
    note: Line = ""


Notes = Annotated[list[Line], _capped(30), AfterValidator(lambda items: [i for i in items if i])]
Skills = Annotated[list[Short], _capped(40), AfterValidator(lambda items: [i for i in items if i])]


class TailorResult(BaseModel):
    resume: StructuredProfile
    highlighted_skills: Skills = []
    gaps: Annotated[list[Gap], _capped(20)] = []
    changes: Notes = []


class RefineResult(BaseModel):
    resume: StructuredProfile
    changes: Notes = []


Section = Literal["summary", "experience", "projects", "skills", "education"]


class StructureRequest(BaseModel):
    resume: RequiredText


class TailorRequest(BaseModel):
    profile: StructuredProfile
    job_description: RequiredText
    emphasis: Annotated[str, Field(max_length=500)] = ""


class RefineRequest(BaseModel):
    resume: StructuredProfile
    source_profile: StructuredProfile
    instruction: Annotated[str, Field(min_length=1, max_length=1000), AfterValidator(str.strip), Field(min_length=1)]
    section: Section | None = None


class EmailBasics(BaseModel):
    name: Short = ""
    email: Short = ""
    phone: Short = ""
    linkedin: Short = ""


class EmailJob(BaseModel):
    title: Short = ""
    company: Short = ""
    description: Annotated[str, Field(max_length=30_000)] = ""


class EmailRequest(BaseModel):
    basics: EmailBasics = Field(default_factory=EmailBasics)
    job: EmailJob
    tone: Literal["formal", "warm", "concise"] = "formal"
    resume_summary: Annotated[str, Field(max_length=4000)] = ""


class EmailDraft(BaseModel):
    subject: Short = ""
    body: Annotated[str, BeforeValidator(_to_str), AfterValidator(lambda s: s.strip()[:4000])] = ""


class ApplicationEmail(BaseModel):
    to: str = ""
    subject: str
    body: str


# ---------------------------------------------------------------------------
# Grounding helpers
# ---------------------------------------------------------------------------

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_WORDS = re.compile(r"[a-z0-9+#]+")


def numbers(text: str) -> set[str]:
    """Numbers as written, thousands separators removed: 'Cut costs 1,200 by 30%' -> {'1200', '30'}."""
    return {n.replace(",", "") for n in _NUMBER.findall(text or "")}


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _squash(text: str) -> str:
    return re.sub(r"[\W_]+", "", str(text or "").lower())


def profile_text(profile: StructuredProfile) -> str:
    """Every text field of a profile except ids (which contain generated digits)."""
    parts: list[str] = []

    def walk(value, key=""):
        if isinstance(value, dict):
            for k, v in value.items():
                if k != "id":
                    walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)
        elif isinstance(value, str) and value:
            parts.append(value)

    walk(profile.model_dump())
    return "\n".join(parts)


def verbatim(term: str, text: str) -> bool:
    """term appears in text as a whole token, case-insensitive ('Go' does not match 'Google'; 'C++' works)."""
    term = term.strip()
    return bool(term) and re.search(rf"(?<![\w+#]){re.escape(term)}(?![\w+#])", text, re.I) is not None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:24].strip("-")


# section -> (id prefix, field naming the entry)
_ID_FIELDS = {"experience": ("exp", "company"), "projects": ("proj", "name"), "education": ("edu", "institution"),
              "certifications": ("cert", "name"), "publications": ("pub", "citation"), "references": ("ref", "name")}


def fill_ids(profile: StructuredProfile, force: bool = False) -> StructuredProfile:
    """Short unique ids ('exp-1-acme'); with force every id is regenerated, else only blank or duplicate ones."""
    for section, (prefix, field) in _ID_FIELDS.items():
        seen: set[str] = set()
        for i, entry in enumerate(getattr(profile, section), 1):
            if force or not entry.id or entry.id in seen:
                entry.id = "-".join(filter(None, (prefix, str(i), _slug(getattr(entry, field)))))
                while entry.id in seen:
                    entry.id += "-x"
            seen.add(entry.id)
    return profile


def ground_structure(profile: StructuredProfile, text: str) -> StructuredProfile:
    """Drop what the resume text does not contain: entries whose naming fields are absent, bullets with numbers
    the text lacks, and skills not written in it. Ids are generated here."""
    squashed, nums = _squash(text), numbers(text)
    present = lambda *values: any(v and _squash(v) in squashed for v in values)  # noqa: E731
    keep_bullets = lambda bullets: [b for b in bullets if numbers(b) <= nums]  # noqa: E731
    profile.experience = [e.model_copy(update={"bullets": keep_bullets(e.bullets)}) for e in profile.experience if present(e.company, e.title)]
    profile.projects = [p.model_copy(update={"bullets": keep_bullets(p.bullets),
                                             "description": p.description if numbers(p.description) <= nums else ""})
                        for p in profile.projects if present(p.name)]
    profile.education = [e for e in profile.education if present(e.institution, e.degree)]
    profile.certifications = [c for c in profile.certifications if present(c.name)]
    profile.references = [r for r in profile.references if present(r.name)]
    groups = []
    for group in profile.skills:
        items = list(dict.fromkeys(i for i in group.items if verbatim(i, text)))
        if items:
            groups.append(group.model_copy(update={"items": items}))
    profile.skills = groups
    if numbers(profile.basics.summary) - nums:
        profile.basics.summary = ""
    return fill_ids(profile, force=True)


def _matched(items: list, sources: list, key, label: str, describe, merge, notes: list[str]) -> list:
    """Each item matched to a source entry (by id, else by key), merged; unmatched and repeated entries dropped."""
    by_id = {s.id: s for s in sources if getattr(s, "id", "")}
    by_key = {key(s): s for s in sources}
    used, out = set(), []
    for item in items:
        source = by_id.get(getattr(item, "id", "")) or by_key.get(key(item))
        if source is None:
            notes.append(f"Removed {label} '{describe(item)}': it is not in your profile.")
            continue
        if id(source) not in used:
            used.add(id(source))
            out.append(merge(item, source))
    return out


def enforce(result: StructuredProfile, source: StructuredProfile) -> tuple[StructuredProfile, list[str]]:
    """result limited to facts in source, plus notes on everything removed or restored."""
    notes: list[str] = []
    text = profile_text(source)
    nums = numbers(text)
    known = {_norm(i) for g in source.skills for i in g.items}
    skill_ok = lambda s: _norm(s) in known or verbatim(s, text)  # noqa: E731

    def bullets(new: list[str], original: list[str], where: str) -> list[str]:
        kept = [b for b in new if numbers(b) <= nums]
        if len(kept) < len(new):
            notes.append(f"Removed {len(new) - len(kept)} bullet(s) from {where} that added numbers not in your profile.")
        return kept or list(original)

    basics = source.basics.model_copy()
    headline = result.basics.headline
    # A headline is a claim about seniority and role, so every word in it must already be in the profile.
    if headline and set(_WORDS.findall(headline.lower())) <= set(_WORDS.findall(text.lower())):
        basics.headline = headline
    elif headline:
        notes.append("Kept your original headline: the rewrite used words not in your profile.")
    if result.basics.summary and numbers(result.basics.summary) <= nums:
        basics.summary = result.basics.summary
    elif result.basics.summary:
        notes.append("Kept your original summary: the rewrite added numbers not in your profile.")

    def project(item: Project, src: Project) -> Project:
        description = item.description if item.description and numbers(item.description) <= nums else src.description
        return src.model_copy(update={"description": description, "bullets": bullets(item.bullets, src.bullets, src.name or "a project")})

    restore = lambda item, src: src.model_copy()  # noqa: E731
    out = StructuredProfile(
        basics=basics,
        experience=_matched(result.experience, source.experience, lambda e: (_norm(e.company), _norm(e.title)), "experience",
                            lambda e: " at ".join(filter(None, (e.title, e.company))),
                            lambda item, src: src.model_copy(update={"bullets": bullets(item.bullets, src.bullets, " at ".join(filter(None, (src.title, src.company))) or "a role")}),
                            notes),
        projects=_matched(result.projects, source.projects, lambda p: _norm(p.name), "project", lambda p: p.name, project, notes),
        education=_matched(result.education, source.education, lambda e: _norm(e.institution), "education entry",
                           lambda e: e.institution, restore, notes),
        languages=_matched(result.languages, source.languages, lambda x: _norm(x.name), "language", lambda x: x.name, restore, notes),
        certifications=_matched(result.certifications, source.certifications, lambda c: _norm(c.name), "certification",
                                lambda c: c.name, restore, notes),
        publications=_matched(result.publications, source.publications, lambda p: _norm(p.citation), "publication",
                              lambda p: p.citation[:60], restore, notes),
        references=_matched(result.references, source.references, lambda r: _norm(r.name), "reference", lambda r: r.name, restore, notes),
    )
    groups, seen, dropped = [], set(), []
    for group in result.skills:
        items = []
        for item in group.items:
            if not skill_ok(item):
                dropped.append(item)
            elif _norm(item) not in seen:
                seen.add(_norm(item))
                items.append(item)
        if items:
            groups.append(group.model_copy(update={"items": items}))
    out.skills = groups if groups or not source.skills else [g.model_copy() for g in source.skills]
    if dropped:
        notes.append(f"Removed skills not in your profile: {', '.join(dict.fromkeys(dropped))}.")
    return out, notes


def tailor_checked(result: TailorResult, source: StructuredProfile) -> TailorResult:
    resume, notes = enforce(result.resume, source)
    text, known = profile_text(source), {_norm(i) for g in source.skills for i in g.items}
    highlighted = [s for s in dict.fromkeys(result.highlighted_skills) if _norm(s) in known or verbatim(s, text)]
    return TailorResult(resume=resume, highlighted_skills=highlighted, gaps=result.gaps,
                        changes=list(dict.fromkeys([*result.changes, *notes])))


def refine_checked(result: RefineResult, current: StructuredProfile, source: StructuredProfile, section: str | None) -> RefineResult:
    """The refined resume checked against source; with a section, every other section stays as it was."""
    candidate = result.resume
    if section:
        candidate = current.model_copy()
        if section == "summary":
            new = result.resume.basics
            candidate.basics = current.basics.model_copy(update={"summary": new.summary or current.basics.summary,
                                                                 "headline": new.headline or current.basics.headline})
        else:
            setattr(candidate, section, getattr(result.resume, section))
    refined, notes = enforce(candidate, source)
    return RefineResult(resume=refined, changes=list(dict.fromkeys([*result.changes, *notes])))


# ---------------------------------------------------------------------------
# Application email
# ---------------------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}")
_NOT_APPLY = re.compile(r"^(?:no-?reply|do-?not-?reply|donotreply|privacy|abuse|security|legal|unsubscribe|support)@|@(?:example|test)\.|\.(?:png|jpe?g|gif|svg|webp)$", re.I)
_APPLY_LOCAL = re.compile(r"^(?:jobs?|careers?|hiring|recruit\w*|talent\w*|hr|apply|applications?|people|resumes?|cv)[\w.+-]*@", re.I)
_APPLY_WORDS = re.compile(r"\b(?:apply|application|send|email|e-mail|resume|résumé|cv|mail)\b", re.I)


def application_address(description: str) -> str:
    """The first plausible application address in a job description, or ''. Addresses named as jobs/careers/hr
    inboxes or written near 'apply'/'send your resume' win over others; no-reply and example addresses never do."""
    candidates = []
    for found in _EMAIL.finditer(description or ""):
        address = found.group(0).rstrip(".-")
        if "." not in address.split("@")[-1] or _NOT_APPLY.search(address):
            continue
        context = description[max(0, found.start() - 80): found.start()]
        candidates.append((0 if _APPLY_LOCAL.match(address) or _APPLY_WORDS.search(context) else 1, len(candidates), address))
    return min(candidates)[2] if candidates else ""


SIGN_OFFS = {"formal": "Kind regards", "warm": "Warm regards", "concise": "Best regards"}
_SIGNED = re.compile(r"\n[ \t]*(?:(?:best|kind|warm|warmest)\s+regards|regards|(?:yours\s+)?sincerely|yours faithfully|thanks|thank you|cheers),?[ \t]*(?:\n[^\n]*){0,3}\Z", re.I)
_ATTACHED = "I have attached my resume and cover letter for your review."


def email_body(draft_body: str, basics: EmailBasics, tone: str) -> str:
    """Plain text: markdown removed, the attachments mentioned, then a sign-off and the sender's own details."""
    body = re.sub(r"\*\*|__|^#+\s*", "", draft_body, flags=re.M).strip()
    body = _SIGNED.sub("", body).strip()  # the signature is added below, from the sender's own details
    lower = body.lower()
    if not (re.search(r"\b(?:resume|résumé|cv)\b", lower) and "cover letter" in lower):
        body = f"{body}\n\n{_ATTACHED}" if body else _ATTACHED
    contact = " | ".join(filter(None, (basics.email, basics.phone, basics.linkedin)))
    signature = "\n".join(filter(None, (f"{SIGN_OFFS[tone]},", basics.name, contact)))
    return f"{body}\n\n{signature}"

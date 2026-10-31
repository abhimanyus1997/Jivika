"""Providers, request and response schemas, and prompts for the Jivika API."""

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, model_validator

MAX_TEXT_CHARS = 30_000


# json_mode: the endpoint accepts response_format={"type": "json_object"} (Anthropic rejects it with a 400).
# temperature: the default model accepts a custom temperature (OpenAI's GPT-6 and current Claude models reject one).
# Defaults checked against each provider's docs on 2026-10-31: fast, inexpensive, capable models.
PROVIDERS = {
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-3.8-flash",
        "key_url": "https://aistudio.google.com/apikey",
        "json_mode": True,
        "temperature": True,
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-6-luna",
        "key_url": "https://platform.openai.com/api-keys",
        "json_mode": True,
        "temperature": False,
    },
    "anthropic": {
        "name": "Anthropic Claude",
        "base_url": "https://api.anthropic.com/v1/",
        "default_model": "claude-haiku-5-5",
        "key_url": "https://platform.claude.com/settings/keys",
        "json_mode": False,
        "temperature": False,
        "extra": {"max_completion_tokens": 16000},
    },
    "groq": {
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "openai/gpt-oss-120b",  # Groq production model; llama-3.3-70b-versatile returned 404 for a new key on 2026-10-31
        "key_url": "https://console.groq.com/keys",
        "json_mode": True,
        "temperature": True,
    },
    "mistral": {
        "name": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "default_model": "mistral-small-latest",
        "key_url": "https://console.mistral.ai/api-keys",
        "json_mode": True,
        "temperature": True,
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "default_model": "deepseek-flash",
        "key_url": "https://platform.deepseek.com/api_keys",
        "json_mode": True,
        "temperature": True,
    },
    "xai": {
        "name": "xAI Grok",
        "base_url": "https://api.x.ai/v1",
        "default_model": "grok-4.20-0309-non-reasoning",
        "key_url": "https://console.x.ai",
        "json_mode": True,
        "temperature": True,
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "openai/gpt-6-luna",
        "key_url": "https://openrouter.ai/keys",
        "json_mode": True,
        "temperature": False,
    },
    # Model Studio international endpoint (OpenAI-compatible; GET /models answers 401 without a key).
    # json_object mode needs the word "JSON" in the messages (the system prompt has it) and, on hybrid
    # models such as Qwen-Flash/Plus, non-thinking mode, hence enable_thinking=False.
    "qwen": {
        "name": "Qwen (Alibaba Cloud)",
        "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen3.8-flash",
        "key_url": "https://modelstudio.console.alibabacloud.com/model/settings/api-key",
        "json_mode": True,
        "temperature": True,
        "extra": {"extra_body": {"enable_thinking": False}},
    },
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


def _clamp_score(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(number):
        return 0
    return max(0, min(100, round(number)))


_RANGE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?")
_RANGE_SPLIT = re.compile(r"\s(?:-|–|—|to)\s")
_YEARS = re.compile(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|y)\b")
_MONTHS = re.compile(r"(\d+)\s*(?:months?|mos?|m)\b")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _decimal_years(written: str) -> int:
    """'5.3' -> 63 months. A decimal part written as 1..11 (no leading zero) is months ('5.5' is 5y5m,
    '5.10' is 5y10m); anything else is a fraction of a year ('5.75' is 5y9m, '5.08' is 5y1m)."""
    whole, _, frac = written.partition(".")
    months = int(whole or 0) * 12
    if frac and len(frac) <= 2 and frac[0] != "0" and 1 <= int(frac) <= 11:
        return months + int(frac)
    return months + (round(float("0." + frac) * 12) if frac else 0)


def _written(value) -> str:
    """A number as the model wrote it, as far as JSON allows (5.10 arrives as 5.1)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return ""
    text = repr(value)
    return f"{value:.6f}".rstrip("0").rstrip(".") if "e" in text else text


def experience_months(value, unit: str = "years") -> int:
    """Total months from a lenient value: 5.3, '5 years 3 months', '5 yrs 3 mos', '5y 3m', '63 months',
    '5+', '5-7 years' (the lower bound). Bare numbers are read in `unit` ('years' or 'months')."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        written = _written(value)
        if not written:
            return 0
        return _decimal_years(written) if unit == "years" else round(float(written))
    # Capped (model output), then the lower bound of a range: '5-7 years' -> '5 years', '6 months - 1 year' -> '6 months'.
    text = _RANGE.sub(r"\1", str(value or "").lower()[:120])
    text = _RANGE_SPLIT.split(text, 1)[0]
    years, months = _YEARS.search(text), _MONTHS.search(text)
    if years or months:
        return (_decimal_years(years.group(1)) if years else 0) + (int(months.group(1)) if months else 0)
    if number := _NUMBER.search(text):
        return _decimal_years(number.group()) if unit == "years" else round(float(number.group()))
    return 0


Score = Annotated[int, BeforeValidator(_clamp_score)]
Text = Annotated[str, AfterValidator(lambda s: s.strip()[:MAX_TEXT_CHARS])]
RequiredText = Annotated[Text, Field(min_length=1)]


# Responses (also the schemas the model must follow). Defaults keep validation
# tolerant of a model omitting an optional list or string.
class Profile(BaseModel):
    name: str = ""
    headline: str = ""
    current_role: str = ""
    experience_years: int = Field(0, ge=0, le=60)
    experience_months: int = Field(0, ge=0, le=11)
    years_experience: float = 0  # years + months / 12, kept for older clients
    location: str = ""
    skills: list[str] = []
    summary: str = ""

    @model_validator(mode="before")
    @classmethod
    def _experience(cls, data):
        """Normalise years and months (months >= 12 roll over); years_experience only when both are absent.
        A numeric years_experience is the legacy decimal-years field (years + months / 12), so 4.5 is 4y6m,
        matching the app's migration; free text in it still goes through the lenient parser."""
        if not isinstance(data, dict):
            return data
        years, months = data.get("experience_years"), data.get("experience_months")
        legacy = data.get("years_experience")
        if years is None and months is None and isinstance(legacy, (int, float)) and not isinstance(legacy, bool):
            total = round(legacy * 12) if math.isfinite(legacy) and legacy > 0 else 0
        elif years is None and months is None:
            total = experience_months(legacy)
        else:
            total = experience_months(years) + experience_months(months, unit="months")
        years, months = divmod(min(total, 60 * 12), 12)
        return {**data, "experience_years": years, "experience_months": months, "years_experience": round(years + months / 12, 2)}


class TransitionStep(BaseModel):
    step: str
    detail: str = ""
    timeframe: str = ""


class MatchResult(BaseModel):
    job_title: str = ""
    company: str = ""
    location: str = ""
    employment_type: str = ""
    experience_required: str = ""
    salary_range: str = ""
    match_score: Score
    keyword_coverage: Score = 0
    matched_skills: list[str] = []
    missing_skills: list[str] = []
    strengths: list[str] = []
    gaps: list[str] = []
    challenges: list[str] = []
    opportunities: list[str] = []
    transition_plan: list[TransitionStep] = []
    summary: str = ""


class MatchAnalysis(MatchResult):
    """What the model returns; keyword_coverage is computed server-side."""

    required_skills: list[str] = []


class SectionScore(BaseModel):
    name: str
    score: Score
    feedback: str = ""


class BulletRewrite(BaseModel):
    original: str
    improved: str


class CVReview(BaseModel):
    ats_score: Score
    overall: str = ""
    sections: list[SectionScore] = []
    bullet_rewrites: list[BulletRewrite] = []
    quick_wins: list[str] = []


class LinkedInReview(BaseModel):
    score: Score
    headline_suggestions: list[str] = []
    about_rewrite: str = ""
    keyword_suggestions: list[str] = []
    tips: list[str] = []


class CurrentRole(BaseModel):
    title: str = ""
    salary_range: str = ""


class FutureRole(CurrentRole):
    timeframe: str = ""


class SkillToBuild(BaseModel):
    skill: str
    why: str = ""
    resource: str = ""


# roadmap.sh guides the model may link to. Each returned HTTP 200 on 2026-10-31 (an unknown slug returns 404).
# Links only: the roadmap content itself is written by the model, never copied from roadmap.sh.
ROADMAP_SH = {
    "ai-engineer": "AI Engineer", "machine-learning": "Machine Learning", "mlops": "MLOps",
    "forward-deployed-engineer": "Forward Deployed Engineer", "ai-data-scientist": "AI and Data Scientist",
    "data-analyst": "Data Analyst", "data-engineer": "Data Engineer", "python": "Python", "sql": "SQL",
    "backend": "Backend", "frontend": "Frontend", "full-stack": "Full Stack", "devops": "DevOps", "docker": "Docker",
    "kubernetes": "Kubernetes", "aws": "AWS", "system-design": "System Design", "software-architect": "Software Architect",
    "product-manager": "Product Manager", "engineering-manager": "Engineering Manager", "cyber-security": "Cyber Security",
    "ux-design": "UX Design", "qa": "QA", "android": "Android", "ios": "iOS", "react": "React", "nodejs": "Node.js",
    "java": "Java", "golang": "Go", "prompt-engineering": "Prompt Engineering", "git-github": "Git and GitHub",
    "linux": "Linux", "computer-science": "Computer Science", "api-design": "API Design", "postgresql-dba": "PostgreSQL",
    "mongodb": "MongoDB", "terraform": "Terraform", "blockchain": "Blockchain", "game-developer": "Game Developer",
    "technical-writer": "Technical Writer", "devrel": "Developer Relations",
}
_ROADMAP_URL = re.compile(r"(?:https?://)?(?:www\.)?roadmap\.sh/([a-z0-9-]+)/?")


def roadmap_slug(value) -> str | None:
    """An allow-listed slug from 'sql', 'https://roadmap.sh/sql' or {'slug': 'sql'}; anything else is None."""
    if isinstance(value, dict):
        value = value.get("slug") or value.get("url") or ""
    text = str(value or "").strip().lower()
    if found := _ROADMAP_URL.fullmatch(text):
        text = found.group(1)
    return text if text in ROADMAP_SH else None


def roadmap_url(slug: str | None) -> str | None:
    return f"https://roadmap.sh/{slug}" if slug else None


# Skill names (normalised: lowercase, punctuation as spaces) that point at a guide; slugs and names are added below.
_SKILL_ALIASES = {
    "git": "git-github", "github": "git-github", "k8s": "kubernetes", "postgres": "postgresql-dba",
    "postgresql": "postgresql-dba", "ci cd": "mlops", "mlops": "mlops", "node": "nodejs", "node js": "nodejs",
    "go": "golang", "amazon web services": "aws", "llm": "ai-engineer", "llms": "ai-engineer",
}
_SKILL_TERMS = sorted(
    {**{re.sub(r"[^a-z0-9]+", " ", n.lower()).strip(): s for s, n in ROADMAP_SH.items()},
     **{s.replace("-", " "): s for s in ROADMAP_SH}, **_SKILL_ALIASES}.items(),
    key=lambda kv: -len(kv[0]),
)


def skill_roadmap(skill: str) -> str | None:
    """The allow-listed guide a skill names (whole words, longest term first): 'Linux' -> linux,
    'MLOps CI/CD pipelines' -> mlops. None when the skill has no guide of its own."""
    text = f" {re.sub(r'[^a-z0-9]+', ' ', skill.lower()).strip()} "
    return next((slug for term, slug in _SKILL_TERMS if f" {term} " in text), None)


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


class RoadmapSh(BaseModel):
    slug: str
    name: str
    url: str


def _roadmap_sh(value):
    slug = roadmap_slug(value)
    return {"slug": slug, "name": ROADMAP_SH[slug], "url": roadmap_url(slug)} if slug else None


class RoadmapItem(BaseModel):
    id: str = ""
    skill: str
    status: Annotated[
        Literal["have", "next", "later"],
        BeforeValidator(lambda v: str(v).strip().lower() if str(v).strip().lower() in ("have", "next", "later") else "next"),
    ] = "next"
    why: str = ""
    project: str = ""
    estimate: str = ""
    roadmap_sh_url: Annotated[str | None, BeforeValidator(lambda v: roadmap_url(roadmap_slug(v)))] = None


class RoadmapStage(BaseModel):
    name: str
    items: list[RoadmapItem] = []


class Roadmap(BaseModel):
    title: str = ""
    roadmap_sh: Annotated[RoadmapSh | None, BeforeValidator(_roadmap_sh)] = None
    stages: list[RoadmapStage] = []

    @model_validator(mode="after")
    def _links_and_ids(self):
        """Stable, unique item ids (the app stores progress by id); skills without their own guide link the role's."""
        seen: set[str] = set()
        for stage in self.stages:
            for item in stage.items:
                base = _slugify(item.skill) or _slugify(item.id) or "item"  # by skill, so progress survives regeneration
                item.id, n = base, 2
                while item.id in seen:
                    item.id, n = f"{base}-{n}", n + 1
                seen.add(item.id)
                if not item.roadmap_sh_url:
                    item.roadmap_sh_url = roadmap_url(skill_roadmap(item.skill))
                if not item.roadmap_sh_url and self.roadmap_sh:
                    item.roadmap_sh_url = self.roadmap_sh.url
        return self


class CareerPath(BaseModel):
    current: CurrentRole
    next: FutureRole
    future: FutureRole
    skills_to_build: list[SkillToBuild] = []
    career_score: Score
    rationale: str = ""
    roadmap: Roadmap = Field(default_factory=Roadmap)

    @model_validator(mode="after")
    def _names_next_role(self):
        if not self.next.title.strip():
            raise ValueError("next.title must name a role")  # complete_json retries invalid output once
        return self


# Job import from a link
class JobImport(BaseModel):
    title: str = ""
    company: str = ""
    location: str = ""
    employment_type: str = ""
    experience_required: str = ""
    salary: str = ""
    description: str = ""
    url: str = ""
    source: Literal["linkedin", "naukri", "jsonld", "text"] = "text"
    posted_at: str | None = None


class JobFields(BaseModel):
    """What the model extracts from a job page's text."""

    title: str = ""
    company: str = ""
    location: str = ""
    employment_type: str = ""
    experience_required: str = ""
    salary: str = ""


class JobImportRequest(BaseModel):
    url: Annotated[str, Field(min_length=1, max_length=2048)]


# ATS checker
class ResumeMeta(BaseModel):
    pages: int = Field(0, ge=0)
    images: int = Field(0, ge=0)
    fonts: int = Field(0, ge=0)
    has_text_layer: bool = True
    avg_chars_per_page: int = Field(0, ge=0)
    suspected_columns: bool = False
    suspected_tables: bool = False
    file_name: Annotated[str, Field(max_length=255)] | None = None


class ATSRequest(BaseModel):
    resume: RequiredText
    job_description: Text = ""
    meta: ResumeMeta | None = None


class ATSInsights(BaseModel):
    """What the model adds to the deterministic checks."""

    job_title: str = ""
    title_match: bool = False
    required_skills: list[str] = []
    preferred_skills: list[str] = []
    content_notes: list[str] = []
    summary: str = ""


class ATSCheck(BaseModel):
    id: str
    category: Literal["parsing", "sections", "contact", "formatting", "keywords", "content"]
    label: str
    status: Literal["pass", "warn", "fail"]
    detail: str = ""
    fix: str | None = None


class TermCount(BaseModel):
    term: str
    jd_count: int
    resume_count: int


class ATSKeywords(BaseModel):
    title_match: bool
    required_found: list[str] = []
    required_missing: list[str] = []
    preferred_found: list[str] = []
    preferred_missing: list[str] = []
    top_terms: list[TermCount] = []


class ATSFix(BaseModel):
    priority: Literal["high", "medium", "low"]
    text: str


class ATSResult(BaseModel):
    score: int
    grade: Literal["Excellent", "Good", "Fair", "Needs work"]
    summary: str
    checks: list[ATSCheck]
    keywords: ATSKeywords | None = None
    fixes: list[ATSFix] = []
    categories: dict[str, int] = {}  # per-category score 0-100, for the score bars
    note: str | None = None  # set when the AI part was unavailable


class InterviewQuestion(BaseModel):
    question: str
    type: Annotated[
        Literal["behavioral", "technical", "situational"],
        BeforeValidator(lambda v: str(v).strip().lower()),
    ]
    what_they_look_for: str = ""


class InterviewQuestions(BaseModel):
    questions: list[InterviewQuestion]


class InterviewFeedback(BaseModel):
    score: Score
    strengths: list[str] = []
    improvements: list[str] = []
    improved_answer: str = ""


class CoverLetter(BaseModel):
    cover_letter: str


class Ping(BaseModel):
    ok: bool


# Requests
class ProfileRequest(BaseModel):
    resume: RequiredText


class MatchRequest(BaseModel):
    resume: RequiredText
    job_description: RequiredText


class CVReviewRequest(BaseModel):
    resume: RequiredText
    target_role: Text = ""


class LinkedInRequest(BaseModel):
    headline: Text = ""
    about: Text = ""
    experience: Text = ""


class CareerPathRequest(BaseModel):
    resume: RequiredText
    current_role: Text = ""
    target_role: Text = ""
    location: Text = ""
    currency: Literal["INR", "USD", "GBP", "EUR"] = "INR"


class InterviewQuestionsRequest(BaseModel):
    resume: RequiredText
    job_description: RequiredText
    count: int = Field(8, ge=1, le=15)


class InterviewFeedbackRequest(BaseModel):
    question: RequiredText
    answer: RequiredText
    job_description: Text = ""


class CoverLetterRequest(BaseModel):
    resume: RequiredText
    job_description: RequiredText
    tone: Literal["professional", "enthusiastic", "concise"] = "professional"


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

BASE_RULES = (
    "You are a precise career advisor. Be concise and factual. Ground every statement "
    "only in the text provided. Never invent employers, job titles, dates, degrees, "
    "certifications or other credentials. If information is not present, use an empty "
    "string or empty list. Scores are integers from 0 to 100."
)

PROMPTS = {
    "verify": "Reply with the JSON object {\"ok\": true}.",
    "profile": "Extract a candidate profile from the resume. Report total professional experience "
    "estimated from the listed roles as two integers: experience_years and experience_months (0 to 11); "
    "do not fill years_experience. skills is a deduplicated list of concrete skills. "
    "current_role is the job title only, without the employer.",
    "match": "Compare the resume against the job description. Extract job details from the "
    "job description (salary_range is an empty string if not stated). match_score reflects "
    "overall fit. required_skills lists the concrete skills and tools the job requires. "
    "matched_skills and missing_skills compare those against the resume. challenges and "
    "opportunities describe the candidate's position for this role. transition_plan gives "
    "3 to 5 practical steps to close the gaps.",
    "cv_review": "Review the resume for ATS compatibility and impact. ats_score rates "
    "parseability, keywords and structure. Score each major section present. Provide up to "
    "5 bullet_rewrites quoting original bullets verbatim and improving them without adding "
    "facts. quick_wins are short, actionable fixes.",
    "linkedin": "Review the LinkedIn profile text. Provide 3 headline_suggestions, an "
    "improved about_rewrite using only facts given, relevant keyword_suggestions and "
    "practical tips.",
    "career_path": "Suggest a realistic career path from the candidate's current role. "
    "Salary ranges are rough market estimates in the requested currency for the given "
    "location. Every salary_range, including current, is an estimate for the location and "
    "must not be empty; prefix it with the currency symbol or code (e.g. ₹18-25 LPA). "
    "career_score rates how well positioned the candidate is to progress. "
    "next must name the next role and future must name a role 3-5 years out; neither title may be empty. "
    "skills_to_build lists 3 to 6 skills with a reason and a type of learning resource. "
    "roadmap is a personalised learning plan towards the next and future roles, written for this "
    "candidate: a title and 3 to 5 stages in order (for example Foundations, Core, Specialise, "
    "Production, Lead), each with 2 to 5 items. Each item has skill, status ('have' when the resume "
    "already shows it, 'next' for the immediate priorities, 'later' for the rest), why (one sentence), "
    "project (a small practical project that proves the skill), and estimate (for example '2-3 weeks'). "
    "roadmap.roadmap_sh is the one slug from this list that best fits the target role, or null if none "
    "fits; an item's roadmap_sh_url is a slug from the same list only when that skill has its own guide, "
    "else null. For AI, machine learning, data science, LLM or GenAI targets prefer ai-engineer "
    "(applied AI and LLM engineering), machine-learning (ML engineering and modelling), mlops "
    "(deployment and ML platforms) or forward-deployed-engineer (customer-facing solutions and field "
    "engineering). Allowed slugs: " + ", ".join(ROADMAP_SH) + ".",
    "interview_questions": "Generate interview questions for this candidate and job. Mix "
    "behavioral, technical and situational types. what_they_look_for explains what a strong "
    "answer demonstrates.",
    "interview_feedback": "Evaluate the candidate's answer to the interview question. "
    "improved_answer rewrites it in a stronger structure without inventing experience.",
    "cover_letter": "Write a cover letter of at most 350 words for this job using only "
    "experience from the resume. Use plain paragraphs with no placeholders in brackets.",
    "job_import": "The text was read from a job posting web page and may include navigation or "
    "unrelated content. Extract the posting's details exactly as stated: title, company, location, "
    "employment_type, experience_required (e.g. '3-5 years') and salary (as written, empty if not "
    "stated). Use empty strings for anything not present.",
    "ats": "Assess the resume as an applicant tracking system and recruiter would. If a job "
    "description is given: job_title is its title, title_match is true when the resume's recent "
    "titles fit that role, required_skills and preferred_skills list the concrete skills, tools and "
    "qualifications the job asks for (short terms as written in the job description, at most 15 "
    "each). Without a job description, leave those empty and title_match false. content_notes gives "
    "up to 5 specific improvements to the resume's content. summary is two sentences on overall "
    "ATS readiness.",
}

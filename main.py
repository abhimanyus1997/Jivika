"""Jivika API: a stateless, bring-your-own-key career toolkit.

The server never stores API keys or user data. Every AI request carries the
caller's provider, key and (optional) model in headers and is forwarded to an
OpenAI-compatible endpoint.
"""

import io
import json
import logging
import math
import mimetypes
import os
import re
from pathlib import Path
from typing import Annotated, Literal

import openai
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, ValidationError
from pypdf import PdfReader
from pypdf.errors import PdfReadError

load_dotenv()
mimetypes.add_type("text/javascript", ".js")  # Windows registry may map .js to text/plain

log = logging.getLogger("jivika")

MAX_TEXT_CHARS = 30_000
MAX_UPLOAD_BYTES = int(float(os.getenv("JIVIKA_MAX_UPLOAD_MB", "10")) * 1024 * 1024)
MAX_BODY_OVERHEAD = 64 * 1024  # multipart framing on top of the file itself
DIST_DIR = Path(__file__).parent / "frontend" / "dist"

PROVIDERS = {
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.5-flash",
        "key_url": "https://aistudio.google.com/apikey",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4.1-mini",
        "key_url": "https://platform.openai.com/api-keys",
    },
    "groq": {
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
        "key_url": "https://console.groq.com/keys",
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "openai/gpt-4.1-mini",
        "key_url": "https://openrouter.ai/keys",
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


def _first_number(value):
    """Accept '5+', '3 years' or 4.5 from the model; fall back to 0."""
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else 0
    found = re.search(r"\d+(?:\.\d+)?", str(value or ""))
    return float(found.group()) if found else 0


Score = Annotated[int, BeforeValidator(_clamp_score)]
Text = Annotated[str, AfterValidator(lambda s: s.strip()[:MAX_TEXT_CHARS])]
RequiredText = Annotated[Text, Field(min_length=1)]


# Responses (also the schemas the model must follow). Defaults keep validation
# tolerant of a model omitting an optional list or string.
class Profile(BaseModel):
    name: str = ""
    headline: str = ""
    current_role: str = ""
    years_experience: Annotated[float, BeforeValidator(_first_number)] = 0
    location: str = ""
    skills: list[str] = []
    summary: str = ""


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


class CareerPath(BaseModel):
    current: CurrentRole
    next: FutureRole
    future: FutureRole
    skills_to_build: list[SkillToBuild] = []
    career_score: Score
    rationale: str = ""


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
    "profile": "Extract a candidate profile from the resume. years_experience is a number "
    "estimated from the listed roles. skills is a deduplicated list of concrete skills.",
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
    "location. career_score rates how well positioned the candidate is to progress. "
    "skills_to_build lists 3 to 6 skills with a reason and a type of learning resource.",
    "interview_questions": "Generate interview questions for this candidate and job. Mix "
    "behavioral, technical and situational types. what_they_look_for explains what a strong "
    "answer demonstrates.",
    "interview_feedback": "Evaluate the candidate's answer to the interview question. "
    "improved_answer rewrites it in a stronger structure without inventing experience.",
    "cover_letter": "Write a cover letter of at most 350 words for this job using only "
    "experience from the resume. Use plain paragraphs with no placeholders in brackets.",
}


# ---------------------------------------------------------------------------
# LLM access
# ---------------------------------------------------------------------------


class LLMConfig(BaseModel):
    provider: str
    key: str
    model: str


def byok(
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
) -> LLMConfig:
    if not x_llm_key.strip():
        raise HTTPException(401, "An API key is required. Add one in Settings.")
    provider = x_llm_provider.strip().lower()
    if provider not in PROVIDERS:
        raise HTTPException(400, "Unknown provider.")
    key = x_llm_key.strip()
    # Header values are forwarded to the provider and must be printable ASCII.
    if not (key.isascii() and key.isprintable()):
        raise HTTPException(401, "The API key format is invalid.")
    model = x_llm_model.strip() or PROVIDERS[provider]["default_model"]
    if not (model.isascii() and model.isprintable()):
        raise HTTPException(400, "The model name is invalid.")
    return LLMConfig(provider=provider, key=key, model=model)


def _is_auth_error(exc: openai.APIError) -> bool:
    if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return True
    # Gemini reports invalid keys as 400 "API key not valid".
    return isinstance(exc, openai.BadRequestError) and "api key" in str(exc).lower()


def complete_json(provider: str, key: str, model: str, system: str, user: str, schema_model):
    """Call the provider once (plus one retry on invalid output) and return a validated model."""
    name = PROVIDERS[provider]["name"]
    client = OpenAI(api_key=key, base_url=PROVIDERS[provider]["base_url"], timeout=90, max_retries=1)
    schema = json.dumps(schema_model.model_json_schema())
    messages = [
        {
            "role": "system",
            "content": f"{BASE_RULES}\n\n{system}\n\nRespond with a single JSON object that "
            f"conforms to this JSON schema:\n{schema}",
        },
        {"role": "user", "content": user},
    ]
    for _ in range(2):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.3,
            )
        except openai.APIError as exc:
            if _is_auth_error(exc):
                raise HTTPException(401, f"The API key was rejected by {name}.") from None
            if isinstance(exc, openai.RateLimitError):
                raise HTTPException(429, f"Rate limit reached at {name}. Please wait and retry.") from None
            log.warning("Provider %s error: %s", provider, type(exc).__name__)
            raise HTTPException(502, "The model provider returned an error.") from None
        content = (response.choices[0].message.content or "") if response.choices else ""
        try:
            return schema_model.model_validate_json(_strip_fences(content))
        except ValidationError:
            log.info("Invalid JSON from %s, retrying once", provider)
    raise HTTPException(502, "The model returned an invalid response. Please try again.")


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    return text


def ask(cfg: LLMConfig, task: str, schema_model, **sections: str):
    user = "\n\n".join(f"## {label.replace('_', ' ').title()}\n{value}" for label, value in sections.items() if value)
    return complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS[task], user, schema_model)


# ---------------------------------------------------------------------------
# Keyword coverage (deterministic, no LLM)
# ---------------------------------------------------------------------------

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


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) >= 3 and t not in STOPWORDS}


def keyword_coverage(resume: str, job_description: str, required_skills: list[str]) -> int:
    # Simple bag-of-words overlap, no stemming; swap in a lemmatizer if plurals skew scores
    resume_lower = resume.lower()
    resume_tokens = _tokens(resume)
    terms = _tokens(job_description)
    skills = {s.strip().lower() for s in required_skills if s.strip()}
    if not terms and not skills:
        return 0
    hits = len(terms & resume_tokens) + sum(1 for s in skills - terms if s in resume_lower)
    return round(100 * hits / len(terms | skills))


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Jivika", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

if origins := [o.strip() for o in os.getenv("JIVIKA_CORS_ORIGINS", "").split(",") if o.strip()]:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

class BodySizeLimit:
    """Reject oversized request bodies before they are read or spooled to disk."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = MAX_UPLOAD_BYTES + MAX_BODY_OVERHEAD
        detail = "The request is too large."
        length = dict(scope["headers"]).get(b"content-length", b"")
        if length.isdigit() and int(length) > limit:
            return await JSONResponse({"detail": detail}, 413)(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:  # chunked bodies without Content-Length
                    raise HTTPException(413, detail)
            return message

        await self.app(scope, limited_receive, send)


app.add_middleware(BodySizeLimit)

BYOK = Annotated[LLMConfig, Depends(byok)]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/providers")
def providers():
    return [
        {"id": pid, "name": p["name"], "default_model": p["default_model"], "key_url": p["key_url"]}
        for pid, p in PROVIDERS.items()
    ]


@app.post("/api/providers/verify")
def verify(cfg: BYOK):
    complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS["verify"], "Ping", Ping)
    return {"ok": True, "model": cfg.model}


@app.post("/api/resume/parse")
async def parse_resume(file: UploadFile = File(...)):
    # Some browsers send PDFs as octet-stream or untyped; the magic-byte check decides.
    content_type = (file.content_type or "").lower()
    if content_type not in ("", "application/octet-stream") and not content_type.endswith("/pdf"):
        raise HTTPException(415, "Please upload a PDF file.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"The PDF exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "The file is not a valid PDF.")
    # PDF parsing is CPU-bound; keep it off the event loop.
    text, pages = await run_in_threadpool(_extract_pdf_text, data)
    if not text:
        raise HTTPException(422, "No text found in the PDF. Scanned documents are not supported.")
    text = text[:MAX_TEXT_CHARS]
    return {"text": text, "pages": pages, "characters": len(text)}


def _extract_pdf_text(data: bytes) -> tuple[str, int]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise HTTPException(400, "Password-protected PDFs are not supported.")
        text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        return text, len(reader.pages)
    except (PdfReadError, ValueError, KeyError, TypeError):
        raise HTTPException(400, "The PDF could not be read.") from None


@app.post("/api/resume/profile", response_model=Profile)
def resume_profile(body: ProfileRequest, cfg: BYOK):
    return ask(cfg, "profile", Profile, resume=body.resume)


@app.post("/api/match", response_model=MatchResult)
def match(body: MatchRequest, cfg: BYOK):
    analysis = ask(cfg, "match", MatchAnalysis, resume=body.resume, job_description=body.job_description)
    coverage = keyword_coverage(body.resume, body.job_description, analysis.required_skills)
    result = MatchResult.model_validate(analysis.model_dump(exclude={"required_skills"}))
    result.keyword_coverage = coverage
    result.match_score = round(0.7 * analysis.match_score + 0.3 * coverage)
    return result


@app.post("/api/cv/review", response_model=CVReview)
def cv_review(body: CVReviewRequest, cfg: BYOK):
    return ask(cfg, "cv_review", CVReview, target_role=body.target_role, resume=body.resume)


@app.post("/api/linkedin/review", response_model=LinkedInReview)
def linkedin_review(body: LinkedInRequest, cfg: BYOK):
    if not (body.headline or body.about):
        raise HTTPException(422, "Provide a headline or an about section.")
    return ask(cfg, "linkedin", LinkedInReview, headline=body.headline, about=body.about, experience=body.experience)


@app.post("/api/career/path", response_model=CareerPath)
def career_path(body: CareerPathRequest, cfg: BYOK):
    return ask(
        cfg,
        "career_path",
        CareerPath,
        currency=body.currency,
        location=body.location,
        current_role=body.current_role,
        target_role=body.target_role,
        resume=body.resume,
    )


@app.post("/api/interview/questions", response_model=InterviewQuestions)
def interview_questions(body: InterviewQuestionsRequest, cfg: BYOK):
    result = ask(
        cfg,
        "interview_questions",
        InterviewQuestions,
        number_of_questions=str(body.count),
        job_description=body.job_description,
        resume=body.resume,
    )
    result.questions = result.questions[: body.count]
    return result


@app.post("/api/interview/feedback", response_model=InterviewFeedback)
def interview_feedback(body: InterviewFeedbackRequest, cfg: BYOK):
    return ask(
        cfg,
        "interview_feedback",
        InterviewFeedback,
        job_description=body.job_description,
        question=body.question,
        answer=body.answer,
    )


@app.post("/api/cover-letter", response_model=CoverLetter)
def cover_letter(body: CoverLetterRequest, cfg: BYOK):
    return ask(cfg, "cover_letter", CoverLetter, tone=body.tone, job_description=body.job_description, resume=body.resume)


# ---------------------------------------------------------------------------
# Frontend (production build)
# ---------------------------------------------------------------------------

if DIST_DIR.is_dir():
    if (DIST_DIR / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        candidate = (DIST_DIR / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(DIST_DIR.resolve()):
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")

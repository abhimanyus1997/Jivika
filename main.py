"""Jivika API: a bring-your-own-key career toolkit plus the public site.

The server never stores API keys or resume data. Every AI request carries the
caller's provider, key and (optional) model in headers and is forwarded to an
OpenAI-compatible endpoint. Without a key, an optional owner-supplied Groq key
(demo mode) serves a limited number of requests. Server-side state is the Pro
waitlist and demo counters (SQLite or Upstash Redis, else memory) plus short-lived
job search, model list and salary caches. Providers, schemas and prompts live in
jivika/schemas.py, job search in jivika/jobs.py, job import from links in
jivika/importer.py, ATS checks in jivika/ats.py, live model lists in jivika/models.py,
market salary data in jivika/salary.py, verified learning resources in jivika/resources.py,
coding practice problems in jivika/coding.py and resume file parsing in jivika/parsing.py.
"""

import csv
import hmac
import io
import ipaddress
import json
import logging
import mimetypes
import os
import re
import sqlite3
import threading
import time
import http.client
import urllib.request
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

import openai
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from openai import OpenAI
from pydantic import AfterValidator, BaseModel, Field, ValidationError
from jivika import ats, coding, importer, jobs, parsing, resources, salary
from jivika import models as model_lists
from jivika.ats import STOPWORDS, tokens as _tokens  # noqa: F401  (keyword coverage shares the ATS tokenizer)
from jivika.schemas import (  # noqa: F401  (re-exported for tests and callers)
    ATSInsights,
    ATSRequest,
    ATSResult,
    BASE_RULES,
    BulletRewrite,
    CVReview,
    CVReviewRequest,
    CareerPath,
    CareerPathRequest,
    CodingDraft,
    CodingProblems,
    CodingRequest,
    CodingReview,
    CodingReviewRequest,
    CoverLetter,
    CoverLetterDraft,
    CoverLetterRequest,
    Letter,
    CurrentRole,
    FutureRole,
    InterviewFeedback,
    InterviewFeedbackRequest,
    InterviewQuestion,
    InterviewQuestions,
    InterviewQuestionsRequest,
    JobFields,
    JobImport,
    JobImportRequest,
    LinkedInRequest,
    LinkedInReview,
    MatchAnalysis,
    MatchRequest,
    MatchResult,
    PROMPTS,
    PROVIDERS,
    Ping,
    Profile,
    ProfileRequest,
    ROADMAP_SH,
    RequiredText,
    ResolveRequest,
    ResumeMeta,
    Roadmap,
    Score,
    SectionScore,
    SkillToBuild,
    Text,
    TransitionStep,
    MAX_TEXT_CHARS,
)

load_dotenv()
mimetypes.add_type("text/javascript", ".js")  # Windows registry may map .js to text/plain

log = logging.getLogger("jivika")

MAX_UPLOAD_BYTES = int(float(os.getenv("JIVIKA_MAX_UPLOAD_MB", "10")) * 1024 * 1024)
MAX_BODY_OVERHEAD = 64 * 1024  # multipart framing on top of the file itself
DIST_DIR = Path(__file__).parent / "frontend" / "dist"


def upload_too_large() -> str:
    return f"The PDF is larger than {MAX_UPLOAD_BYTES / (1024 * 1024):g} MB."


# ---------------------------------------------------------------------------
# LLM access
# ---------------------------------------------------------------------------


@dataclass
class LLMConfig:
    provider: str
    key: str
    model: str
    # Demo requests are charged in ask(), only when the provider is actually called (not on 422s).
    demo_ip: str | None = None
    response: Response | None = None


def byok(
    request: Request,
    response: Response,
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
) -> LLMConfig:
    if not x_llm_key.strip():
        if key := demo_key():
            # Demo mode: the owner's Groq key and model, whatever provider or model the client sent.
            return LLMConfig(provider=DEMO_PROVIDER, key=key, model=demo_model(), demo_ip=client_ip(request), response=response)
        raise HTTPException(401, "An API key is required. Add one in Settings.")
    provider = x_llm_provider.strip().lower()
    if provider not in PROVIDERS:
        raise HTTPException(400, "Unknown provider.")
    key = x_llm_key.strip()
    # Header values are forwarded to the provider and must be printable ASCII.
    if not (key.isascii() and key.isprintable()):
        raise HTTPException(401, "The API key format is invalid.")
    # No model chosen: the live list's recommendation for this key if it was listed recently, else the static default.
    model = x_llm_model.strip() or model_lists.cached_recommended(provider, key) or PROVIDERS[provider]["default_model"]
    if not (model.isascii() and model.isprintable()):
        raise HTTPException(400, "The model name is invalid.")
    return LLMConfig(provider=provider, key=key, model=model)


def optional_llm(
    request: Request,
    response: Response,
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
) -> LLMConfig | None:
    """Like byok, but None (instead of 401) when there is neither a user key nor demo mode."""
    if not x_llm_key.strip() and not demo_key():
        return None
    try:
        return byok(request, response, x_llm_provider, x_llm_key, x_llm_model)
    except HTTPException as exc:
        if exc.status_code == 400:  # unknown or blank provider: fall back to the no-model result
            return None
        raise


def _is_auth_error(exc: openai.APIError) -> bool:
    if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
        return True
    # Gemini reports invalid keys as 400 "API key not valid".
    return isinstance(exc, openai.BadRequestError) and "api key" in str(exc).lower()


# Output budgets for tasks with long answers; provider defaults (often 8k tokens with reasoning) truncate them.
TASK_MAX_TOKENS = {"coding_problems": 16_000}
_JSON_FAILED = re.compile(r"failed to (?:validate|generate) json", re.I)


def complete_json(provider: str, key: str, model: str, system: str, user: str, schema_model, max_tokens: int | None = None):
    """Call the provider once (plus one retry on invalid output) and return a validated model. max_tokens raises
    the output budget; a model that rejects it is retried once without it."""
    spec = PROVIDERS[provider]
    name = spec["name"]
    client = OpenAI(api_key=key, base_url=spec["base_url"], timeout=60, max_retries=1)  # worst case ~240 s with the JSON retry, under Vercel's 300 s
    options = dict(spec.get("extra", {}))
    if spec["json_mode"]:
        options["response_format"] = {"type": "json_object"}
    if spec["temperature"]:
        options["temperature"] = 0.3
    if max_tokens:
        options["max_completion_tokens"] = max_tokens
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
            response = client.chat.completions.create(model=model, messages=messages, **options)
        except openai.APIError as exc:
            if _is_auth_error(exc):
                raise HTTPException(401, f"The API key was rejected by {name}.") from None
            if isinstance(exc, openai.RateLimitError):
                raise HTTPException(429, f"Rate limit reached at {name}. Please wait and retry.") from None
            if isinstance(exc, openai.BadRequestError) and _JSON_FAILED.search(str(exc)):
                log.info("Provider %s rejected its own JSON, retrying once", provider)  # Groq json_validate_failed
                continue
            if isinstance(exc, openai.BadRequestError) and max_tokens and "token" in str(exc).lower():
                log.info("Provider %s rejected the output budget, retrying without it", provider)
                options.pop("max_completion_tokens", None)
                max_tokens = None
                continue
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
    budget = {"max_tokens": TASK_MAX_TOKENS[task]} if task in TASK_MAX_TOKENS else {}
    if cfg.demo_ip is None:
        return complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS[task], user, schema_model, **budget)
    remaining = use_demo(cfg.demo_ip)
    if cfg.response is not None:
        cfg.response.headers.update({"X-Jivika-Demo": "1", "X-Jivika-Demo-Remaining": str(remaining)})
    try:
        return complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS[task], user, schema_model, **budget)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        log.error("Demo key rejected by %s", PROVIDERS[cfg.provider]["name"])  # never the key
        raise HTTPException(503, DEMO_UNAVAILABLE) from None


# ---------------------------------------------------------------------------
# Demo mode: the owner's Groq key for visitors without a key, with usage limits
# ---------------------------------------------------------------------------

DEMO_PROVIDER = "groq"
DEMO_LIMIT_REACHED = "Demo limit reached. Add your own API key in Settings to keep going."
DEMO_UNAVAILABLE = "The demo model is unavailable right now. Add your own API key in Settings."
DEMO_MAX_KEYS = 10_000
_demo_counts: dict[str, int] = {}
_demo_lock = threading.Lock()


def demo_key() -> str:
    return os.getenv("JIVIKA_DEMO_GROQ_KEY", "").strip()


def demo_model() -> str:
    """JIVIKA_DEMO_MODEL, else the recommended model from Groq's live list (cached an hour), else the static default."""
    if model := os.getenv("JIVIKA_DEMO_MODEL", "").strip():
        return model
    if key := demo_key():
        return model_lists.list_models(DEMO_PROVIDER, key)["recommended"]
    return PROVIDERS[DEMO_PROVIDER]["default_model"]


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, "")))
    except ValueError:
        return default


def demo_limits() -> tuple[int, int]:
    """(per-IP hourly, global daily) demo request limits."""
    return _env_int("JIVIKA_DEMO_HOURLY_LIMIT", 20), _env_int("JIVIKA_DEMO_DAILY_LIMIT", 500)


def _demo_windows(ip: str) -> tuple[str, str]:
    """Fixed-window counter keys: this clock hour for the IP (IPv6 bucketed by /64), this UTC day for everyone."""
    try:
        addr = ipaddress.ip_address(ip)
        if addr.version == 6:
            ip = str(ipaddress.ip_network(f"{addr}/64", strict=False))
    except ValueError:
        pass
    now = int(time.time())
    return f"jivika:demo:ip:{ip}:{now // 3600}", f"jivika:demo:day:{now // 86400}"


def _demo_count(key: str, ttl: int, increment: bool) -> int | None:
    """SET NX EX then INCR in Upstash Redis when configured (the TTL exists before the count), else memory. None if unknown."""
    if config := redis_config():
        try:
            if not increment:
                return int(redis_http(*config, ["GET", key]).get("result") or 0)
            redis_http(*config, ["SET", key, "0", "EX", str(ttl), "NX"])
            return int(redis_http(*config, ["INCR", key])["result"])
        except (OSError, ValueError, KeyError, TypeError, AttributeError, http.client.HTTPException) as exc:
            log.warning("Demo limiter store error: %s; using memory", type(exc).__name__)
            if not increment:
                return None
    # ponytail: per-process memory; Redis (above) is what keeps limits shared across instances
    with _demo_lock:
        if not increment:
            return _demo_counts.get(key, 0)
        count = _demo_counts.pop(key, 0) + 1
        _demo_counts[key] = count  # re-inserted last, so the oldest windows are evicted first
        while len(_demo_counts) > DEMO_MAX_KEYS:
            del _demo_counts[next(iter(_demo_counts))]
        return count


def use_demo(ip: str) -> int:
    """Count one demo request; 429 when over a limit. Returns the runs left for this IP this hour."""
    hourly, daily = demo_limits()
    ip_key, day_key = _demo_windows(ip)
    over = HTTPException(429, DEMO_LIMIT_REACHED, headers={"X-Jivika-Demo": "1", "X-Jivika-Demo-Remaining": "0"})
    used = _demo_count(ip_key, 3600, True)
    if used > hourly:
        raise over
    used_today = _demo_count(day_key, 86400, True)
    if used_today > daily:
        raise over
    return max(0, min(hourly - used, daily - used_today))


def demo_remaining(ip: str) -> int | None:
    hourly, daily = demo_limits()
    ip_key, day_key = _demo_windows(ip)
    used, used_today = _demo_count(ip_key, 3600, False), _demo_count(day_key, 86400, False)
    if used is None or used_today is None:
        return None
    return max(0, min(hourly - used, daily - used_today))


# ---------------------------------------------------------------------------
# Keyword coverage (deterministic, no LLM)
# ---------------------------------------------------------------------------

def keyword_coverage(resume: str, job_description: str, required_skills: list[str]) -> int:
    # Simple bag-of-words overlap, no stemming; swap in a lemmatizer if plurals skew scores
    # Over the model's required skills when there are any, so long JDs do not dilute the score.
    resume_lower = resume.lower()
    skills = {s.strip().lower() for s in required_skills if s.strip()}
    if skills:
        return round(100 * sum(1 for s in skills if s in resume_lower) / len(skills))
    terms = _tokens(job_description)
    return round(100 * len(terms & _tokens(resume)) / len(terms)) if terms else 0


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
        detail = upload_too_large() if scope["path"].endswith("/api/resume/parse") else "The request is too large."
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


def base_path() -> str:
    """JIVIKA_BASE_PATH, e.g. '/jivika', normalised to a leading slash and no trailing slash ('' at root)."""
    value = os.getenv("JIVIKA_BASE_PATH", "").strip("/")
    return f"/{value}" if value else ""


class BasePath:
    """Serve the whole app under JIVIKA_BASE_PATH. Requests outside it redirect into it, so '/' and '/jivika' go to '/jivika/'."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        base = base_path()
        if not base or scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        if path == base:
            # Served, not redirected: a proxy rewrite may drop the trailing slash, and a 308 back would loop.
            path = scope["path"] = base + "/"
        if path.startswith(base + "/"):
            # Routing strips root_path from path, so every route and redirect stays prefix-relative.
            return await self.app({**scope, "root_path": scope.get("root_path", "") + base}, receive, send)
        target = base + "/" if path in ("/", base) else base + path
        query = scope.get("query_string", b"").decode("latin-1")
        await RedirectResponse(f"{target}?{query}" if query else target, 308)(scope, receive, send)


app.add_middleware(BasePath)

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"x-frame-options", b"DENY"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
]
_CSP_REST = (
    b"style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
    b"frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)
CSP = (b"content-security-policy", b"default-src 'self'; script-src 'self'; " + _CSP_REST)
# The app (/app/*) runs the coding playground in Web Workers. Its pages may compile WebAssembly
# ('wasm-unsafe-eval', for Pyodide and sql.js) and start same-origin or blob: workers; plain eval stays blocked.
CSP_APP = (b"content-security-policy", b"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " + _CSP_REST)
# A dedicated worker script is governed by the CSP of its own response, not the page's. Only worker bundles
# (built files named *worker*.js under assets/) may eval, which the JavaScript runner needs for new Function;
# workers have no DOM, cookies or storage access, and each run's worker is terminated afterwards.
CSP_WORKER = (b"content-security-policy", b"default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; " + _CSP_REST)
_WORKER_SCRIPT = re.compile(r"/assets/(?:[\w.-]+/)*[\w.-]*worker[\w.-]*\.m?js$", re.I)


def csp_for(path: str) -> tuple[bytes, bytes]:
    if _WORKER_SCRIPT.search(path):
        return CSP_WORKER
    return CSP_APP if path == "/app" or path.startswith("/app/") else CSP
HSTS = (b"strict-transport-security", b"max-age=31536000")


class SecurityHeaders:
    """Add security headers to every response. Swagger UI (/api/docs) loads from a CDN, so it skips CSP."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        extra = list(SECURITY_HEADERS)
        path = scope["path"].removeprefix(base_path())
        if not path.startswith("/api/docs"):
            extra.append(csp_for(path))
        if os.getenv("JIVIKA_HSTS") == "1":
            extra.append(HSTS)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(SecurityHeaders)  # added last, so it is outermost and also covers 413s and base-path redirects

BYOK = Annotated[LLMConfig, Depends(byok)]
OptionalLLM = Annotated[LLMConfig | None, Depends(optional_llm)]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/providers")
def providers():
    return [
        {"id": pid, "name": p["name"], "default_model": p["default_model"], "key_url": p["key_url"], "json_mode": p["json_mode"]}
        for pid, p in PROVIDERS.items()
    ]


@app.get("/api/demo")
def demo(request: Request, response: Response):
    hourly, daily = demo_limits()
    enabled = bool(demo_key())
    response.headers["Cache-Control"] = "no-store"
    return {
        "enabled": enabled,
        "provider": DEMO_PROVIDER,
        "provider_name": PROVIDERS[DEMO_PROVIDER]["name"],
        "model": demo_model(),
        "hourly_limit": hourly,
        "daily_limit": daily,
        "remaining_hourly": demo_remaining(client_ip(request)) if enabled else None,
    }


@app.post("/api/providers/verify")
def verify(
    request: Request,
    response: Response,
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
):
    if not x_llm_key.strip() and demo_key():
        # Report demo status instead of calling Groq with the shared key (and spending quota) on every check.
        return {"ok": True, "model": demo_model(), "demo": True, "provider": DEMO_PROVIDER, "remaining_hourly": demo_remaining(client_ip(request))}
    cfg = byok(request, response, x_llm_provider, x_llm_key, x_llm_model)
    complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS["verify"], "Ping", Ping)
    return {"ok": True, "model": cfg.model}


@app.get("/api/parser")
def parser_info():
    """Which resume parser is active and the file types it accepts (Docling adds DOCX, PNG and JPG)."""
    return parsing.info()


@app.post("/api/resume/parse")
async def parse_resume(file: UploadFile = File(...)):
    """Text plus layout metadata for the ATS checker (jivika/parsing.py; heuristics in jivika/ats.py)."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, upload_too_large())
    name = re.split(r"[\\/]", file.filename or "")[-1].strip()[:255]
    try:
        # Parsing is CPU-bound; keep it off the event loop. The magic bytes decide the type, since some
        # browsers send PDFs as octet-stream or untyped.
        parsed = await run_in_threadpool(parsing.parse, data, name, file.content_type or "")
    except parsing.ParseError as exc:
        raise HTTPException(exc.status, str(exc)) from None
    text = parsed["text"].strip()
    if not text:
        detail = "No text found in the PDF. Scanned documents are not supported." if parsed["parser"] == "pypdf" else "No text found in the file."
        raise HTTPException(422, detail)
    text = text[:MAX_TEXT_CHARS]
    meta = ResumeMeta(**parsed["meta"], file_name=name or None).model_dump()
    return {"text": text, "pages": meta["pages"], "characters": len(text), "meta": meta, "parser": parsed["parser"]}


def _squash(text: str) -> str:
    return re.sub(r"[\s().-]+", "", text.lower())


def _from_resume(resume: str, value: str, pattern: re.Pattern) -> str:
    """The model's contact detail only if the resume contains it, else the first match of pattern (or '')."""
    value = value.strip()
    if value and _squash(value) in _squash(resume):
        return value
    found = pattern.search(resume)
    return found.group(0).strip() if found else ""


@app.post("/api/resume/profile", response_model=Profile)
def resume_profile(body: ProfileRequest, cfg: BYOK):
    profile = ask(cfg, "profile", Profile, resume=body.resume)
    profile.email = _from_resume(body.resume, profile.email, ats.EMAIL)
    profile.phone = _from_resume(body.resume, profile.phone, ats.PHONE)
    profile.linkedin = _from_resume(body.resume, profile.linkedin, ats.LINKEDIN)
    return profile


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


_DASHES = str.maketrans({c: "-" for c in "‐‑‒–—−"} | {"’": "'"})  # Unicode dashes, curly apostrophe


def _grounded(value: str, source: str) -> str:
    """value when the source text states it (case, spacing and dash style ignored), else ''. Recipient details are never invented."""
    value = " ".join(value.split())
    norm = lambda text: " ".join(text.split()).translate(_DASHES).lower()  # noqa: E731
    return value if value and norm(value) in norm(source) else ""


@app.post("/api/cover-letter", response_model=CoverLetter)
def cover_letter(body: CoverLetterRequest, cfg: BYOK):
    given = "\n".join(f"{label}: {value}" for label, value in (
        ("Company", body.company), ("Recipient name", body.recipient_name), ("Recipient title", body.recipient_title)) if value)
    draft = ask(cfg, "cover_letter", CoverLetterDraft, tone=body.tone, provided_details=given,
                job_description=body.job_description, resume=body.resume)
    jd = body.job_description
    contact = ", ".join(filter(None, (_grounded(part, jd) for part in re.split(r"[,;|\n]+", draft.recipient_contact))))
    name = body.recipient_name or _grounded(draft.recipient_name, jd)
    paragraphs = [" ".join(p.split()) for p in draft.paragraphs if p.strip()]
    if len(paragraphs) > 4:
        paragraphs = [*paragraphs[:3], " ".join(paragraphs[3:])]
    sign_off = " ".join(draft.sign_off.split())[:40].rstrip(",.") or "Yours sincerely"
    letter = Letter(
        recipient_name=name,
        recipient_title=body.recipient_title or _grounded(draft.recipient_title, jd),
        company=body.company or _grounded(draft.company, jd),
        recipient_contact=contact,
        job_reference=" ".join(draft.job_reference.split())[:160],
        salutation=f"Dear {name}," if name else "Dear Hiring Manager,",
        paragraphs=paragraphs,
        sign_off=sign_off + ",",
    )
    signature = body.sender.name if body.sender and body.sender.name else ""
    text = "\n\n".join([letter.salutation, *letter.paragraphs, "\n".join(filter(None, [letter.sign_off, signature]))])
    return CoverLetter(cover_letter=text, letter=letter)


@app.post("/api/interview/coding", response_model=CodingProblems)
def interview_coding(body: CodingRequest, cfg: BYOK):
    """Practice problems with tests and a reference solution. Validated here; never executed on the server."""
    focus = coding.focus(body.job_description)
    languages = list(dict.fromkeys(body.languages or (["python", "javascript", "sql"] if focus == "data" else ["python", "javascript"])))
    draft = ask(cfg, "coding_problems", CodingDraft, problem_mix=coding.focus_brief(focus, languages, body.count),
                job_description=body.job_description, resume=body.resume)
    problems = coding.build(draft.problems, languages, body.count)
    if not problems:
        raise HTTPException(502, "The model returned no usable problems. Please try again.")
    return {"problems": problems}


@app.post("/api/interview/coding/review", response_model=CodingReview)
def interview_coding_review(body: CodingReviewRequest, cfg: BYOK):
    results = body.results
    lines = [f"Passed {results.passed} of {results.total} tests."] + [
        f"Failed: args {f.args} expected {f.expected} actual {f.actual}" for f in results.failures]
    fence = "~~~~"
    return ask(cfg, "coding_review", CodingReview, problem=body.title, statement=body.statement, language=body.language,
               test_results="\n".join(lines), candidate_code=f"{fence}{body.language}\n{body.code}\n{fence}")


# ---------------------------------------------------------------------------
# Pro waitlist
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r"^[^@\s<>\"',;\x00-\x1f]+@[^@\s<>\"',;\x00-\x1f]+\.[^@\s.<>\"',;\x00-\x1f]{2,}$")
RATE_LIMIT, RATE_WINDOW, RATE_MAX_IPS = int(os.getenv("JIVIKA_RATE_LIMIT", "5")), 600, 10_000
_rate_hits: dict[str, list[float]] = {}


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not EMAIL_RE.match(value):
        raise ValueError("Enter a valid email address.")
    return value


class WaitlistRequest(BaseModel):
    email: Annotated[str, AfterValidator(_email)]
    plan: Literal["pro", "teams"] = "pro"
    source: Annotated[str, Field(max_length=64), AfterValidator(lambda s: s.strip() or None)] | None = None
    website: str = Field("", max_length=256)  # honeypot: humans never see or fill it


def client_ip(request: Request) -> str:
    if os.getenv("JIVIKA_TRUST_PROXY") == "1":
        # Vercel sets these itself and does not pass client-supplied values through. Elsewhere they could be
        # spoofed through a generic proxy, so they are only read on Vercel.
        if os.getenv("VERCEL") == "1" and (ip := request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-real-ip")):
            return ip.split(",")[0].strip()
        if forwarded := request.headers.get("x-forwarded-for"):
            # ponytail: rightmost entry assumes exactly one trusted proxy hop (Vercel overwrites it to a single IP)
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _limit(hits: dict[str, list[float]], ip: str, limit: int, message: str):
    """Sliding window: at most `limit` requests per IP per RATE_WINDOW (10 minutes), in memory."""
    # ponytail: per-process memory; use a shared store if running several workers
    now = time.monotonic()
    recent = [t for t in hits.pop(ip, []) if now - t < RATE_WINDOW]
    if len(recent) >= limit:
        hits[ip] = recent
        raise HTTPException(429, message)
    hits[ip] = [*recent, now]  # re-inserted last, so dict order is least recently seen first
    while len(hits) > RATE_MAX_IPS:
        del hits[next(iter(hits))]


async def rate_limit(request: Request):
    """Waitlist: RATE_LIMIT (default 5) per IP per 10 minutes. Async, so it runs on the event loop without a lock."""
    _limit(_rate_hits, client_ip(request), RATE_LIMIT, "Too many requests. Please try again later.")


WAITLIST_UNAVAILABLE = "The waitlist is temporarily unavailable."
REDIS_KEY = "jivika:waitlist"


def redis_config() -> tuple[str, str] | None:
    """Upstash REST credentials, under the Vercel Marketplace (KV_*) or Upstash (UPSTASH_REDIS_*) names."""
    url = os.getenv("KV_REST_API_URL") or os.getenv("UPSTASH_REDIS_REST_URL")
    token = os.getenv("KV_REST_API_TOKEN") or os.getenv("UPSTASH_REDIS_REST_TOKEN")
    return (url.rstrip("/"), token) if url and token else None


def redis_http(url: str, token: str, command: list[str]):
    """POST one command to the Upstash REST API and return its JSON reply. The only network call to Redis."""
    req = urllib.request.Request(
        url, data=json.dumps(command).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)


def redis(*command: str):
    url, token = redis_config()
    try:
        reply = redis_http(url, token, list(command))
    except (OSError, ValueError, http.client.HTTPException) as exc:  # URLError, HTTPError, timeouts, bad JSON, truncated replies
        log.warning("Waitlist store error: %s", type(exc).__name__)  # never the URL or token
        raise HTTPException(503, WAITLIST_UNAVAILABLE) from None
    if not isinstance(reply, dict) or "error" in reply:
        log.warning("Waitlist store rejected %s", command[0])
        raise HTTPException(503, WAITLIST_UNAVAILABLE)
    return reply.get("result")


def _entry(value) -> dict:
    """One waitlist hash value; malformed (e.g. hand-edited) values export with empty fields."""
    try:
        entry = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return entry if isinstance(entry, dict) else {}


def use_redis() -> bool:
    """Redis when configured. On Vercel without it, refuse: the filesystem there is ephemeral."""
    if redis_config():
        return True
    if os.getenv("VERCEL") == "1":
        raise HTTPException(503, WAITLIST_UNAVAILABLE)
    return False


if os.getenv("VERCEL") == "1" and not redis_config():
    log.warning("No Upstash Redis configured: the waitlist is disabled on Vercel. Set KV_REST_API_URL and KV_REST_API_TOKEN.")


def db() -> sqlite3.Connection:
    path = Path(os.getenv("JIVIKA_DB_PATH", "./data/jivika.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, "
        "plan TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL)"
    )
    return conn


@app.post("/api/waitlist", dependencies=[Depends(rate_limit)])
def join_waitlist(body: WaitlistRequest):
    if body.website.strip():
        return {"ok": True}
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if use_redis():
        entry = json.dumps({"plan": body.plan, "source": body.source, "created_at": created})
        added = redis("HSETNX", REDIS_KEY, body.email, entry)  # atomic: 0 when the email is already there
        return {"ok": True} if added == 1 else {"ok": True, "already": True}
    with closing(db()) as conn, conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO waitlist (email, plan, source, created_at) VALUES (?, ?, ?, ?)",
            (body.email, body.plan, body.source, created),
        )
    return {"ok": True, "already": True} if cur.rowcount == 0 else {"ok": True}


def _csv_cell(value) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@app.get("/api/admin/waitlist.csv", include_in_schema=False)
def export_waitlist(authorization: Annotated[str, Header()] = ""):
    token = os.getenv("JIVIKA_ADMIN_TOKEN", "")
    if not token:
        raise HTTPException(404, "Not found.")
    if not hmac.compare_digest(authorization.encode(), f"Bearer {token}".encode()):
        raise HTTPException(401, "Unauthorized.", headers={"WWW-Authenticate": "Bearer"})
    if use_redis():
        flat = redis("HGETALL", REDIS_KEY) or []
        entries = sorted(((_entry(v), k) for k, v in zip(flat[::2], flat[1::2])), key=lambda e: e[0].get("created_at") or "")
        rows = [(i, email, e.get("plan"), e.get("source"), e.get("created_at")) for i, (e, email) in enumerate(entries, 1)]
    else:
        with closing(db()) as conn:
            rows = conn.execute("SELECT id, email, plan, source, created_at FROM waitlist ORDER BY id").fetchall()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["id", "email", "plan", "source", "created_at"])
    writer.writerows([_csv_cell(v) for v in row] for row in rows)
    return Response(
        out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="waitlist.csv"', "Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------------------
# Live job search (sources and parsing in jivika/jobs.py)
# ---------------------------------------------------------------------------

JOBS_RATE_LIMIT = int(os.getenv("JIVIKA_JOBS_RATE_LIMIT", "30"))
_job_hits: dict[str, list[float]] = {}


async def jobs_rate_limit(request: Request):
    _limit(_job_hits, client_ip(request), JOBS_RATE_LIMIT, "Too many searches. Please wait a few minutes and try again.")


@app.get("/api/jobs/search", dependencies=[Depends(jobs_rate_limit)])
def jobs_search(
    q: Annotated[str, Query(max_length=100)],
    location: Annotated[str, Query(max_length=80)] = "",
    remote: Literal["any", "remote", "onsite"] = "any",
    sources: Annotated[str, Query(max_length=200)] = "",
    page: Annotated[int, Query(ge=1, le=5)] = 1,
):
    if not q.strip():
        raise HTTPException(422, "Enter a role or keywords to search.")
    return jobs.search(q, location, remote, sources, page)


@app.get("/api/jobs/detail", dependencies=[Depends(jobs_rate_limit)])
def jobs_detail(source: Annotated[str, Query(max_length=20)], id: Annotated[str, Query(max_length=64)]):
    try:
        return jobs.detail(source.strip().lower(), id.strip())
    except KeyError:
        raise HTTPException(404, "Details are not available for this source.") from None
    except ValueError:
        raise HTTPException(422, "Invalid job id.") from None
    except jobs.SourceError as exc:
        raise HTTPException(502, str(exc)) from None


_import_hits: dict[str, list[float]] = {}
_salary_hits: dict[str, list[float]] = {}
_models_hits: dict[str, list[float]] = {}
_ats_hits: dict[str, list[float]] = {}
_resource_hits: dict[str, list[float]] = {}


async def import_enabled():
    if os.getenv("JIVIKA_URL_IMPORT", "1").strip() == "0":
        raise HTTPException(404, "Not found.")


async def import_rate_limit(request: Request):
    _limit(_import_hits, client_ip(request), 20, "Too many imports. Please wait a few minutes and try again.")


@app.post("/api/jobs/import", response_model=JobImport, dependencies=[Depends(import_enabled), Depends(import_rate_limit)])
def jobs_import(body: JobImportRequest, cfg: OptionalLLM):
    """Job details from a link. Plain-text pages are structured by the model when a key (or demo mode) is available."""
    try:
        job, needs_structuring = importer.import_job(body.url)
    except importer.ImportFailed as exc:
        raise HTTPException(exc.status, str(exc)) from None
    if needs_structuring and cfg is not None:
        try:
            fields = ask(cfg, "job_import", JobFields, page_title=job["title"], page_text=job["description"][:12_000])
            job.update({k: v for k, v in fields.model_dump().items() if v.strip()})
        except HTTPException as exc:
            log.info("Job import structuring skipped: %s", exc.status_code)  # the raw text is still useful
    return job


async def ats_rate_limit(request: Request):
    _limit(_ats_hits, client_ip(request), 30, "Too many ATS checks. Please wait a few minutes and try again.")


@app.post("/api/ats/check", response_model=ATSResult, dependencies=[Depends(ats_rate_limit)])
def ats_check(body: ATSRequest, cfg: OptionalLLM):
    """Deterministic checks and score (jivika/ats.py); the model adds skills, title match, notes and the summary."""
    meta = body.meta.model_dump() if body.meta else None
    checks = ats.deterministic_checks(body.resume, meta)
    insights, note = None, None
    if cfg is None:
        note = "Add an API key in Settings for AI skill extraction and content notes. These results use the built-in checks only."
    else:
        try:
            insights = ask(cfg, "ats", ATSInsights, job_description=body.job_description, resume=body.resume)
        except HTTPException as exc:
            note = f"The AI analysis was unavailable ({exc.detail}). These results use the built-in checks only."
    keywords = None
    if body.job_description:
        keywords = ats.keyword_report(body.resume, body.job_description, insights)
        checks += ats.keyword_checks(keywords)
    score, categories = ats.score(checks, bool(body.job_description))
    passed = sum(1 for c in checks if c["status"] == "pass")
    summary = (insights.summary if insights else "") or f"{passed} of {len(checks)} checks passed."
    return {
        "score": score,
        "grade": ats.grade(score),
        "summary": summary,
        "checks": [{k: v for k, v in c.items() if not k.startswith("_")} for c in checks],
        "keywords": keywords,
        "fixes": ats.fixes(checks, insights.content_notes if insights else []),
        "categories": categories,
        "note": note,
    }


async def resources_rate_limit(request: Request):
    _limit(_resource_hits, client_ip(request), 30, "Too many resource lookups. Please wait a few minutes and try again.")


@app.post("/api/resources/resolve", dependencies=[Depends(resources_rate_limit)])
def resources_resolve(body: ResolveRequest):
    """Real, checked links for resource_queries (jivika/resources.py). Deterministic: no model is called."""
    return resources.resolve([item.model_dump() for item in body.items], body.max_per_item)


async def salary_rate_limit(request: Request):
    _limit(_salary_hits, client_ip(request), 30, "Too many salary lookups. Please wait a few minutes and try again.")


@app.get("/api/salary", dependencies=[Depends(salary_rate_limit)])
def salary_lookup(
    title: Annotated[str, Query(max_length=100)],
    location: Annotated[str, Query(max_length=80)] = "",
    company: Annotated[str, Query(max_length=80)] = "",
    currency: Literal["INR", "USD", "GBP", "EUR"] = "INR",
):
    if not title.strip():
        raise HTTPException(422, "Enter a job title.")
    return salary.lookup(title, location, company, currency)


async def models_rate_limit(request: Request):
    _limit(_models_hits, client_ip(request), 30, "Too many model list requests. Please wait a few minutes and try again.")


@app.get("/api/providers/{provider_id}/models", dependencies=[Depends(models_rate_limit)])
def provider_models(provider_id: str, response: Response, x_llm_key: Annotated[str, Header()] = ""):
    """Live chat models for a provider and key. OpenRouter lists without a key; in demo mode Groq uses the demo key."""
    provider = provider_id.strip().lower()
    if provider not in PROVIDERS:
        raise HTTPException(404, "Unknown provider.")
    key = x_llm_key.strip()
    if key and not (key.isascii() and key.isprintable()):
        raise HTTPException(401, "The API key format is invalid.")
    demo = False
    if not key and provider == DEMO_PROVIDER and demo_key():
        key, demo = demo_key(), True
    elif not key and provider != "openrouter":
        raise HTTPException(401, "Enter an API key to load the model list.")
    response.headers["Cache-Control"] = "private, no-store"
    result = model_lists.list_models(provider, key)
    return {**result, "demo": True} if demo else result


# ---------------------------------------------------------------------------
# Site and app (production build in frontend/dist)
# ---------------------------------------------------------------------------


@app.api_route("/api/{rest:path}", methods=["POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(rest: str):
    raise HTTPException(404, "Not found.")


def _not_found():
    page = DIST_DIR / "404.html"
    if page.is_file():
        return FileResponse(page, status_code=404)
    return JSONResponse({"detail": "Not found."}, 404)


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def site(path: str, request: Request):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Not found.")
    root = DIST_DIR.resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or path == "404.html":
        return _not_found()
    if target.is_file():
        cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    if path == "app" or path.startswith("app/"):  # the React app uses hash routes
        target = root / "app"
    if (target / "index.html").is_file():
        if path and not path.endswith("/") and target != root / "app":
            query = f"?{request.url.query}" if request.url.query else ""
            return RedirectResponse(f"{request.scope.get('root_path', '')}/{path.strip('/')}/{query}", 308)
        return FileResponse(target / "index.html", headers={"Cache-Control": "no-cache"})
    return _not_found()

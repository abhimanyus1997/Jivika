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
coding practice problems in jivika/coding.py, resume file parsing in jivika/parsing.py and structured resumes
(tailoring checks, application emails) in jivika/resume.py.
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
from jivika import ats, coding, importer, jobs, llm, parsing, resources, resume, salary
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
    LOCAL_KEY_PLACEHOLDER,
    all_providers,
    local_providers,
)

load_dotenv()
mimetypes.add_type("text/javascript", ".js")  # Windows registry may map .js to text/plain
mimetypes.add_type("text/javascript", ".mjs")  # Pyodide loads pyodide.asm.mjs; Python 3.11 has no .mjs mapping
mimetypes.add_type("application/wasm", ".wasm")

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
    # Receives X-Jivika-Model (and X-Jivika-Fallback) after the call.
    response: Response | None = None


def byok(
    request: Request,
    response: Response,
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
) -> LLMConfig:
    provider = x_llm_provider.strip().lower()
    local = local_providers().get(provider)
    if not x_llm_key.strip() and not local:
        if key := demo_key():
            # Demo mode: the owner's Groq key and model, whatever provider or model the client sent.
            return LLMConfig(provider=DEMO_PROVIDER, key=key, model=demo_model(), demo_ip=client_ip(request), response=response)
        raise HTTPException(401, "An API key is required. Add one in Settings.")
    spec = local or PROVIDERS.get(provider)
    if spec is None:
        raise HTTPException(400, "Unknown provider.")
    key = local_key(spec, x_llm_key)
    # Header values are forwarded to the provider and must be printable ASCII.
    if not (key.isascii() and key.isprintable()):
        raise HTTPException(401, "The API key format is invalid.")
    # No model chosen: the model that last answered for this key, else the live list's recommendation if it was
    # listed recently, else the static default (local servers without one: the first model they list).
    model = (x_llm_model.strip() or llm.last_success(provider, key) or model_lists.cached_recommended(provider, key)
             or spec["default_model"] or (local and model_lists.list_models(provider, key)["recommended"]))
    if not model:
        raise HTTPException(503, f"No model is available on {spec['name']}. Ask the server operator to install one.")
    if not (model.isascii() and model.isprintable()):
        raise HTTPException(400, "The model name is invalid.")
    return LLMConfig(provider=provider, key=key, model=model, response=response)


def local_key(spec: dict, key: str) -> str:
    """Hosted providers: the caller's key. Local servers: the operator's JIVIKA_<NAME>_KEY, else the caller's, else a placeholder."""
    key = key.strip()
    return (spec["key"] or key or LOCAL_KEY_PLACEHOLDER) if spec.get("local") else key


def optional_llm(
    request: Request,
    response: Response,
    x_llm_provider: Annotated[str, Header()] = "",
    x_llm_key: Annotated[str, Header()] = "",
    x_llm_model: Annotated[str, Header()] = "",
) -> LLMConfig | None:
    """Like byok, but None (instead of 401) when there is neither a user key nor demo mode."""
    if not x_llm_key.strip() and not demo_key() and x_llm_provider.strip().lower() not in local_providers():
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
TASK_MAX_TOKENS = {"coding_problems": 16_000, "resume_structure": 8_000, "resume_tailor": 8_000, "resume_refine": 8_000}
_JSON_FAILED = re.compile(r"failed to (?:validate|generate) json", re.I)
MAX_MODEL_ATTEMPTS = 3
FAILOVER_BUDGET = 150  # seconds; no further model is tried after this, keeping the worst case under Vercel's 300 s
OVERLOAD_RETRY_MAX = 3  # seconds of Retry-After honoured before retrying an overloaded model once


class _Unavailable(Exception):
    """A model that is out of quota, rate limited, overloaded or missing; the next candidate may still work."""

    def __init__(self, kind: str, exc: openai.APIError):
        super().__init__(kind)
        self.kind, self.message = kind, str(exc)
        self.headers = getattr(getattr(exc, "response", None), "headers", None) or {}
        self.retry_after = llm.seconds(self.headers.get("retry-after"))


def _messages(system: str, user: str, schema_model) -> list[dict]:
    schema = json.dumps(schema_model.model_json_schema())
    return [
        {"role": "system", "content": f"{BASE_RULES}\n\n{system}\n\nRespond with a single JSON object that conforms to this JSON schema:\n{schema}"},
        {"role": "user", "content": user},
    ]


def _estimate(messages: list[dict], max_tokens: int | None) -> int:
    """Rough token cost for Groq's per-minute budget: 4 characters per token plus the output budget."""
    return sum(len(m["content"]) for m in messages) // 4 + (max_tokens or 0)


def _create(client, model: str, messages: list[dict], options: dict):
    """(completion, response headers). The raw response exposes Groq's x-ratelimit-* headers."""
    raw = getattr(client.chat.completions, "with_raw_response", None)
    if raw is None:  # test doubles
        return client.chat.completions.create(model=model, messages=messages, **options), {}
    response = raw.create(model=model, messages=messages, **options)
    return response.parse(), response.headers


def _one_model(provider: str, client, model: str, messages: list[dict], options: dict, schema_model):
    """One model: retries once on invalid JSON, once without the output budget if rejected, and once after a
    short wait when overloaded. Raises _Unavailable for errors another model may not have."""
    name = all_providers()[provider]["name"]
    options = dict(options)
    json_tries, overload_retried = 0, False
    while json_tries < 2:
        try:
            response, headers = _create(client, model, messages, options)
        except openai.APIError as exc:
            if _is_auth_error(exc):
                raise HTTPException(401, f"The API key was rejected by {name}.") from None
            if isinstance(exc, openai.NotFoundError):
                raise _Unavailable("missing", exc) from None
            if kind := llm.classify(getattr(exc, "status_code", None), str(exc)):
                failure = _Unavailable(kind, exc)
                if kind == "overloaded" and not overload_retried:
                    overload_retried = True
                    time.sleep(min(failure.retry_after or 1, OVERLOAD_RETRY_MAX))
                    continue
                raise failure from None
            if isinstance(exc, openai.BadRequestError) and _JSON_FAILED.search(str(exc)):
                log.info("Provider %s rejected its own JSON, retrying once", provider)  # Groq json_validate_failed
                json_tries += 1
                continue
            if isinstance(exc, openai.BadRequestError) and "max_completion_tokens" in options and "token" in str(exc).lower():
                log.info("Provider %s rejected the output budget, retrying without it", provider)
                options.pop("max_completion_tokens")
                continue
            log.warning("Provider %s error: %s", provider, type(exc).__name__)
            raise HTTPException(502, "The model provider returned an error.") from None
        content = (response.choices[0].message.content or "") if response.choices else ""
        try:
            return schema_model.model_validate_json(_strip_fences(content)), headers
        except ValidationError:
            log.info("Invalid JSON from %s, retrying once", provider)
            json_tries += 1
    raise HTTPException(502, "The model returned an invalid response. Please try again.")


def _unavailable(name: str, tried: list[tuple[str, str]]) -> HTTPException:
    """The provider's reason for the first model, plus the fallbacks that also failed. Never keys or URLs."""
    first, kind = tried[0]
    reason = {
        "quota": f"{name} quota exceeded for {first}.",
        "rate": f"Rate limit reached at {name} for {first}.",
        "overloaded": f"{name} is overloaded right now ({first}).",
        "missing": f"{name} does not offer {first} for this key.",
    }[kind]
    if others := [m for m, _ in tried[1:]]:
        reason += f" Tried {', '.join(others)}: also unavailable."
    reason += " Try again or choose another model." if kind == "overloaded" else " Wait and retry, or choose another model."
    status = 429 if kind in ("quota", "rate") else 503 if kind == "overloaded" else 502
    return HTTPException(status, reason, headers={"Retry-After": "60"} if status == 429 else None)


def complete_json(provider: str, key: str, model: str, system: str, user: str, schema_model, max_tokens: int | None = None,
                  *, meta: dict | None = None, pool: list[str] | None = None):
    """A validated schema_model from the provider. Quota, rate-limit, overload and missing-model errors fail over to
    the next candidate (at most MAX_MODEL_ATTEMPTS models): pool order for the demo (by remaining Groq limits),
    else the chosen model then the provider's stable fallbacks. meta receives model, fallback_from, fallback_reason."""
    spec = all_providers()[provider]
    # Local models can take minutes on modest hardware (JIVIKA_LOCAL_TIMEOUT, default 120 s).
    timeout = (_env_int("JIVIKA_LOCAL_TIMEOUT", 120) or 120) if spec.get("local") else 60
    client = OpenAI(api_key=key, base_url=spec["base_url"], timeout=timeout, max_retries=0)  # retries are handled here
    options = dict(spec.get("extra", {}))
    if spec["json_mode"]:
        options["response_format"] = {"type": "json_object"}
    if spec["temperature"]:
        options["temperature"] = 0.3
    if max_tokens:
        options["max_completion_tokens"] = max_tokens
    messages = _messages(system, user, schema_model)
    estimate = _estimate(messages, max_tokens)
    # ponytail: local servers try only the chosen model; switching would load another model into memory.
    models = pool or ([model] if spec.get("local") else
                      llm.candidates(provider, model, model_lists.cached_ids(provider, key), spec["default_model"], model_lists.stable))
    deadline = time.monotonic() + FAILOVER_BUDGET
    tried: list[tuple[str, str]] = []
    for _ in range(MAX_MODEL_ATTEMPTS):
        done = [m for m, _ in tried]
        if pool:
            try:
                current = llm.pick(pool, estimate, exclude=done)
            except llm.PoolUnavailable as exc:
                raise HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after)}) from None
        else:
            current = next((m for m in models if m not in done and not llm.cooling(provider, key, m)), None)
            if current is None and not tried:
                current = models[0]  # everything is cooling down: the cooldown is a hint, try the first anyway
        if current is None or (tried and time.monotonic() > deadline):
            break
        try:
            result, headers = _one_model(provider, client, current, messages, options, schema_model)
        except _Unavailable as exc:
            tried.append((current, exc.kind))
            wait = exc.retry_after or (llm.COOL_OVERLOADED if exc.kind == "overloaded" else llm.COOL_QUOTA)
            log.info("Model %s at %s unavailable (%s), trying the next one", current, provider, exc.kind)
            if pool:
                llm.observe(current, exc.headers, limited=True, retry_after=wait, message=exc.message)
            else:
                llm.cool(provider, key, current, wait)
            continue
        if pool:
            llm.observe(current, headers)
        llm.succeeded(provider, key, current)
        if meta is not None:
            meta["model"] = current
            if tried:
                meta.update(fallback_from=tried[0][0], fallback_reason=llm.REASONS[tried[0][1]])
        return result
    raise _unavailable(spec["name"], tried)


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text)
    return text


def answered_headers(response: Response | None, model: str, meta: dict):
    """X-Jivika-Model (the model that answered) and, after a fallback, X-Jivika-Fallback and its reason."""
    if response is None:
        return
    response.headers["X-Jivika-Model"] = meta.get("model", model)
    if meta.get("fallback_from"):
        response.headers["X-Jivika-Fallback"] = meta["fallback_from"]
        response.headers["X-Jivika-Fallback-Reason"] = meta["fallback_reason"]


# Demo calls must fit Groq's free tier (8K tokens per minute per model): shorter inputs and output budgets.
DEMO_FIELD_CHARS = {"resume": 10_000, "job_description": 6_000, "profile": 10_000, "source_profile": 8_000}
DEMO_OTHER_CHARS = 4_000
DEMO_MAX_TOKENS, DEMO_LONG_MAX_TOKENS = 2_500, 4_000
DEMO_LONG_TASKS = ("coding_problems", "career_path", "resume_structure", "resume_tailor", "resume_refine")
DEMO_TOKEN_TARGET = 7_500


def _user(sections: dict) -> str:
    return "\n\n".join(f"## {label.replace('_', ' ').title()}\n{value}" for label, value in sections.items() if value)


def demo_sections(task: str, schema_model, sections: dict, max_tokens: int) -> dict:
    """Inputs cut to the demo budgets; if the estimate is still above DEMO_TOKEN_TARGET, the longest field is cut further."""
    out = {k: (v or "")[: DEMO_FIELD_CHARS.get(k, DEMO_OTHER_CHARS)] for k, v in sections.items()}
    for _ in range(3):
        over = _estimate(_messages(PROMPTS[task], _user(out), schema_model), max_tokens) - DEMO_TOKEN_TARGET
        longest = max(out, key=lambda k: len(out[k]), default=None)
        if over <= 0 or longest is None or len(out[longest]) <= 1_000:
            break
        out[longest] = out[longest][: max(1_000, len(out[longest]) - over * 4)]
    return out


def ask(cfg: LLMConfig, task: str, schema_model, **sections: str):
    demo = cfg.demo_ip is not None
    max_tokens = TASK_MAX_TOKENS.get(task)
    if demo:
        max_tokens = DEMO_LONG_MAX_TOKENS if task in DEMO_LONG_TASKS else DEMO_MAX_TOKENS
        sections = demo_sections(task, schema_model, sections, max_tokens)
    user = _user(sections)
    budget = {"max_tokens": max_tokens} if max_tokens else {}
    meta: dict = {}
    if not demo:
        result = complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS[task], user, schema_model, **budget, meta=meta)
        answered_headers(cfg.response, cfg.model, meta)
        return result
    remaining = use_demo(cfg.demo_ip)
    if cfg.response is not None:
        cfg.response.headers.update({"X-Jivika-Demo": "1", "X-Jivika-Demo-Remaining": str(remaining)})
    try:
        result = complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS[task], user, schema_model, **budget, meta=meta, pool=demo_pool())
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        log.error("Demo key rejected by %s", PROVIDERS[cfg.provider]["name"])  # never the key
        raise HTTPException(503, DEMO_UNAVAILABLE) from None
    answered_headers(cfg.response, cfg.model, meta)
    return result


# ---------------------------------------------------------------------------
# Demo mode: the owner's Groq key for visitors without a key, with usage limits
# ---------------------------------------------------------------------------

DEMO_PROVIDER = "groq"
DEMO_LIMIT_REACHED = "Demo limit reached. Add your own API key in Settings to keep going."
DEMO_UNAVAILABLE = "The demo model is unavailable right now. Add your own API key in Settings."
DEMO_MAX_KEYS = 10_000
GROQ_FREE_RPD, GROQ_FREE_RPM = 1_000, 30  # per model on Groq's free tier
_demo_counts: dict[str, int] = {}
_demo_lock = threading.Lock()


def demo_key() -> str:
    return os.getenv("JIVIKA_DEMO_GROQ_KEY", "").strip()


def demo_pool() -> list[str]:
    """JIVIKA_DEMO_MODEL alone when set, else JIVIKA_DEMO_MODELS (default llm.DEMO_MODELS) filtered by Groq's live list."""
    if model := os.getenv("JIVIKA_DEMO_MODEL", "").strip():
        return [model]
    wanted = [m.strip() for m in os.getenv("JIVIKA_DEMO_MODELS", "").split(",") if m.strip()] or list(llm.DEMO_MODELS)
    listed = model_lists.list_models(DEMO_PROVIDER, key) if (key := demo_key()) else None
    live = {m["id"] for m in listed["models"]} if listed and listed["source"] == "live" else None
    return [m for m in wanted if not live or m in live] or wanted


def demo_model() -> str:
    """The pool model the next demo request would use (the first one when none is available)."""
    pool = demo_pool()
    try:
        return llm.pick(pool, 0)
    except llm.PoolUnavailable:
        return pool[0]


def demo_pool_status() -> list[dict]:
    pool = demo_pool()
    states = llm.pool_states(pool)
    out = []
    for model in pool:
        state, wait = llm.pool_status(model, states[model])
        entry = {"model": model, "state": state}
        if states[model].get("rpd") is not None:
            entry["remaining_requests"] = states[model]["rpd"]
        if wait:
            entry["resets_in_seconds"] = int(wait) + 1
        out.append(entry)
    return out


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, "")))
    except ValueError:
        return default


def demo_limits() -> tuple[int, int]:
    """(per-IP hourly, global daily) demo request limits. The daily default keeps 10% headroom under the pool's RPD."""
    return _env_int("JIVIKA_DEMO_HOURLY_LIMIT", 20), _env_int("JIVIKA_DEMO_DAILY_LIMIT", int(0.9 * GROQ_FREE_RPD * len(demo_pool())))


def demo_minute_limit() -> int:
    """Global demo requests per minute; the default keeps 15% headroom under the pool's RPM."""
    return _env_int("JIVIKA_DEMO_MINUTE_LIMIT", int(0.85 * GROQ_FREE_RPM * len(demo_pool())))


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
    flags = {"X-Jivika-Demo": "1", "X-Jivika-Demo-Remaining": "0"}
    used = _demo_count(ip_key, 3600, True)
    if used > hourly:
        raise HTTPException(429, DEMO_LIMIT_REACHED, headers=flags)
    used_today = _demo_count(day_key, 86400, True)
    if used_today > daily:
        raise HTTPException(429, llm.DEMO_EXHAUSTED, headers=flags)
    now = int(time.time())
    if _demo_count(f"jivika:demo:min:{now // 60}", 60, True) > demo_minute_limit():
        wait = 60 - now % 60
        raise HTTPException(429, llm.DEMO_BUSY.format(wait), headers={"Retry-After": str(wait), "X-Jivika-Demo": "1"})
    return max(0, min(hourly - used, daily - used_today))


def demo_remaining(ip: str) -> int | None:
    hourly, daily = demo_limits()
    ip_key, day_key = _demo_windows(ip)
    used, used_today = _demo_count(ip_key, 3600, False), _demo_count(day_key, 86400, False)
    if used is None or used_today is None:
        return None
    return max(0, min(hourly - used, daily - used_today))


def _pool_store():
    """Upstash Redis for the demo pool's per-model limits, when configured."""
    if not (config := redis_config()):
        return None
    return (lambda keys: redis_http(*config, ["MGET", *keys])["result"],
            lambda key, value, ttl: redis_http(*config, ["SET", key, value, "EX", str(ttl)]))


llm.store = _pool_store


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
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], expose_headers=[
        "X-Jivika-Model", "X-Jivika-Fallback", "X-Jivika-Fallback-Reason", "X-Jivika-Demo", "X-Jivika-Demo-Remaining", "Retry-After"])

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
# The app (/app/*) runs the coding playground in same-origin Web Workers; WebAssembly and eval happen only inside
# them, under CSP_WORKER, so the pages themselves need nothing beyond worker-src 'self'.
CSP_APP = (b"content-security-policy", b"default-src 'self'; script-src 'self'; worker-src 'self'; " + _CSP_REST)
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
    """Hosted providers, plus local servers the operator configured (local: true, no key needed)."""
    out = [
        {"id": pid, "name": p["name"], "default_model": p["default_model"], "key_url": p["key_url"], "json_mode": p["json_mode"]}
        for pid, p in PROVIDERS.items()
    ]
    return out + [
        {"id": pid, "name": p["name"], "default_model": p["default_model"], "key_url": "", "json_mode": p["json_mode"], "local": True, "key_required": False}
        for pid, p in local_providers().items()
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
        "model": demo_model(),  # the preferred pool model right now
        "pool": demo_pool_status() if enabled else [],
        "hourly_limit": hourly,
        "daily_limit": daily,
        "minute_limit": demo_minute_limit(),
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
    if not x_llm_key.strip() and demo_key() and x_llm_provider.strip().lower() not in local_providers():
        # Report demo status instead of calling Groq with the shared key (and spending quota) on every check.
        return {"ok": True, "model": demo_model(), "demo": True, "provider": DEMO_PROVIDER, "remaining_hourly": demo_remaining(client_ip(request))}
    cfg = byok(request, response, x_llm_provider, x_llm_key, x_llm_model)
    meta: dict = {}
    complete_json(cfg.provider, cfg.key, cfg.model, PROMPTS["verify"], "Ping", Ping, meta=meta)
    answered_headers(response, cfg.model, meta)
    out = {"ok": True, "model": meta.get("model", cfg.model)}
    if meta.get("fallback_from"):
        out.update(fallback_from=meta["fallback_from"], fallback_reason=meta["fallback_reason"])
    return out


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


def _profile_json(profile: resume.StructuredProfile) -> str:
    return profile.model_dump_json(exclude_defaults=True)


@app.post("/api/profile/structure", response_model=resume.StructuredProfile)
def profile_structure(body: resume.StructureRequest, cfg: BYOK):
    """The resume text as structured sections. Entries, bullets and skills the text does not contain are dropped."""
    profile = ask(cfg, "resume_structure", resume.StructuredProfile, resume=body.resume)
    basics = profile.basics
    basics.email = _from_resume(body.resume, basics.email, ats.EMAIL)
    basics.phone = _from_resume(body.resume, basics.phone, ats.PHONE)
    basics.linkedin = _from_resume(body.resume, basics.linkedin, ats.LINKEDIN)
    basics.name, basics.website = _grounded(basics.name, body.resume), _grounded(basics.website, body.resume)
    return resume.ground_structure(profile, body.resume)


@app.post("/api/resume/tailor", response_model=resume.TailorResult)
def resume_tailor(body: resume.TailorRequest, cfg: BYOK):
    """A tailored copy of the profile. Checked against the profile afterwards, so nothing can be invented."""
    source = resume.fill_ids(body.profile)
    result = ask(cfg, "resume_tailor", resume.TailorResult, emphasis=body.emphasis.strip(),
                 job_description=body.job_description, profile=_profile_json(source))
    return resume.tailor_checked(result, source)


@app.post("/api/resume/refine", response_model=resume.RefineResult)
def resume_refine(body: resume.RefineRequest, cfg: BYOK):
    source = resume.fill_ids(body.source_profile)
    result = ask(cfg, "resume_refine", resume.RefineResult, instruction=body.instruction, section=body.section or "",
                 resume=_profile_json(body.resume), source_profile=_profile_json(source))
    return resume.refine_checked(result, body.resume, source, body.section)


@app.post("/api/application/email", response_model=resume.ApplicationEmail)
def application_email(body: resume.EmailRequest, cfg: BYOK):
    job = body.job
    if not (job.title or job.description.strip()):
        raise HTTPException(422, "Provide the job title or description.")
    draft = ask(cfg, "application_email", resume.EmailDraft, tone=body.tone, candidate=body.basics.name,
                job=f"Title: {job.title}\nCompany: {job.company}", job_description=job.description.strip(),
                resume_summary=body.resume_summary.strip())
    subject = draft.subject or " - ".join(filter(None, (f"Application for {job.title or 'the role'}", body.basics.name)))
    return {"to": resume.application_address(job.description), "subject": subject,
            "body": resume.email_body(draft.body, body.basics, body.tone)}


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
    spec = all_providers().get(provider)
    if spec is None:
        raise HTTPException(404, "Unknown provider.")
    key = local_key(spec, x_llm_key)
    if key and not (key.isascii() and key.isprintable()):
        raise HTTPException(401, "The API key format is invalid.")
    demo = False
    if spec.get("local"):
        pass  # the operator's server; the key is optional
    elif not key and provider == DEMO_PROVIDER and demo_key():
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

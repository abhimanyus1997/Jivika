"""Providers, request and response schemas, and prompts for the Jivika API."""

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

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
    "estimated from the listed roles. skills is a deduplicated list of concrete skills. "
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
    "skills_to_build lists 3 to 6 skills with a reason and a type of learning resource.",
    "interview_questions": "Generate interview questions for this candidate and job. Mix "
    "behavioral, technical and situational types. what_they_look_for explains what a strong "
    "answer demonstrates.",
    "interview_feedback": "Evaluate the candidate's answer to the interview question. "
    "improved_answer rewrites it in a stronger structure without inventing experience.",
    "cover_letter": "Write a cover letter of at most 350 words for this job using only "
    "experience from the resume. Use plain paragraphs with no placeholders in brackets.",
}

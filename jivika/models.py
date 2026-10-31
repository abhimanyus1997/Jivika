"""Live model lists from each provider's models endpoint, filtered to chat models, with a recommended pick.

Requests go to the fixed base_url of a known provider through jobs.fetch_json (no redirects, size cap,
timeout), which the tests replace. Results are cached per (provider, sha256(key)); raw keys are never stored.
"""

import hashlib
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

from jivika import jobs
from jivika.schemas import PROVIDERS

TTL, FALLBACK_TTL, MAX_ENTRIES = 3600, 300, 200
MAX_BYTES = 8 * 1024 * 1024  # OpenRouter's public list is about 0.8 MB
ANTHROPIC_VERSION = "2023-06-01"

# Not chat/text generation: embeddings, speech, images and video, moderation and safety classifiers,
# rerankers, realtime/live audio, search-preview variants and legacy completion-only models.
EXCLUDE = re.compile(
    r"embed|whisper|audio|tts|transcri|speech|orpheus|image|dall-e|imagen|veo|sora|lyria|moderation|guard|"
    r"rerank|realtime|-live|search-preview|computer-use|\baqa\b|ocr|babbage|davinci|gpt-3\.5-turbo-instruct"
)
# Snapshot, preview or experimental ids are only recommended when nothing else matches.
UNSTABLE = re.compile(r"preview|exp(?:erimental)?\b|-exp-|beta|alpha|test|:free$|-\d{4}-?\d{2}-?\d{2}$|-\d{4}$")

# Recommended model heuristic, in order: the static default when the live list still has it (it was checked
# by hand), else the newest stable id matching the provider's first matching pattern (fast, inexpensive,
# capable tiers), else the newest stable model, else the newest model.
PREFER = {
    "gemini": [r"^gemini-[\d.]+-flash$", r"flash(?!.*lite)", r"flash"],
    "openai": [r"^gpt-[\d.]+-mini$", r"mini"],
    "anthropic": [r"haiku", r"sonnet"],
    "groq": [r"gpt-oss-120b", r"versatile", r"gpt-oss", r"instant"],
    "mistral": [r"^mistral-small-latest$", r"small", r"medium"],
    "deepseek": [r"flash", r"chat"],
    "xai": [r"non-reasoning", r"mini", r"fast"],
    "openrouter": [r"^openai/gpt-[\d.]+-mini$", r"^google/gemini-[\d.]+-flash$", r"^(openai|google|anthropic)/.*(mini|flash|haiku)"],
    "qwen": [r"^qwen[\d.]*-flash$", r"^qwen[\d.]*-plus$", r"flash|plus|turbo"],
}

_cache: OrderedDict = OrderedDict()
_lock = threading.Lock()


class ModelsError(Exception):
    """Listing failed; the message is safe to show (no URLs or keys)."""


def _epoch(value) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return int(value)
    if isinstance(value, str) and value:
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None
    return None


def _price(value) -> float | None:
    """OpenRouter prices are USD per token as strings; returned as USD per million tokens."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number * 1_000_000, 4) if number >= 0 else None


def normalize(provider: str, data) -> list[dict]:
    rows = data.get("data") if isinstance(data, dict) else data
    out, seen = [], set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            continue
        model_id = row["id"].strip().removeprefix("models/")  # Gemini ids come as models/<id>
        if not model_id or model_id in seen or EXCLUDE.search(model_id.lower()):
            continue
        if row.get("active") is False or row.get("lifecycle") in ("deprecated", "retired") or row.get("deprecation"):
            continue
        if (caps := row.get("capabilities")) and isinstance(caps, dict) and caps.get("completion_chat") is False:
            continue  # Mistral marks chat support explicitly
        arch = row.get("architecture") or {}
        outputs = arch.get("output_modalities") if isinstance(arch, dict) else None
        if isinstance(outputs, list) and outputs and outputs != ["text"]:
            continue  # OpenRouter: image or audio generators
        item = {"id": model_id}
        if name := row.get("display_name") or row.get("name"):
            item["name"] = str(name)[:120]
        context = row.get("context_length") or row.get("context_window") or row.get("max_context_length") or row.get("max_input_tokens")
        if isinstance(context, int) and context > 0:
            item["context_length"] = context
        if created := _epoch(row.get("created") or row.get("created_at")):
            item["created"] = created
        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        if (price := _price(pricing.get("prompt"))) is not None:
            item["input_price"] = price
        if (price := _price(pricing.get("completion"))) is not None:
            item["output_price"] = price
        seen.add(model_id)
        out.append(item)
    out.sort(key=lambda m: m.get("created") or 0, reverse=True)  # stable: providers without dates keep their order
    return out


def recommend(provider: str, models: list[dict]) -> str:
    ids = [m["id"] for m in models]
    default = PROVIDERS[provider]["default_model"]
    if default in ids or not ids:
        return default
    stable = [i for i in ids if not UNSTABLE.search(i.lower())]
    for pattern in PREFER.get(provider, []):
        if hits := [i for i in stable if re.search(pattern, i.lower())]:
            return hits[0]
    return (stable or ids)[0]


def _request(provider: str, key: str):
    base = PROVIDERS[provider]["base_url"].rstrip("/")
    if provider == "anthropic":
        return jobs.fetch_json(
            "https://api.anthropic.com/v1/models?limit=1000",
            {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "Accept": "application/json"}, MAX_BYTES,
        )
    headers = {"Accept": "application/json", **({"Authorization": f"Bearer {key}"} if key and provider != "openrouter" else {})}
    return jobs.fetch_json(f"{base}/models", headers, MAX_BYTES)


def _cache_key(provider: str, key: str) -> tuple[str, str]:
    # OpenRouter's list is public and the same for every key: one shared entry, fetched without the key,
    # so distinct keys cannot fill the cache with copies of a several-hundred-model list.
    if provider == "openrouter":
        key = ""
    return provider, hashlib.sha256(key.encode()).hexdigest()


def list_models(provider: str, key: str) -> dict:
    """{models, recommended, source: 'live'|'fallback', fetched_at, error?}. Fallbacks are cached briefly."""
    ck = _cache_key(provider, key)
    with _lock:
        hit = _cache.get(ck)
        if hit and time.monotonic() < hit[0]:
            _cache.move_to_end(ck)
            return hit[1]
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        models = normalize(provider, _request(provider, key))
        if not models:
            raise jobs.SourceError("The provider returned no chat models.")
        result, ttl = {"models": models, "recommended": recommend(provider, models), "source": "live", "fetched_at": fetched_at}, TTL
    except jobs.SourceError as exc:
        message = str(exc)
        if "HTTP 401" in message or "HTTP 403" in message or "HTTP 400" in message or "Blocked" in message:
            message = f"{PROVIDERS[provider]['name']} did not accept the key for listing models."
        default = PROVIDERS[provider]["default_model"]
        result, ttl = {"models": [{"id": default}], "recommended": default, "source": "fallback", "fetched_at": fetched_at, "error": message}, FALLBACK_TTL
    with _lock:
        _cache[ck] = (time.monotonic() + ttl, result)
        while len(_cache) > MAX_ENTRIES:
            _cache.popitem(last=False)
    return result


def cached_recommended(provider: str, key: str) -> str | None:
    """The live recommended model if this provider+key was listed recently; never fetches."""
    with _lock:
        hit = _cache.get(_cache_key(provider, key))
    if hit and time.monotonic() < hit[0] and hit[1]["source"] == "live":
        return hit[1]["recommended"]
    return None

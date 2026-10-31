"""Model fallback state: per-key cooldowns, the last model that answered, and the Groq demo model pool.

Keys are never stored: entries are keyed by (provider, sha256(key), model). The demo pool's per-model limits
(read from Groq's x-ratelimit-* headers) live in Upstash Redis when main wires a store in (`store`), else memory.
"""

import hashlib
import json
import logging
import re
import threading
import time
from collections import OrderedDict

log = logging.getLogger("jivika.llm")

MAX_ENTRIES = 1000
COOL_QUOTA, COOL_OVERLOADED = 60, 30
# Groq free-tier models for the demo pool, in preference order (JIVIKA_DEMO_MODELS overrides).
DEMO_MODELS = ("openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b")
# Stable fallbacks tried after the chosen model, filtered by the live model list when one is cached.
FALLBACKS = {
    "gemini": ["gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite"],
    "openai": ["gpt-4.1-mini"],
    "groq": list(DEMO_MODELS),
}
REASONS = {"quota": "quota exceeded", "rate": "rate limited", "overloaded": "overloaded", "missing": "not available"}

_lock = threading.Lock()
_cool: OrderedDict = OrderedDict()  # (provider, key hash, model) -> monotonic deadline
_last: OrderedDict = OrderedDict()  # (provider, key hash) -> model that last answered


def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _put(cache: OrderedDict, k, v):
    with _lock:
        cache[k] = v
        cache.move_to_end(k)
        while len(cache) > MAX_ENTRIES:
            cache.popitem(last=False)


def cool(provider: str, key: str, model: str, seconds: float):
    _put(_cool, (provider, key_hash(key), model), time.monotonic() + seconds)


def cooling(provider: str, key: str, model: str) -> bool:
    with _lock:
        until = _cool.get((provider, key_hash(key), model))
    return bool(until and time.monotonic() < until)


def succeeded(provider: str, key: str, model: str):
    _put(_last, (provider, key_hash(key)), model)


def last_success(provider: str, key: str) -> str | None:
    with _lock:
        return _last.get((provider, key_hash(key)))


def candidates(provider: str, first: str, live_ids: list[str] | None, default: str, stable) -> list[str]:
    """first, then the provider's fallback chain (filtered by the live list when known), at most 3, deduplicated."""
    chain = list(FALLBACKS.get(provider, []))
    if provider == "openai" and live_ids:
        minis = [i for i in live_ids if re.fullmatch(r"gpt-[\d.]+-mini", i)]
        chain = sorted(minis, key=lambda i: [int(n) for n in re.findall(r"\d+", i)], reverse=True)[:1] + chain
    if provider not in FALLBACKS:
        chain = [default] + [i for i in (live_ids or []) if stable(i)]
    if live_ids:
        chain = [m for m in chain if m in live_ids]
    return list(dict.fromkeys([first, *chain]))[:3]


def classify(status: int | None, message: str) -> str | None:
    """'quota' | 'rate' | 'overloaded' for errors worth failing over on, else None."""
    text = message.lower()
    if status == 429:
        return "quota" if re.search(r"quota|resource_exhausted|per day|\brpd\b", text) else "rate"
    if status in (500, 502, 503, 504, 529) or "overloaded" in text:
        return "overloaded"
    return None


_DURATION = re.compile(r"(\d+(?:\.\d+)?)(ms|h|m|s)")


def seconds(value: str | None) -> float | None:
    """'2m59.56s', '7.66s', '500ms', '12' -> seconds."""
    value = (value or "").strip()
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    parts = _DURATION.findall(value)
    if not parts:
        return None
    return sum(float(n) * {"ms": 0.001, "h": 3600, "m": 60, "s": 1}[u] for n, u in parts)


# ---------------------------------------------------------------------------
# Groq demo pool
# ---------------------------------------------------------------------------

POOL_TTL = 86400
store = None  # optional callable -> (get_many(keys), set(key, value, ttl)) or None; main wires Upstash Redis in
_pool: dict[str, dict] = {}


def _pool_key(model: str) -> str:
    return f"jivika:demo:pool:{model}"


def pool_states(models: list[str]) -> dict[str, dict]:
    if backend := store and store():
        try:
            return {m: json.loads(v) if v else {} for m, v in zip(models, backend[0]([_pool_key(m) for m in models]))}
        except Exception as exc:  # noqa: BLE001  (any store failure falls back to memory)
            log.warning("Demo pool store error: %s; using memory", type(exc).__name__)
    with _lock:
        return {m: dict(_pool.get(m, {})) for m in models}


def _save(model: str, state: dict):
    with _lock:
        _pool[model] = state
    if backend := store and store():
        try:
            backend[1](_pool_key(model), json.dumps(state), POOL_TTL)
        except Exception as exc:  # noqa: BLE001
            log.warning("Demo pool store error: %s", type(exc).__name__)


def observe(model: str, headers, *, limited: bool = False, retry_after: float | None = None, message: str = ""):
    """Record Groq's x-ratelimit-* headers for a pool model; limited=True after a 429 (cooldown)."""
    now = time.time()
    state = pool_states([model])[model]

    def num(name):
        try:
            return int(float(headers.get(name)))
        except (TypeError, ValueError):
            return None

    if (rpd := num("x-ratelimit-remaining-requests")) is not None:
        state["rpd"], state["rpd_reset"] = rpd, now + (seconds(headers.get("x-ratelimit-reset-requests")) or 3600)
    if (tpm := num("x-ratelimit-remaining-tokens")) is not None:
        state["tpm"], state["tpm_reset"] = tpm, now + (seconds(headers.get("x-ratelimit-reset-tokens")) or 60)
    if limited:
        if classify(429, message) == "quota" and not state.get("rpd"):
            state["rpd"], state["rpd_reset"] = 0, max(state.get("rpd_reset") or 0, now + (retry_after or 3600))
        state["cool"] = now + (retry_after or COOL_QUOTA)
    _save(model, state)


def pool_status(model: str, state: dict, estimate: int = 0, now: float | None = None) -> tuple[str, float]:
    """('ok' | 'busy' | 'exhausted', seconds until it may be usable)."""
    now = time.time() if now is None else now
    if state.get("rpd") is not None and state["rpd"] <= 0 and state.get("rpd_reset", 0) > now:
        return "exhausted", state["rpd_reset"] - now
    if state.get("cool", 0) > now:
        return "busy", state["cool"] - now
    if state.get("tpm") is not None and state["tpm"] < estimate and state.get("tpm_reset", 0) > now:
        return "busy", state["tpm_reset"] - now
    return "ok", 0.0


class PoolUnavailable(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = retry_after


DEMO_BUSY = "The demo is busy. Try again in about {} seconds."
DEMO_EXHAUSTED = "Today's demo limit is reached. Add your own free key in Settings."


def pick(models: list[str], estimate: int, exclude=()) -> str:
    """The first pool model with requests left, room for the estimate and no cooldown; else PoolUnavailable."""
    states = pool_states(models)
    waits, exhausted = [], True
    for model in models:
        if model in exclude:
            continue
        status, wait = pool_status(model, states[model], estimate)
        if status == "ok":
            return model
        exhausted &= status == "exhausted"
        waits.append(wait)
    if exhausted and waits:
        raise PoolUnavailable(DEMO_EXHAUSTED, int(min(waits)) + 1)
    wait = int(min(waits)) + 1 if waits else 30
    raise PoolUnavailable(DEMO_BUSY.format(wait), wait)

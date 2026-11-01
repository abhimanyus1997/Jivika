# Development guide

This document explains how Jivika is put together. For setup and the contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md); for user-facing features and deployment, see the [README](README.md).

## Architecture

Jivika is one FastAPI application that serves both the JSON API (`/api/*`) and the built frontend (`frontend/dist`). The browser holds all user data; the server is stateless apart from the waitlist, rate-limit and demo counters, and short-lived caches.

```
Browser (React app, data in localStorage/sessionStorage)
   |  X-LLM-Provider / X-LLM-Key / X-LLM-Model headers, per request
   v
FastAPI (main.py + jivika/)  -->  model providers (OpenAI-compatible APIs, user key or demo Groq key)
                             -->  job boards, company career boards, salary and learning-resource sources
                             -->  Upstash Redis or SQLite (waitlist, shared counters), optional docling-serve
```

- **Backend:** Python 3.12, FastAPI, Pydantic v2, the OpenAI SDK (used against every provider's OpenAI-compatible endpoint), pypdf and optionally Docling. Outbound fetching uses only the standard library.
- **Frontend:** a Vite multi-page build: static marketing pages (`frontend/index.html`, `pricing/`, `faq/`, `about/`, `contact/`, `privacy/`, `terms/`, `clipper/`) plus the React 19 + TypeScript app at `/app/` with hash routes. Tailwind CSS v4, Recharts, CodeMirror 6, Pyodide and sql.js.
- **Extension:** Jivika Clipper, a dependency-free Manifest V3 extension and bookmarklet in `extension/`.
- **Hosting:** Vercel runs `main.py` as one Python function (see `vercel.json`); pushes to `main` deploy automatically. The `Dockerfile` builds a self-contained image.

## Folder map

| Path | Contents |
| --- | --- |
| `main.py` | App setup, routes, BYOK and demo-mode dependencies, rate limits, waitlist, security headers, static site serving |
| `jivika/schemas.py` | Provider table, Pydantic request and response schemas, prompts |
| `jivika/llm.py` | Model fallback state (per-key cooldowns keyed by a key hash) and the demo model pool |
| `jivika/models.py` | Live model lists per provider and the recommended-model heuristic |
| `jivika/jobs.py` | Job sources, parsers, filtering, dedupe and caching |
| `jivika/importer.py` | Job import from a link, including the SSRF-guarded fetcher |
| `jivika/ats.py` | Deterministic ATS checks and scoring |
| `jivika/parsing.py` | Resume parsing with pypdf, local Docling or docling-serve |
| `jivika/salary.py` | Market salary sources |
| `jivika/resources.py` | Learning-resource resolver: keyless search sources, domain allow-lists, link checks, cache |
| `jivika/coding.py` | Coding problem validation |
| `tests/` | pytest suite; `conftest.py` clears environment settings, blocks network access and resets caches |
| `frontend/src/` | React app: `App.tsx` (shell, navigation, command palette), `pages/`, `components/`, `workers/` (code runners), `lib/` (`api.ts` client, `store.ts` storage, `clip.ts` Clipper hand-off), `site/` (marketing page script and styles) |
| `frontend/partials/`, `frontend/public/` | Shared HTML partials; static assets, screenshots, provider icons and Clipper downloads |
| `extension/src/` | Clipper source: `extract.js` (page extractor), `clip.js` (hand-off URL), `popup.*`, `options.*`, `bookmarklet.js`, `manifest.json` |
| `extension/build.mjs` | Builds the unpacked extension, zip and bookmarklet into `extension/dist/` and copies the zip and bookmarklet to `frontend/public/downloads/` |
| `extension/test/` | Node test runner suites and the headless Chrome helper (`chrome.mjs`) |
| `docs/` | Brand assets and README media |

## Configuration

All server settings are optional environment variables, documented with their defaults in [`.env.example`](.env.example). The server loads `.env` from the repository root at startup. Build-time frontend values (`VITE_SITE_URL`, `VITE_CONTACT_EMAIL`, `VITE_COMPANY_NAME`, `VITE_BASE_PATH`) live in `frontend/.env`.

## How the main pieces work

### Bring your own key (BYOK)

The app stores the user's key in the browser (sessionStorage by default, localStorage when "Remember key on this device" is chosen) and sends it on every AI request in `X-LLM-Key`, with `X-LLM-Provider` and an optional `X-LLM-Model`. The `byok` dependency in `main.py` validates the provider against `PROVIDERS` and builds a per-request config; the key is used for that call and is never stored, logged or returned. Model responses are validated against Pydantic schemas. Fallback and cooldown state in `jivika/llm.py`, and the model list cache, are keyed by a SHA-256 hash of the key, never the key itself.

### Local models

`local_providers()` in `jivika/schemas.py` builds provider specs for Ollama, vLLM, LM Studio and a generic OpenAI-compatible server from `JIVIKA_<NAME>_URL` (plus optional `_KEY`, `_MODEL`, and `JIVIKA_OPENAI_COMPAT_NAME`), read on every call; `all_providers()` merges them with the hosted `PROVIDERS`. The base URL only ever comes from the environment, so `X-LLM-Provider` can select a configured server but never name an address (no SSRF). For local providers `byok` needs no key and skips demo mode, `local_key()` in `main.py` picks the operator's key, then the user's, then a placeholder, `complete_json` uses `JIVIKA_LOCAL_TIMEOUT` (default 120 s) and tries only the chosen model, and model lists are cached for a minute. The frontend learns which ids are local from `GET /api/providers` (`rememberLocal` in `frontend/src/lib/api.ts`) and then sends `X-LLM-Provider` without a key. To try it, run `ollama serve`, `ollama pull qwen3:8b` and start the API with `JIVIKA_OLLAMA_URL=http://127.0.0.1:11434/v1`. Tests are in `tests/test_local.py`.

### Demo mode

When a request carries no key and `JIVIKA_DEMO_GROQ_KEY` is set, the server uses the owner's Groq key with a server-chosen model from the demo pool (`JIVIKA_DEMO_MODELS`), whatever provider or model the client sent. The demo key never reaches the browser; `GET /api/demo` reports only whether demo mode is on, the models and the limits. Demo requests are limited per client IP per clock hour, globally per UTC day and globally per minute. Counters and the pool's per-model limits live in Upstash Redis when configured, otherwise in process memory. Without a demo key, keyless AI requests get 401.

### Job sources

`GET /api/jobs/search` queries the enabled sources (`JIVIKA_JOB_SOURCES`) concurrently using fixed URL templates, with a timeout and size cap per source, then normalises, dedupes and sorts the results and caches them briefly. Sources include public job board APIs, Adzuna (when keys are set) and company career boards on Greenhouse, Lever, Ashby and other applicant tracking systems (`JIVIKA_ATS_BOARDS`). The research sources (LinkedIn, Naukri) are used only when listed explicitly. `POST /api/jobs/import` fetches an arbitrary public job link through the guarded fetcher in `jivika/importer.py`: http(s) on ports 80 and 443 only, every resolved address must be public, connections are pinned to the vetted address, and each redirect is re-checked.

### Learning resources and salary data

Models only suggest search phrases. `POST /api/resources/resolve` turns them into links from keyless sources (YouTube, DuckDuckGo, Bing, Reddit, roadmap.sh), keeps allow-listed domains and checks each link through the guarded fetcher. `GET /api/salary` combines Adzuna data with salaries stated in live postings.

### Coding playground

Problems are generated by the model and validated on the server, but code never runs on the server. The browser runs each attempt in a fresh Web Worker (Pyodide for Python, `new Function` for JavaScript, sql.js for SQL) that is terminated afterwards. Only worker bundles get `'unsafe-eval'` and `'wasm-unsafe-eval'` in their CSP.

### Jivika Clipper

Some job sites block server-side imports. The Clipper extension requests the `activeTab`, `scripting` and `storage` permissions. When the user opens its toolbar popup, it runs `extract.js` in the active tab only, then opens the app with the job in the URL fragment (`/app/#match?clip=<payload>`), which browsers never send to a server. `storage` holds only the configured app address. The app (`frontend/src/lib/clip.ts`) decodes the payload with a size cap, stores the job locally and strips it from the URL. The bookmarklet bundles the same extractor and hand-off code.

## Tests

| Suite | Command | Notes |
| --- | --- | --- |
| Backend | `uv run pytest -q` | Network access is blocked; model and fetch calls are faked. Run one file with `uv run pytest tests/test_jobs.py -q`. |
| Frontend lint | `npm --prefix frontend run lint` | oxlint |
| Frontend build | `npm run build` | `tsc -b` type-check, then the Vite build |
| Clipper | `node --test extension/test/*.test.mjs` | `extract.test.mjs` runs the extractor against fixture pages; `e2e.test.mjs` builds and loads the extension and runs the bookmarklet. Both start a throwaway headless Chrome (set `CHROME_PATH` if it is not found) and need `openssl`. Job-site hostnames resolve to a local fixture server, so no real site is contacted. |
| Clipper build | `npm run build:extension` | Run `npm --prefix frontend ci` first: it uses the frontend's rolldown to minify the bookmarklet. |

CI (`.github/workflows/ci.yml`) runs all of these on every push and pull request to `main`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which repeats the checks, publishes the Docker image to `ghcr.io/abhimanyus1997/jivika` and creates a GitHub Release with the Clipper zip attached.

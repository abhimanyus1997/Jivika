# Jivika

**A private career workspace for job seekers.** Jivika (Sanskrit for *livelihood*) matches your resume against real job descriptions, reviews your CV and LinkedIn profile, maps a career path with estimated salaries, and helps you prepare for interviews and write cover letters.

- **Free**: bring your own model key (Google Gemini, OpenAI, Groq or OpenRouter). Available now, no account, your data stays in your browser.
- **Pro** (coming soon): hosted AI with no key needed. Join the waitlist on the site; pricing will be announced at launch.

<!-- Screenshot: add docs/screenshot.png -->

## Features

- **Dashboard**: career, skills, CV and LinkedIn scores with history, application trends, career goals timeline, and top job matches.
- **Job Match**: match score (model judgement blended with deterministic keyword coverage), matched and missing skills, strengths, gaps, challenges and opportunities, and a step-by-step transition plan.
- **CV Review**: ATS-style score, per-section feedback, and rewritten bullet points.
- **LinkedIn Optimizer**: headline suggestions, an About rewrite, and keyword recommendations.
- **Career Path**: current role, next target and long-term potential with estimated salary ranges (INR, USD, GBP, EUR) and skills to build.
- **Interview Prep**: tailored questions from a job description, with feedback on your answers.
- **Cover Letter**: tone-aware letters you can edit, copy, or download.
- **Application Tracker**: track applications and their status; feeds the dashboard trends.

## Bring your own key

Jivika works with **Google Gemini, OpenAI, Groq, and OpenRouter** through their OpenAI-compatible APIs.

- Your API key is kept in the browser (session storage by default, or local storage if you choose "Remember key on this device").
- The key is sent per request in a header and is never logged, stored, or returned by the server.
- Your resume, analyses, and applications are stored only in your browser's local storage. "Clear all local data" in Settings removes everything.
- The only server-side data is the Pro waitlist: an email address, plan and source, stored in SQLite.

## Architecture

```
frontend/   Vite multi-page build: static marketing pages + the React 19 app (Tailwind CSS v4, Recharts)
main.py     FastAPI service: PDF parsing, prompt orchestration, waitlist, static site serving
tests/      pytest suite (no network; the model call is mocked)
```

Model responses are validated against Pydantic schemas, with scores clamped to 0 to 100. In production FastAPI serves the built frontend from `frontend/dist` and adds security headers (CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, optional HSTS) to every response. API docs are at `/api/docs`.

### URL structure

| Path | Content |
| --- | --- |
| `/` | Landing page |
| `/pricing/`, `/faq/`, `/about/`, `/contact/` | Marketing pages (static HTML) |
| `/privacy/`, `/terms/` | Privacy policy and terms |
| `/app/` | The React app (hash routes, for example `/app/#dashboard`) |
| `/robots.txt`, `/sitemap.xml` | Generated at build time from `VITE_SITE_URL` |
| `/api/*` | JSON API |

Paths without a trailing slash (`/pricing`) redirect to the canonical form (`/pricing/`). Unknown paths return the branded `404.html` with status 404; unknown API paths return a JSON 404.

## Quick start

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20.19+ or 22.12+.

```bash
uv sync
cd frontend && npm install && npm run build && cd ..
uv run uvicorn main:app
```

Open http://127.0.0.1:8000 for the site or http://127.0.0.1:8000/app/ for the app, go to **Settings**, choose a provider, and paste your API key.

## Development

Run the API and the Vite dev server in two terminals:

```bash
npm run api                             # http://127.0.0.1:8000
npm run dev                             # http://localhost:5173 (site) and /app/ (app); proxies /api
```

## Configuration

Server settings are environment variables (see [.env.example](.env.example)). All are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JIVIKA_DB_PATH` | `./data/jivika.db` (`/data/jivika.db` in Docker) | SQLite file for the Pro waitlist |
| `JIVIKA_ADMIN_TOKEN` | unset | Bearer token for the waitlist CSV export; the endpoint returns 404 when unset |
| `JIVIKA_TRUST_PROXY` | unset | Set to `1` behind a reverse proxy to rate limit by `X-Forwarded-For` |
| `JIVIKA_HSTS` | unset | Set to `1` when served over HTTPS to send `Strict-Transport-Security` |
| `JIVIKA_CORS_ORIGINS` | unset | Comma-separated origins, only if the frontend is served from another origin |
| `JIVIKA_MAX_UPLOAD_MB` | `10` | Maximum resume PDF size |

Frontend values are baked in at build time. Defaults live in `frontend/.env`; override them with environment variables when running `npm run build`, or with `--build-arg` for Docker.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_SITE_URL` | `https://jivika.app` | Canonical URLs, Open Graph tags and sitemap |
| `VITE_CONTACT_EMAIL` | `abhimanyus1997@gmail.com` | Contact links |
| `VITE_COMPANY_NAME` | `Jivika` | Footer and legal pages |

## Deploy

The Docker image builds the frontend and runs the API as a non-root user. The waitlist database lives on the `/data` volume.

```bash
docker build -t jivika --build-arg VITE_SITE_URL=https://your-domain.example .
export JIVIKA_ADMIN_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"   # keep this value for exporting the waitlist
docker run -d --name jivika -p 8000:8000 \
  -v jivika-data:/data \
  -e JIVIKA_ADMIN_TOKEN \
  -e JIVIKA_TRUST_PROXY=1 -e JIVIKA_HSTS=1 \
  jivika
```

The image works on Render, Railway, Fly.io or any VPS behind a TLS-terminating proxy (Caddy, nginx, Traefik). Attach persistent storage at `/data` so the waitlist survives redeploys. Behind HTTPS, set `JIVIKA_TRUST_PROXY=1` and `JIVIKA_HSTS=1`; leave `JIVIKA_TRUST_PROXY` unset if the container is reachable directly. The container listens on `$PORT` when the platform sets it (Railway, Render) and on 8000 otherwise. The image has a health check on `/api/health`.

The waitlist rate limit (5 sign-ups per IP per 10 minutes) is kept in memory, so run a single worker per instance.

### Exporting the waitlist

```bash
curl -fsS -H "Authorization: Bearer $JIVIKA_ADMIN_TOKEN" \
  https://your-domain.example/api/admin/waitlist.csv -o waitlist.csv
```

To delete an address on request:

```bash
docker exec jivika python -c "import sqlite3; c = sqlite3.connect('/data/jivika.db'); c.execute('DELETE FROM waitlist WHERE email = ?', ('person@example.com',)); c.commit()"
```

## Tests

```bash
uv run pytest
cd frontend && npm run build
```

## License

[Apache-2.0](LICENSE)

# Jivika

**AI platform for job seekers.** Jivika (Sanskrit for *livelihood*) analyses your resume against real job descriptions, reviews your CV and LinkedIn profile, maps a career path, and helps you prepare for interviews, using your own LLM API key.

<!-- Screenshot: add docs/screenshot.png -->

## Features

- **Dashboard**: career, skills, CV and LinkedIn scores with history, application trends, career goals timeline, and top job matches.
- **Job Match**: match score (model judgement blended with deterministic keyword coverage), matched and missing skills, market insights, and a step-by-step transition plan.
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

## Architecture

```
frontend/   Vite + React 19 + TypeScript + Tailwind CSS v4 + Recharts
main.py     FastAPI service: PDF parsing, prompt orchestration, response validation
tests/      pytest suite (no network; the model call is mocked)
```

The backend is stateless. Model responses are validated against Pydantic schemas, with scores clamped to 0 to 100. In production FastAPI serves the built frontend from `frontend/dist`. API docs are at `/api/docs`.

## Quick start

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+.

```bash
uv sync
cd frontend && npm install && npm run build && cd ..
uv run uvicorn main:app
```

Open http://127.0.0.1:8000, go to **Settings**, choose a provider, and paste your API key.

## Development

Run the API and the Vite dev server in two terminals:

```bash
npm run api                             # http://127.0.0.1:8000
npm run dev                             # http://localhost:5173 (proxies /api)
```

Optional settings are documented in [.env.example](.env.example).

## Tests

```bash
uv run pytest
cd frontend && npm run build
```

## License

[Apache-2.0](LICENSE)

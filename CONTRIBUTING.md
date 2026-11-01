# Contributing to Jivika

Thanks for your interest in improving Jivika. This guide covers local setup, tests and how to send a change. For how the code fits together, see [DEVELOPMENT.md](DEVELOPMENT.md).

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Setup

Prerequisites: Python 3.11+ (3.12 recommended) with [uv](https://docs.astral.sh/uv/), and Node.js 22 (20.19+ also works).

```bash
git clone https://github.com/abhimanyus1997/Jivika.git
cd Jivika
uv sync                       # backend and dev dependencies (pytest, httpx)
npm --prefix frontend ci      # frontend dependencies
cp .env.example .env          # optional; every setting has a default
```

Run the API and the Vite dev server in two terminals:

```bash
npm run api                   # FastAPI on http://127.0.0.1:8000, with reload
npm run dev                   # Vite on http://localhost:5173 (site) and /app/ (app); proxies /api
```

No server-side model key is needed. Open the app, go to Settings and paste a key for any supported provider, or set `JIVIKA_DEMO_GROQ_KEY` in `.env` to use demo mode.

## Running the checks

Run the same checks as CI before you open a pull request:

```bash
uv run pytest -q                       # backend; network access is blocked, model and fetch calls are faked
npm --prefix frontend run lint         # oxlint
npm run build                          # type-checks and builds frontend/dist
node --test extension/test/*.test.mjs  # Clipper extractor and end-to-end tests (needs Chrome, see below)
npm run build:extension                # packages the Clipper zip and bookmarklet
```

The extension tests start a throwaway headless Chrome with a temporary profile. They look for Chrome in the usual install locations; set `CHROME_PATH` if yours is elsewhere. They also need `openssl` on the `PATH` to create a temporary test certificate.

## Making a change

- Open an issue first for anything larger than a small fix, so we can agree on the approach.
- Keep pull requests small and focused on one change. Separate refactors from behaviour changes.
- Add or update tests for behaviour changes. Backend tests live in `tests/`, extension tests in `extension/test/`.
- Follow the existing style: plain standard library before new dependencies, short functions, comments that explain why.
- Update the README, [DEVELOPMENT.md](DEVELOPMENT.md) or `.env.example` when you add a setting or change behaviour users can see.

### Commit messages

Use small [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add a job source for company career boards
fix(frontend): keep the model list open after verifying a key
docs: describe the resource resolver cache
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci` and `chore`. Scopes used in this repository include `api`, `frontend`, `site` and `extension`.

### Pull request checklist

- [ ] The checks above pass locally.
- [ ] Tests cover the change.
- [ ] Documentation and `.env.example` are updated where relevant.
- [ ] UI changes are checked in light and dark themes, with screenshots in the pull request.
- [ ] API keys and resume data are still never stored or logged on the server.
- [ ] The diff contains no secrets.

## Secrets and personal data

Never commit secrets. `.env`, `.env.*` (except `.env.example`), `.vercel` and the local `data/` directory are git-ignored; keep it that way. Do not put real API keys, tokens, resumes or personal data in code, tests, fixtures, issues or screenshots. If you commit a secret by mistake, revoke it with the provider first, then tell the maintainer.

## License

Jivika is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms.

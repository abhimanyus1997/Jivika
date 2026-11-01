# Security policy

## Supported versions

Jivika is developed on the `main` branch, which is what runs at https://jivika.abhimanyu.fyi. Security fixes go to `main` and, when releases exist, to the latest tagged release and its Docker image (`ghcr.io/abhimanyus1997/jivika:latest`). Older releases are not patched; please upgrade.

| Version | Supported |
| --- | --- |
| `main` and the hosted site | Yes |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue, discussion or pull request.

- Email **abhimanyus1997@gmail.com** with the subject "Jivika security", or
- use GitHub's [private vulnerability reporting](https://github.com/abhimanyus1997/Jivika/security/advisories/new) if it is enabled for the repository.

Include the affected URL or file, steps to reproduce, the impact you expect and any proof of concept. You should get an acknowledgement within 5 working days. Please give us reasonable time to fix the issue before disclosing it, and we will credit you in the release notes if you wish.

When testing, use only your own API keys and data, do not access other people's data, and do not degrade the hosted service (no load testing, spam or automated scanning that exhausts rate limits or the shared demo quota).

## Scope

In scope:

- The FastAPI backend (`main.py`, `jivika/`), including the job import, learning-resource and other outbound fetchers.
- The web app and marketing pages (`frontend/`), as served by the backend or the hosted site.
- The Jivika Clipper extension and bookmarklet (`extension/`).
- The `Dockerfile` and the published image.

Out of scope:

- Vulnerabilities in third-party model providers, job boards or other external sites Jivika contacts.
- Issues that require a compromised device, browser or browser extension, or physical access.
- Content returned by a model (for example inaccurate advice), unless it leads to code execution or data exposure.
- Missing hardening that has no demonstrated impact, and reports from automated scanners without a working proof of concept.
- Denial of service through volume alone.

## How Jivika handles keys and data

- **Bring your own key.** User API keys are kept in the browser (sessionStorage by default, localStorage only if the user chooses to remember the key). They are sent per request in the `X-LLM-Key` header, used for that request only, and never stored, logged or returned by the server. Caches and model-fallback state are keyed by a SHA-256 hash of the key.
- **Demo key.** The optional demo Groq key (`JIVIKA_DEMO_GROQ_KEY`) is a server-side secret that is never sent to the browser. Its use is rate limited per client IP and globally.
- **Server-side data.** The only stored data is the Pro waitlist (in Upstash Redis or SQLite), plus rate-limit and demo counters and short-lived caches. Resume files and request content are processed only to produce a response and are not kept. The waitlist export endpoint is disabled unless `JIVIKA_ADMIN_TOKEN` is set and compares the bearer token in constant time.
- **SSRF protections.** Links fetched on a user's behalf (job import, learning-resource checks) go through a guarded fetcher in `jivika/importer.py`: http and https only, ports 80 and 443 only, no credentials in the URL, every resolved address must be public (private, loopback, link-local, CGNAT, multicast, reserved and IPv4-embedding IPv6 ranges are rejected), the connection is pinned to the vetted address, every redirect is re-checked, and timeouts, size caps and content-type allow-lists apply. Job search uses fixed URL templates per source. URL import can be turned off with `JIVIKA_URL_IMPORT=0`.
- **Security headers.** Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, optional HSTS (`JIVIKA_HSTS=1`) and a Content Security Policy with `script-src 'self'`, `connect-src 'self'` and `frame-ancestors 'none'`. Only the coding playground's worker bundles are allowed `'unsafe-eval'` and `'wasm-unsafe-eval'`. User code runs only in the browser, in a Web Worker with network and storage APIs disabled, which is terminated after each run. The interactive API docs at `/api/docs` are exempt from the CSP because they load from a CDN.
- **Clipper.** The extension requests only `activeTab`, `scripting` and `storage`, reads only the active tab when the user opens it, and hands the job to the app in the URL fragment. The app validates and size-caps the payload and treats it as plain text.

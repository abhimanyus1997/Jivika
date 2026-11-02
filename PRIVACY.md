# Privacy

This document describes, for developers and self-hosters, what data the Jivika code handles and where it goes. The user-facing policy for the hosted service is at https://jivika.abhimanyu.fyi/privacy/ (source: `frontend/privacy/index.html`). If the two ever disagree, the code is the reference; please report the mismatch.

Jivika has no accounts. User data stays in the browser, and the server keeps as little as it can.

## Stored in the browser

The app stores everything under keys prefixed `jivika.` in the browser's Web Storage (`frontend/src/lib/store.ts`):

- **API key:** sessionStorage by default (cleared when the tab closes), or localStorage if the user chooses "Remember key on this device".
- **localStorage:** the resume and parsed profile, analysis results and score history, cover letters and drawn signatures, tracked applications, roadmap and coding progress, the last job search, clipped jobs, and preferences such as provider, model and theme.

The server never receives a copy of this storage. "Clear all local data" in Settings removes every `jivika.` entry from both storages; clearing site data in the browser does the same.

## Sent to the server, per request

When a user runs a tool, the app sends only what that tool needs (for example resume text and a job description) plus the provider, key and optional model in the `X-LLM-Provider`, `X-LLM-Key` and `X-LLM-Model` headers.

- The key is used for that request only. It is never stored, logged or returned. Model-list caching and fallback state use a SHA-256 hash of the key, not the key.
- Request content and uploaded resume files are processed to produce the response and are not written to a database. Large uploads may be buffered in a temporary file that is removed when the request ends.
- Code written in the coding playground runs in the browser and is sent to the server only when the user asks for an AI review.

## Stored on the server

- **Pro waitlist:** the email address, chosen plan, signup page (source) and signup time, stored in Upstash Redis when `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` equivalents) are set, otherwise in SQLite at `JIVIKA_DB_PATH`. It can be exported only through `GET /api/admin/waitlist.csv` with `JIVIKA_ADMIN_TOKEN`.
- **Demo counters:** demo requests are counted per client IP address per clock hour (IPv6 grouped by /64), plus global per-day and per-minute counts. Counters hold no request content and expire on their own (after an hour, a day and a minute). They live in Upstash Redis when configured, otherwise in process memory.
- **Rate limits:** other endpoints (waitlist, job search, import, ATS, salary, resources, model lists) keep recent request times per client IP in process memory for 10 minutes. They are never written to disk.
- **Caches:** job search results, model lists, salary lookups and learning-resource results (search phrases and the links found) are cached in process memory for minutes to 24 hours. They contain no keys or resume content.

Application logs record error types and provider names, never keys or request content. The hosting platform may keep its own request logs (IP address, time, path, status).

## Third parties contacted on the user's behalf

The server, not the browser, makes these calls:

- **Model providers:** the provider the user chose (Google Gemini, OpenAI, Anthropic, Groq, Mistral AI, DeepSeek, xAI, OpenRouter or Qwen) receives the content of each AI request and the user's key, under that provider's own terms. In demo mode the content goes to Groq with the operator's key. Listing models sends the key to the provider's models endpoint.
- **Job sources:** search keywords, location and remote preference go to the enabled job boards and company career boards (`JIVIKA_JOB_SOURCES`, `JIVIKA_ATS_BOARDS`); Adzuna also receives the operator's Adzuna keys. Resume content is never sent for job search; the Quick fit score is computed in the browser.
- **Job import:** the link the user pastes is fetched from that site.
- **Salary data:** job title, location and company go to the enabled salary sources (`JIVIKA_SALARY_SOURCES`).
- **Learning resources:** model-suggested search phrases go to the enabled keyless sources (`JIVIKA_RESOURCE_SOURCES`: YouTube, DuckDuckGo, Bing, Reddit, roadmap.sh), and found links are fetched once to check that they open.
- **Upstash Redis:** when configured, it stores the waitlist and the demo counters described above.
- **docling-serve:** when the operator sets `JIVIKA_DOCLING_URL`, uploaded resume files are sent to that service for parsing.

## No cookies, analytics or ads

Jivika sets no cookies and includes no analytics, advertising or tracking scripts. Fonts, the coding runtimes and all other assets are self-hosted, and the Content Security Policy limits the page to connecting to its own origin, so the browser itself does not contact third parties.

## Jivika Clipper

The browser extension requests the `activeTab`, `scripting` and `storage` permissions, plus optional per-site host access (`optional_host_permissions`) that is requested only when the user turns on the in-page Fill with Jivika button for a site. It reads only the active tab, and only when the user opens its toolbar popup (the bookmarklet runs only when clicked). It sends nothing to Jivika's servers: an extracted job or LinkedIn profile opens in the app inside the URL fragment (`/app/#match?clip=...`, `/app/#profile?clip=...`), which browsers never send to a server, and the app removes it from the address bar after reading it. A profile too large for the URL is held in extension memory and handed to the app over the extension message channel (`#profile?clipRef=<id>`, `jivika.fetchClip`).

- **Connecting** (Settings > Jivika Clipper) sends the structured profile and the application answers from the app to the extension with `chrome.runtime.sendMessage` (`externally_connectable`, limited to the Jivika origin and localhost; the extension also checks the sender origin and caps messages at 200 KB). The extension keeps them in `chrome.storage.local` with the app address and sync time. Disconnect and Clear all local data ask the extension to delete them; removing the extension deletes them too.
- **Autofill** writes only into the form on the tab the user chose, never touches file inputs, and never submits or moves to the next step. Filled values are not sent anywhere.
- Extension settings (the app address, sites with the in-page button) stay in extension storage. The clip payload carries the extension version (`clipper_version`) so the app can show an update notice; nothing is fetched to check for updates.

## Contact

Privacy questions and deletion requests for waitlist entries: abhimanyus1997@gmail.com.

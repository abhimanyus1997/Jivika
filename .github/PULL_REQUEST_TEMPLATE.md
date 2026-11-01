## Summary

<!-- What does this change and why? Link related issues (Fixes #123). -->

## Checklist

- [ ] Small, focused change with a conventional commit title (`feat:`, `fix:`, `docs:`, ...)
- [ ] `uv run pytest -q` passes
- [ ] `npm --prefix frontend run lint` and `npm run build` pass
- [ ] Extension changes: `node --test extension/test/*.test.mjs` and `npm run build:extension` pass
- [ ] Tests added or updated for behaviour changes
- [ ] Docs updated (README, DEVELOPMENT.md, `.env.example`) where relevant
- [ ] No secrets, `.env` files, API keys or personal data in the diff
- [ ] Keys and resume data still never stored or logged server-side

## Screenshots

<!-- For UI changes, before and after, light and dark. -->

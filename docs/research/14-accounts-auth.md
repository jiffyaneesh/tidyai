# 14 — Accounts, auth, and multi-user safety

Date: 2026-11-20. Overturns the "no accounts" line in [06-v1-plan.md](06-v1-plan.md) and [05-architecture.md](05-architecture.md). New evidence: the user asked for a multi-user SaaS with email/password and Google sign-in.

## Question

How do we add users, email/password, and Google sign-in to a FastAPI + React app that already fetches a user-supplied provider URL, without opening account takeover, CSRF, enumeration, cross-tenant reads, or SSRF.

## Decisions locked with the user (2026-11-20)

| Area | Choice |
| --- | --- |
| Stack | In FastAPI. Postgres sessions, Argon2id, Authlib for Google OIDC. No new service. |
| Egress | `TIDYAI_EGRESS=local\|hosted`. Hosted blocks non-public IPs with a DNS-pinned transport. Local (dev default) keeps localhost models. |
| Mail | Generic SMTP through the Python stdlib. No SMTP config means links print to the API log. |
| Legacy rows | The first account created claims every project with no owner. One time, logged. |
| Deps | API: `argon2-cffi`, `authlib`, `itsdangerous`. Web: `react-router`. Transitions use React `<ViewTransition>` and CSS, with no motion library. |

## Evidence

| Topic | Finding | Confidence | Source |
| --- | --- | --- | --- |
| Session vs JWT | A first-party browser app should use an opaque server session in an HttpOnly cookie. It can be revoked at once and listed per user. JWT only pays off when several resource servers verify locally. | High | [OWASP Session Mgmt](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP FastAPI](https://cheatsheetseries.owasp.org/cheatsheets/FastAPI_Security_Cheat_Sheet.html) |
| Cookie flags | `__Host-` prefix, `Secure`, `HttpOnly`, explicit `SameSite`. Store a hash of the token, not the token. Rotate on login. Enforce idle and absolute expiry. | High | OWASP Session Mgmt |
| CSRF | `SameSite` is defense in depth only. An API-driven SPA may use a custom request header plus an Origin check. Never mutate on GET. | High | [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) |
| Password hash | Argon2id with m=19456 KiB, t=2, p=1 as the floor. | High | [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) |
| Password policy | Single-factor passwords need at least 15 characters. Allow at least 64. No composition rules. Check new passwords against a blocklist that includes context words. | High | [NIST SP 800-63B-4 §3.1.1.2](https://pages.nist.gov/800-63-4/sp800-63b.html) |
| Enumeration | Login, signup, and reset give the same message for existing and unknown accounts, with similar timing. | High | [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) |
| Reset tokens | At least 128 bits, stored hashed, single use, expiring within an hour. Build the link from a fixed base URL, not the Host header. Serve the reset page with `Referrer-Policy: no-referrer`. Revoke sessions after a reset. Do not auto-login. | High | OWASP Forgot Password, [WSTG-ATHN-09](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/04-Authentication/09-Weak_Password_Change_or_Reset_Functionalities/) |
| Brute force | Keep two independent buckets: per account and per IP. Never key one bucket on the pair. Return a generic 429. | High | [OWASP Bot Mgmt](https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html) |
| Google OIDC | Authorization code flow with PKCE S256, `state`, and `nonce`. Validate `iss`, `aud`, and `exp`. Key accounts on `sub`, not email. Trust the email only when `email_verified` is true. | High | [Google backend auth](https://developers.google.com/identity/sign-in/web/backend-auth), [Authlib web clients](https://docs.authlib.org/en/latest/oauth2/client/web/), [Authlib #773](https://github.com/authlib/authlib/discussions/773) |
| Pre-account hijack | An attacker can register the victim's email with a password and wait for the victim's first OAuth login, which then links into the attacker's account. Never link into an unverified local account without removing the attacker's credential. | High | [better-auth GHSA-g38m-r43w-p2q7](https://github.com/better-auth/better-auth/security/advisories/GHSA-g38m-r43w-p2q7), [Clerk linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking) |
| SSRF | Resolve DNS once and reject any non-global address, including mapped IPv6. Pin the socket to the validated IP while keeping SNI and Host. No redirects. | High | [isaacbell SSRF guide](https://isaacbell.github.io/secure-devtools/guides/prevent-ssrf/), [Prefect #21591](https://github.com/PrefectHQ/prefect/pull/21591), [litellm url_utils](https://github.com/BerriAI/litellm/blob/84c1414a/litellm/litellm_core_utils/url_utils.py) |
| Page motion | React 19.3 `<ViewTransition>` animates router navigations. React Router's `viewTransition` prop is deprecated. Reduced motion must be handled in CSS. | High | [React Router view transitions](https://reactrouter.com/how-to/view-transitions), [React ViewTransition](https://react.dev/reference/react/ViewTransition) |

### CVE floors for this slice

| Package | Advisory | Floor |
| --- | --- | --- |
| authlib | CVE-2026-114615, CVE-2026-114616, GHSA-f7j6-p4qx-gq99, Starlette client CSRF (1.6.11) | `>=1.9.10` (latest) |
| fastapi | GHSA-f56c-v883-vx8r, a parameter DoS. 0.162.0 is installed and affected. | `>=0.163.2` |
| starlette | CVE-2026-48817/48818/54282/54283 | `>=1.3.1` (1.10.0 is installed and clear) |
| python-multipart | CVE-2026-53537/53538/53539 (only if form parsing is pulled in) | `>=0.0.32` |
| react-router | CVE-2026-22029 (data/framework mode), GHSA-9jcx-v3wj-wh4m | `>=8.5.1` (8.5.2 installed), declarative mode |

The full dependency audit and its fixes are in [15-security-pass.md](15-security-pass.md).

## Design

### Data (`schema.sql`, idempotent)

- `users`: id, email (lowercased, unique), `email_verified_at`, `password_hash` (null for Google-only accounts), `display_name`, `created_at`, `updated_at`.
- `oauth_accounts`: primary key `(provider, subject)`, `user_id`, `email`, `created_at`.
- `sessions`: `token_hash` primary key (sha256 of a 32-byte random token), `user_id`, `created_at`, `last_seen_at`, `expires_at`, `user_agent`, `ip`.
- `auth_tokens`: `token_hash` primary key, `user_id`, `purpose` (`verify_email` or `reset_password`), `expires_at`, `used_at`.
- `rate_events`: `(bucket, at)`. A sliding window counted in Postgres, so the limit holds across workers.
- `projects.owner_id`: nullable foreign key to `users` with `ON DELETE CASCADE`. Chats, pages, blocks, and chunks are authorized through their project. Every read and write checks `owner_id = current user`. A miss returns 404, not 403, so ids do not leak.

### Sessions

- Token: `secrets.token_urlsafe(32)`. Only `sha256(token)` is stored.
- Cookie: `__Host-tidyai_session` with `Secure` in hosted mode. In local http dev it is `tidyai_session` without `Secure`. Always `HttpOnly`, `SameSite=Lax`, `Path=/`. `Lax` is required because the Google callback is a cross-site top-level redirect.
- Lifetime: 30 days absolute, 7 days idle. `last_seen_at` is touched at most every 5 minutes.
- A new session is created on every login. A password change or reset revokes all sessions, keeping the current one only on change. Logout deletes the row and expires the cookie.

### CSRF and origin

- The web app calls the API same-origin through the Vite proxy at `/api`. Production uses the same reverse proxy.
- Every unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`) needs (1) the `X-Tidyai-Csrf: 1` header, which forces a preflight for cross-site callers, and (2) an `Origin` in `TIDYAI_APP_ORIGINS`, or a `Sec-Fetch-Site` of `same-origin` when `Origin` is absent. Credentialed CORS is removed.
- No GET mutates state. Google `start` only sets the short-lived OAuth state cookie.

### Email and password

- Email: trimmed and lowercased, at most 254 characters, basic shape check. Password: 15–128 characters. A blocklist covers common passwords plus context words (`tidyai`, the email local part). No composition rules.
- Signup always returns 202 with "Check your inbox". A new email gets a verify link. An existing email gets a "someone tried to sign up" notice instead. No auto-login on signup.
- Verify link: `/verify#token=…`. The fragment never reaches the server log or the `Referer`. The page POSTs the token, the API marks the email verified, then signs in.
- Login: one generic error. An unknown email still runs Argon2 against a dummy hash, so timing stays flat. A correct password on an unverified account returns `email_unverified`, which only someone holding the password can see. Rate limits: 10 per 15 minutes per email and 30 per 15 minutes per IP.
- Forgot: always 202. Limits: 3 per hour per email and 10 per hour per IP. The token lasts 30 minutes, is single use, and earlier tokens are voided. `/reset#token=…`.
- Reset: sets the new hash, marks the email verified (the link proves the inbox), revokes all sessions, sends a notice email, and returns to login.
- Links are built from `TIDYAI_PUBLIC_URL`, never from the `Host` header.

### Google

- `GET /v1/auth/google/start?next=/app` → Authlib redirect with `openid email profile` and PKCE S256. Authlib's `SessionMiddleware` keeps state, nonce, and verifier in a signed cookie, `tidyai_oauth`, for 10 minutes.
- `GET /v1/auth/google/callback`: Authlib validates state, PKCE, and the id_token. We require `email_verified is True`, normalizing the string form.
  - `(google, sub)` is known: sign in.
  - The email matches a verified user: link, then sign in.
  - The email matches an unverified user: **pre-hijack guard**. Null the password hash, revoke all sessions, mark verified, link, then sign in. The squatter loses access.
  - Otherwise: create a verified user, link, then sign in.
- `next` must start with `/` and not `//` or `/\`. Anything else becomes `/app`.
- With no `GOOGLE_CLIENT_ID`, `/v1/auth/config` reports `googleEnabled: false`. The button is disabled with a reason.

### Egress (agent, `stream.py`)

- `check_base_url(url, allow_private)`. Hosted mode requires `https` on port 443, rejects IP literals that are not global, and uses a pinned `AsyncHTTPTransport`. On connect it resolves through `getaddrinfo` and fails if any answer is not global, then dials the IP with `sni_hostname` set to the original host.
- The API reads `TIDYAI_EGRESS` and passes `allow_private`. The agent still reads no env.

### Web

- Routes: `/login`, `/signup`, `/forgot`, `/reset`, `/verify`, `/app`, `/profile`, `/settings/:section`. `RequireAuth` redirects to `/login?next=`. A 401 from any call sends the app to login.
- Vault and local prefs are namespaced by user id, so two people on one browser never see each other's provider keys.
- Auth layout: a split screen. The left side is an abstract lilac artwork (Unsplash License, credited in `public/art/CREDITS.md`). The right side is a spacious form. Under 960px the art becomes a top band. The headline uses Source Serif 4. Everything else uses existing tokens. There is still one accent.
- Forms: correct `autocomplete` values (`email`, `current-password`, `new-password`), a show/hide password toggle with `aria-pressed`, a length meter, and a caps-lock hint. Errors use `aria-live`.
- Profile: name, email with verified badge, connected Google, member since.
- Settings sections: Account (password set and change), Sessions (list, revoke one, revoke others), Providers (the existing vault UI), Appearance, and Danger (delete the account after typing the email; data cascades).
- Transitions: `<ViewTransition>` around the route outlet. 220ms fade plus 6px rise. `prefers-reduced-motion` turns it off. Tokens never animate.

### Module boundaries

| Module | Owns | Must not |
| --- | --- | --- |
| `tidyai_api/security.py` | Hashing, tokens, cookie policy, origin/CSRF middleware, rate limit | SQL beyond `rate_events` |
| `tidyai_api/auth_store.py` | SQL for users, sessions, tokens, oauth | HTTP |
| `tidyai_api/auth_routes.py` | `/v1/auth/*`, `/v1/me/*` | Prompt text |
| `tidyai_api/mailer.py` | SMTP or log sink | Templates beyond plain text |
| `tidyai_api/db.py` | Domain SQL, now owner-scoped | Session logic |
| `tidyai_agent/stream.py` | Egress guard and pinned transport | Env reads |
| `apps/web/src/auth/*` | Auth context, pages, guard | Workspace logic |

## Rejected

- Hosted auth (Clerk, Supabase) and Better Auth. Each adds a service or vendor. The user chose in-process.
- JWT access tokens. They add revocation and key-rotation burden for one backend.
- Avatar upload, email change, MFA, and magic links. `ponytail:` ceilings. Email change needs a verify-new-address flow. MFA is next once real users exist.
- A strict provider allowlist. It kills custom OpenAI-compatible hosts. Hosted mode uses the IP guard instead.

## Build order (one commit per unit)

1. This doc and the AGENTS.md rule updates.
2. Schema, plus a security core with tests.
3. Auth store, routes, and mailer, with tests.
4. Owner scoping on every domain route, plus a cross-tenant test.
5. Egress guard in the agent, with tests.
6. Web: router, auth context, auth pages, art, transitions.
7. Web: profile, settings sections, per-user vault namespace.
8. Security pass: dependency/CVE audit and bumps, headers, a route-by-route authz review, findings written up.

## What would overturn this

- Several API backends that need local verification → JWT through a real IdP.
- Enterprise SSO or SCIM demand → a hosted IdP.
- Abuse at scale → edge rate limiting, CAPTCHA on signup and reset, breached-password k-anonymity check.

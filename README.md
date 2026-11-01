# LIGHT — personal autonomous AI assistant

A secure, full-stack personal assistant: dashboard, AI chat, tasks, reminders, memory, research and project
workspaces, voice, integrations, a security center and an approval system for sensitive actions.

**Stack:** Node.js (ES modules) · Express · MySQL 8 · vanilla HTML/CSS/JS frontend · Google OAuth 2.0 / OpenID Connect.

## Features

| Module | What it does |
| --- | --- |
| Dashboard | Live counts, upcoming reminders, recent chats and activity, assistant/database/AI-provider status (all from the backend) |
| AI Chat | Persistent conversations (rename, delete, search), copy, regenerate, stop, safe file attachments |
| Command engine | Natural-language time/date, arithmetic, tasks, reminders, memory, conversation management, help |
| Tasks / Reminders | Full CRUD, priority, due dates, search/filter/sort; atomic scheduler (no duplicate notifications) and browser notifications confirmed by the client |
| Memory, Research, Projects | Owner-scoped notes and workspaces |
| Voice | Browser speech-to-text and text-to-speech with settings and graceful fallbacks |
| Integrations | Google Calendar / Gmail / Drive framework: disconnected by default, incremental consent, encrypted tokens, disconnect + revoke |
| Security Center | Sessions (revoke), login activity, events, approval history, permission overview |
| Approvals | Sensitive tools never run until the user approves the exact action; approvals are single-use, owner-bound and expire |
| AI providers | Rule-based engine by default; optional Ollama (local) or an OpenAI-compatible cloud endpoint |

## Security model

Google OIDC with state, nonce and PKCE; ID token verified (signature, issuer, audience, expiry); identity keyed on Google's
stable `sub` (never the email); server-side sessions in MySQL (httpOnly, SameSite, `Secure` in production, regenerated on
login, revocable); CSRF synchronizer token on every write; Helmet + CSP; rate limiting; zod validation on every request;
parameterized SQL only; every query filtered by the session's user id (the frontend never supplies a user id); AES-256-GCM
for integration credentials; audit log. No arbitrary shell/SQL/code execution exists anywhere.

## Setup (Windows / macOS / Linux)

Requirements: Node.js 20+, MySQL 8.

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env   — then edit .env
npm run db:create           # creates the database if it does not exist
npm run migrate             # applies SQL migrations (never drops anything)
npm run dev                 # http://localhost:3000
```

Open the folder in VS Code (`code .`) and press F5 to run it with the included launch configuration.

### Google sign-in

1. In Google Cloud Console create an **OAuth client ID** (type *Web application*).
2. Authorized redirect URIs: `http://localhost:3000/auth/google/callback` and
   `http://localhost:3000/auth/integrations/callback` (the second is only used if you connect an integration).
3. Put the client id/secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and set a long random `SESSION_SECRET`.
   Secrets stay on the server; they are never sent to the browser. `.env` is git-ignored.

### Upgrading from the first prototype database

The first prototype stored data without owners. The migration runner detects this and stops **without changing anything**.
Use a new `DB_NAME` (e.g. `light_assistant_v2`); your old database stays untouched.

### Production

Serve behind HTTPS (`NODE_ENV=production`, `FRONTEND_ORIGIN=https://your.domain`, reverse proxy forwarding `X-Forwarded-*`).
Secure cookies and `trust proxy` are enabled automatically in production.

## Tests

```bash
npm test                    # unit tests: command engine (no database needed)
RUN_DB_TESTS=1 npm run test:integration   # security tests against a migrated MySQL database
```

PowerShell: `$env:RUN_DB_TESTS=1; npm run test:integration` · cmd.exe: `set RUN_DB_TESTS=1&& npm run test:integration`.
The integration suite covers unauthenticated access, CSRF, input validation, SQL-injection strings, cross-user access,
approval ownership/single-use, unknown-tool refusal, OAuth callback validation, session revocation/expiry and rate limiting.
GitHub Actions (`.github/workflows/ci.yml`) runs everything against a MySQL 8 service on every push.

## Project layout

```
config/       environment configuration         middleware/  security, errors, validation
routes/       REST routes                        services/    business logic, command engine, tools, AI providers
database/     pool, migrations, migrate runner   public/      frontend (HTML, CSS, ES modules)
tests/        unit + security tests
```

## Known limitations

- Google Calendar/Gmail/Drive connect flows are implemented but need your own Google credentials to try; they are only
  exercised against Google, not mocked in tests.
- Streaming token-by-token responses are not implemented; "stop" cancels the pending request.
- No built-in web search provider: the Research workspace stores notes and sources you add.

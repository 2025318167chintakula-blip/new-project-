# DisasterGuard — Disaster Management & Emergency Response

DisasterGuard is a community emergency-response coordination platform. It helps affected people submit requests and lets verified volunteers coordinate assistance. The existing Hatchable export is retained as a reference under `hatchable-export/`; the standalone Node.js implementation now lives at the repository root.

## Features implemented in the standalone app

- Responsive landing page and PWA shell.
- Passwordless email one-time-code sign-in (SMTP required).
- PostgreSQL-backed users, profiles, emergency requests, audit logs and persistent sessions.
- Victim request creation, optional location sharing, status tracking and cancellation of open requests.
- Volunteer application/verification workflow; only verified volunteers can accept requests.
- Volunteer task acceptance, in-progress updates and completion.
- Admin dashboard with request metrics, request categories, CSV export, volunteer approval/rejection and admin management.
- Server-side authorization, rate limits, secure HTTP-only session cookies, input validation and generic server errors.
- Health endpoint at `/api/health`.

## Repository structure

- `server.js` — Express server and API routes.
- `schema.sql` — PostgreSQL schema.
- `public/` — standalone frontend assets.
- `hatchable-export/` — preserved source export from the original Hatchable app.
- `.env.example` — configuration template with placeholders.
- `render.yaml` — optional Render deployment blueprint (requires provider account and environment setup).

## Run locally

Requirements: Node.js 20+ and a PostgreSQL database.

1. Create a PostgreSQL database, then execute `schema.sql` against it.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL`, a long random `SESSION_SECRET`, `OWNER_EMAIL`, and working SMTP settings in `.env`.
4. Install dependencies: `npm install`.
5. Start: `npm start`.
6. Open `http://localhost:3000`. Check `http://localhost:3000/api/health`.

Do not commit `.env`. Email login intentionally fails closed when SMTP is not configured; the app does not print OTPs into server logs or offer a development bypass.

## Configure the owner

Set `OWNER_EMAIL` to the exact email address that should have owner-admin access. Sign in using that address; the account receives admin access. Never hardcode SMTP credentials or production secrets in source control.

## Deploy

A free hosting tier may be available depending on provider policy and current quotas; it is not guaranteed. Create a PostgreSQL database, deploy the repository as a Node web service, and configure every variable in `.env.example` in the hosting dashboard. Use HTTPS, enable PostgreSQL TLS, and keep a separate test database for migration and acceptance tests. The included `render.yaml` is a starting blueprint, not proof that the service has been deployed.

## Important safety and operational notes

- DisasterGuard is a coordination tool, not a substitute for official emergency dispatch. People in immediate danger should contact local emergency services.
- Open request listings hide precise coordinates and location labels from volunteers until a request is assigned.
- Do not collect more location or contact detail than necessary.
- Back up the database and test restores before using real users.
- Review privacy, retention, incident-response, accessibility and local legal requirements before a public production launch.

## Verification status

Source files and deployment configuration are committed, but this repository has not been deployed from this chat and no live database/SMTP credentials were provided. A successful live sign-in, database connection, email delivery, and hosting deployment still require configuring those services and running end-to-end tests.

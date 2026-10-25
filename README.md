# DisasterGuard — Disaster Management & Emergency Response

DisasterGuard helps people request emergency assistance and helps verified volunteers coordinate responses.

## Project status

This repository now contains a source export from the existing DisasterGuard app in `hatchable-export/`. The export preserves the current UI, PWA assets, API handlers, and SQL migrations without replacing or deleting anything from the separate `disaster` repository.

**Important:** this is a source-preservation step, not yet a complete hosting migration. Several exported files depend on Hatchable's runtime (`import { db } from 'hatchable'`, injected `req.user`, and Hatchable email OTP auth). They will not run on ordinary Node.js hosting until the authentication and database adapters are ported and tested.

## Features preserved in the export

- Public landing page and passwordless email OTP login UI
- Victim emergency-request workflow
- Volunteer request board and verification status
- Admin dashboard, volunteer review, and user/admin management APIs
- PostgreSQL table migrations
- PWA manifest, service worker, and DisasterGuard SVG icon
- Admin authorization checks (do not weaken these)

## Repository layout

- `hatchable-export/public/` — current HTML, CSS, JavaScript, PWA assets
- `hatchable-export/api/` — existing Hatchable API handlers
- `hatchable-export/lib/` — admin authorization helper
- `hatchable-export/migrations/` — SQL migrations
- `hatchable-export/hatchable.toml` — original Hatchable auth configuration

## Migration plan

1. Port the UI to the root `public/` folder and replace Hatchable auth calls with a standard session-based email OTP flow.
2. Implement equivalent Express API routes with PostgreSQL, validation, rate limits, secure cookies, and server-side authorization.
3. Configure environment variables on the chosen host; never commit `.env`, credentials, OTP secrets, or live user data.
4. Apply reviewed migrations to a separate test database first.
5. Test victim requests, volunteer verification, assignment, completion/cancellation, and admin permissions.
6. Deploy to a free hosting subdomain only after tests pass. Keep the current live Hatchable app available until the replacement is verified.

## Security notes

- Owner email should be supplied through the `OWNER_EMAIL` environment variable in the exported helper.
- Only verified volunteers may accept requests.
- Admin endpoints must reject unauthenticated users and non-admin users.
- Do not expose exact private locations for open emergency requests.
- Never commit database URLs, SMTP credentials, API tokens, or production data.

## Local setup

The exported files alone are not a standalone Node.js app. Follow the migration plan above before running or deploying this repository as the replacement application.

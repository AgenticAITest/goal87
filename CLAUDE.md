# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Pildun** is a friendly sports-betting web app (predict match scores, win/lose IDR stakes). Production URL: `https://bola.top87.id`.

**Stack:**
- Frontend: React 19 + Vite 6 + TypeScript + Tailwind CSS v4 + React Router v7
- Backend: Supabase (managed PostgreSQL + Auth + Realtime + RLS)
- Worker: Node.js 22 + Express + TypeScript — polls football-data.org for live scores and triggers settlement

## Commands

### Frontend (`frontend/`)
```bash
npm run dev      # Vite dev server on :5173
npm run build    # tsc -b && vite build
npm run preview  # Preview production build
```

### Worker (`worker/`)
```bash
npm run dev      # tsx watch mode (hot reload)
npm run build    # tsc to dist/
npm run start    # Run dist/index.js on :3001
```

### Docker (production)
```bash
docker compose -f docker-compose.prod.yml up -d --build            # Full deploy
docker compose -f docker-compose.prod.yml up -d --build score-worker  # Worker only
docker compose -f docker-compose.prod.yml logs -f                  # Live logs
```

### Database migrations
Run `supabase/migrations/*.sql` files in filename order via the Supabase dashboard SQL Editor. There is no CLI migration runner configured.

## Architecture

### Data flow
1. User authenticates via Google OAuth (Supabase Auth). Auth trigger auto-creates a `profiles` row with `status='pending'`.
2. Admin approves user via `/admin/members` → `status='active'`.
3. Active user submits predictions on open matches (locked at kickoff).
4. Worker polls football-data.org every 60s, updates `matches` table scores/statuses.
5. When a match reaches `FINISHED`, worker calls the `settle_match()` Postgres RPC.
6. `settle_match()` calculates winners (exact-score predictors split the loser pot), writes a `settlements` row per player, appends a `ledger` row, and updates the stored `profiles.balance_idr` — all in one pass.
7. Supabase Realtime pushes updates to frontend; user sees balance/leaderboard update live.

**Balances are stored, not calculated.** The `ledger` table is the live source of truth; `profiles.balance_idr` is a running total maintained inside the DB functions. The `leaderboard()` function reads the ledger (active members only). `settlements` rows are kept as the raw per-match log but are no longer authoritative for balances.

### Three-tier auth routing (`frontend/src/components/ProtectedRoute.tsx`)
- Any authenticated user: `<ProtectedRoute />`
- Must be active: `<ProtectedRoute requireActive />`
- Must be active + admin: `<ProtectedRoute requireAdmin />`

Unauthorized users are redirected to `/login`, `/pending`, or the dashboard accordingly.

### Worker (`worker/src/index.ts`)
Single Express app with a `startPoller()` loop:
- Polls only `IN_PLAY`/`PAUSED` matches more aggressively; skips recently polled matches.
- Rate-limits to respect football-data.org free tier (10 req/min): 7-second sleep between tournaments.
- Admin endpoints: `GET /health`, `GET /competitions`, `POST /pull-fixtures`, `POST /poll-now` — all require Supabase JWT + `is_admin` check.

### Database functions
The current authoritative definitions live in `supabase/migrations/20260622000002_ledger_live.sql` (later `CREATE OR REPLACE` overrides the originals in `20260522000003_functions.sql` — read the ledger migration, not the original, for live behavior). All run `SECURITY DEFINER` and take an advisory xact lock on the match.
- `settle_match(match_id)` — Identifies exact-score winners, splits the loser pot (integer division in IDR), inserts `settlements`, appends `ledger` rows, updates `profiles.balance_idr`, marks match settled. Idempotent (skips matches with `settled_at` set).
- `recalculate_match(match_id, admin_id)` — Reverses the current settlement's balance + ledger effect, voids, then re-runs `settle_match` (admin "re-settle" action).
- `void_match(match_id)` — Writes zero-amount voided settlements + a ledger trail; leaves balances unchanged (admin action).
- `leaderboard(tournament_id)` — Tournament P&L summed from the ledger, filtered to active members. Leaderboard logic lives here, not in frontend JS.
- `admin_set_balance(target_id, new_balance, note)` — Manual balance override after offline cash settlement; logs to `balance_ledger`.

### Key tables
| Table | Purpose |
|-------|---------|
| `profiles` | Extends `auth.users`; has `status` (pending/active/suspended) and `is_admin` |
| `tournaments` | Betting events linked to a football competition (e.g., 'PL') and season |
| `matches` | Fixtures with `api_match_id` (unique), kickoff time, scores, settlement state |
| `predictions` | One row per `(user_id, match_id)`; only visible to others after kickoff |
| `settlements` | Signed `amount_idr` per match per player; raw per-match log, only DB functions may insert |
| `ledger` | Live source of truth for balances; one row per balance-changing event with `balance_before`/`balance_after` |
| `balance_ledger` | Audit trail for manual admin balance overrides (`admin_set_balance`) |
| `highlight_clips` | Admin-curated highlight videos surfaced on the dashboard |
| `audit_log` | Immutable admin action log (before/after JSONB); only DB functions may write |

`profiles.balance_idr` holds the stored running balance (maintained by DB functions, not computed on read).

### Frontend structure
```
frontend/src/
├── components/          # Navbar, ProtectedRoute
├── hooks/useAuth.ts     # Auth state, profile, sign-out
├── lib/
│   ├── supabase.ts      # Supabase client singleton
│   ├── fmt.ts           # formatIDR() currency formatter
│   └── teamCrests.ts    # Maps team names → baked-in WC2026 crest assets
├── pages/
│   ├── Dashboard.tsx    # Main user page with live match list
│   ├── TournamentView.tsx
│   ├── TournamentSummary.tsx
│   └── admin/           # Members, Matches, Tournaments, Predictions, Sandbox, Highlights
├── types/database.ts    # TypeScript types mirroring Postgres schema
└── App.tsx              # React Router routes
```

## Environment Variables

**Frontend** (baked into the Vite bundle at build time via `--build-arg`):
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_WORKER_URL          # default: https://bola.top87.id/api/worker
```

**Worker** (read at runtime from `.env`):
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
FD_API_TOKEN             # football-data.org API key
POLL_INTERVAL_MS         # default: 60000
```

## Design System

- Mobile-first glassmorphic cards (semi-transparent + `backdrop-blur`)
- Tailwind v4 with custom tokens defined in `frontend/src/index.css`: charcoal background, gold accents, Playfair Display + Inter fonts
- Currency always displayed via `formatIDR()` (e.g., `Rp1,050,000`)
- Match status colors: `IN_PLAY` = yellow, `FINISHED` = gray, winner = gold

## Deployment

Production runs on a Hostinger Ubuntu 24.04 VPS behind Traefik reverse proxy:
- `/api/worker/*` → score-worker container (:3001)
- `/*` → frontend container (:8092, nginx serving SPA)

Nginx config (`nginx/nginx.conf`) falls back all paths to `index.html` for client-side routing and serves `/assets/` with `immutable` cache headers.

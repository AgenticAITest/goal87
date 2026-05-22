# Friendly Betting App — Implementation Plan

## Overview

A multi-tournament friendly betting web app. Players predict exact final scores (regulation time only, 2×45) for selected matches across tournaments. Stake is a fixed per-match amount (default Rp100,000, admin-configurable per tournament). Losers fund the pot; winners split equally. If no player predicts correctly, the match is void and nobody pays. Players opt into individual matches by submitting a prediction; not submitting = opt out for that match, and the pot shrinks accordingly.

**Stack:** React + Vite (React Router, Tailwind v4, mobile-first) + Supabase (Postgres, Auth, RLS, Realtime) + standalone Node.js score sync worker. Same stack as the TOP87 alumni site — no context switching between projects. The frontend builds to static files served by an nginx container; all three services run as Docker containers behind Traefik on the existing VPS. Login via Google OAuth. Live scores from football-data.org free tier.

**Estimated effort:** 12–16 dev-days for one senior developer, less with two devs working in parallel from Phase 3 onward.

---

## Phase 0 — Infrastructure setup

**Goal:** accounts, keys, and base infra ready before any code.

**Tasks**

- Register at football-data.org, capture free API key
- Provision new Supabase project (separate from the alumni site). Capture project URL, anon key, service-role key
- Configure new Google OAuth client in Google Cloud Console with redirect URI for the new subdomain
- Add new subdomain in DNS, point to the VPS
- Add Traefik routing rules for the subdomain
- Create `docker-compose.yml` skeleton with three services: `frontend` (nginx serving the Vite static build), `score-worker`, and (if self-hosting Supabase locally) `supabase`
- Create `.env` templates for `frontend` (`VITE_*` prefix — baked into the build at compile time) and `score-worker`

**Existing credentials (TOP87 alumni site — for reference):**

| Key | Value |
|---|---|
| Supabase URL | `https://mksmeuswpqkafenikrdg.supabase.co` |
| Supabase anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rc21ldXN3cHFrYWZlbmlrcmRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1Njc3MzIsImV4cCI6MjA5NDE0MzczMn0.WHosFlgR3pPLAyoUBjUlptwXlAUro1jAVbJimRwFhAQ` |
| Google OAuth client | Already configured in Google Cloud Console for `top87.id`. To reuse for the betting app, add the new subdomain's redirect URI to the same client — no need to create a new one. |

The betting app needs its own Supabase project (separate from TOP87) per the plan. The service-role key and Google OAuth client secret are in the Supabase dashboard → Authentication → Providers → Google.

**Done when:** subdomain resolves, Supabase API responds, Google login flow can issue a token, `GET /competitions/PL/matches?season=2025` on football-data.org returns Premier League fixtures.

**Effort:** 0.5–1 day

---

## Phase 1 — Data model & SQL functions

**Goal:** schema, RLS, triggers, and settlement logic. Foundation everything else builds on. Get this right and the rest is straightforward.

### Tables

- `profiles` — extends `auth.users`. Columns: `id`, `display_name`, `email`, `status` (pending/active/suspended), `is_admin`, `created_at`
- `tournaments` — `id`, `name`, `api_competition_id` (football-data.org code, e.g. "WC", "PL", "BL1"), `api_season` (year), `stake_idr` (default 100000), `start_at`, `end_at`, `status` (draft/open/closed), `created_at`
- `matches` — `id`, `tournament_id`, `api_match_id` (unique), `home_team`, `away_team`, `kickoff_at`, `status` (SCHEDULED/TIMED/IN_PLAY/PAUSED/FINISHED/POSTPONED/CANCELLED), `ft_home`, `ft_away`, `last_polled_at`, `settled_at`, `settled_by`
- `predictions` — `id`, `user_id`, `match_id`, `predicted_home`, `predicted_away`, `submitted_at`, `submitted_by` (self or admin id), unique on `(user_id, match_id)`
- `settlements` — `id`, `match_id`, `user_id`, `amount_idr` (signed integer), `is_winner`, `is_void` (default false), `voided_at`, `voided_by`, `created_at`
- `audit_log` — `id`, `actor_id`, `action` (enum), `target_type`, `target_id`, `before_jsonb`, `after_jsonb`, `created_at`

### Indexes

- `predictions(match_id)`, `predictions(user_id)`
- `settlements(user_id)`, `settlements(match_id) WHERE is_void = false`
- `matches(tournament_id, kickoff_at)`, `matches(status, kickoff_at)` (for the worker query)

### SQL functions

- `prevent_late_predictions()` — `BEFORE INSERT OR UPDATE` trigger on `predictions`. Rejects if `(SELECT kickoff_at FROM matches WHERE id = NEW.match_id) <= now()`. Belt-and-braces against UI bugs.
- `settle_match(p_match_id)` — idempotent. Acquires `pg_advisory_xact_lock(p_match_id)` at the top of the transaction to prevent concurrent calls from both reading `settled_at = NULL` before either writes. Skips if `settled_at IS NOT NULL`. Logic:
  1. Read match row; abort if `status != 'FINISHED'`
  2. Read all predictions for this match → these are the participants
  3. If `participants <= 1`: void — insert zero-amount settlements row(s) for audit so participation is recorded, set `settled_at = now()`, return. (A bet with one person isn't a bet; the sole participant, if any, gets no settlement.)
  4. Identify winners (`predicted_home = ft_home AND predicted_away = ft_away`)
  5. `winners > 0`: pot = `(participants - winners) × stake_idr`. Each winner: `+pot / winners` (integer division — sub-IDR remainder is dropped and acceptable for friendly use). Each loser: `-stake_idr`. Insert one settlements row per participant.
  6. `winners = 0`: void match — insert zero-amount settlements rows for all participants for audit. No money changes hands.
  7. Set `settled_at = now()`, `settled_by = 'auto'`
- `void_match(p_match_id, p_admin_id)` — for POSTPONED/CANCELLED. Insert zero-amount rows so participation is recorded but no money changes hands. Log to audit.
- `recalculate_match(p_match_id, p_admin_id)` — for admin score correction after settlement: mark existing settlements as `is_void = true`, `voided_at = now()`, `voided_by = p_admin_id`. Then call `settle_match()` again with the corrected score. Audit log captures actor + before/after.
- `leaderboard(p_tournament_id)` — view or function returning `(user_id, display_name, balance_idr, first_correct_at)`. Balance = `SUM(amount_idr) WHERE is_void = false`. Tiebreaker column = `MIN(submitted_at)` over correct predictions. Sort: `balance DESC, first_correct_at ASC`.

### RLS policies

- `profiles`: self can read/update own (except `status` and `is_admin`); admin can read/update all
- `tournaments`: any authenticated active user can read where `status = 'open'`; admin can CRUD
- `matches`: any authenticated active user can read; only admin or service-role (worker) can write
- `predictions`: self can insert/update own (the trigger enforces lock); self can read all predictions where `match.kickoff_at <= now()` (i.e. predictions become visible to others only after kickoff); admin can read/write any
- `settlements`: self can read own; admin can read all; only DB functions (service-role) can write
- `audit_log`: admin can read all; only DB functions can write

### Migrations

Use Supabase migration files (versioned, in `supabase/migrations/`). One file per logical change so rollbacks are clean.

After creating `matches` and `settlements`, enable full-row Realtime broadcasting:

```sql
ALTER TABLE matches REPLICA IDENTITY FULL;
ALTER TABLE settlements REPLICA IDENTITY FULL;
```

**Done when:** all tables exist, RLS verified with test users (cannot read others' predictions before kickoff, cannot insert prediction past kickoff), settlement function unit-tested for: zero participants, one participant, zero winners, one winner, multiple winners, void match, recalculate after correction (balance changes correctly).

**Effort:** 2–3 days

---

## Phase 2 — Auth & member management

**Goal:** login, approval queue, admin controls.

**Tasks**

- Auth setup with `@supabase/supabase-js` (client-side only — no SSR). Google OAuth provider configured in Supabase dashboard.
- Profile auto-create on first login (Postgres trigger on `auth.users` insert): `status = 'pending'`, `is_admin = false`, `display_name` from Google name
- Bootstrap first admin manually via SQL: `UPDATE profiles SET is_admin = true, status = 'active' WHERE email = '<your email>'`
- `/login` page — single "Sign in with Google" button
- `/pending` page — shown when `status = 'pending'`. Friendly "waiting for admin approval" message. Auto-redirects to `/` once approved (Supabase Realtime on the profile row).
- Route guards via React Router: a `ProtectedRoute` wrapper component reads the Supabase session and profile on load; redirects unapproved users to `/pending`, redirects non-admins away from `/admin/*` routes.
- `/admin/members` page: filterable list (all/pending/active/suspended); approve, suspend, delete actions; all writes go through audit log

**Done when:** a new Google user can sign up, lands on `/pending`, admin can approve them from `/admin/members`, they then see the player dashboard.

**Effort:** 1.5–2 days

---

## Phase 3 — Admin: tournaments & matches

**Goal:** admin can set up tournaments, pull fixtures, and override match data when needed.

**Tasks**

- `/admin/tournaments`: list + create + edit + close. Form fields: name, football-data.org competition code (with API validation to confirm code exists), season year, stake_idr, start/end dates, status
- "Pull fixtures" action on each tournament: the admin UI sends a `POST /pull-fixtures` request to the score worker (see Phase 4), authenticated with the admin's Supabase JWT. The worker validates the token, confirms `is_admin = true`, then calls football-data.org and upserts into `matches`. This keeps the football-data.org API key server-side only — it never touches the browser.
- `/admin/matches`: filterable by tournament; paginated (a full league season can be 380+ rows); columns for kickoff, teams, status, scores; row actions for status override, score override (FT only — no extra time), manual void, force-settle, recalculate. Score override + recalculate is also the mechanism for correcting a score after settlement (e.g. if football-data.org returns a wrong result); the worker does not re-poll FINISHED matches.
- `/admin/predictions`: search by player + match; admin-on-behalf entry form (player select, match select, scores). Trigger still applies the kickoff lock — admin cannot enter predictions for matches already started
- Every admin write action writes to `audit_log` with before/after JSONB

**Done when:** admin can create a World Cup tournament, pull its fixtures, edit any match's score manually, force a settlement, and have the action visible in the audit log.

**Effort:** 2.5–3 days

---

## Phase 4 — Score sync worker

**Goal:** standalone Node service that polls football-data.org, updates `matches`, triggers settlement on FT.

**Tasks**

- New TypeScript Node project (`/worker` directory in the repo). Single file is fine.
- football-data.org client: `axios` + a simple token-bucket throttle capped at 9 req/min (one under the limit, safety margin). Note: a busy Premier League Saturday can have 10 simultaneous matches in the polling window; at 9 req/min it takes just over 1 minute to poll all of them. Acceptable for friendly use — process `IN_PLAY` matches first in the loop to prioritize live score updates.
- Main loop runs every 60 seconds:
  1. Query `matches WHERE status IN ('SCHEDULED','TIMED','IN_PLAY','PAUSED') AND kickoff_at BETWEEN now() - interval '4 hours' AND now() + interval '15 minutes'`. Order `IN_PLAY` and `PAUSED` first.
  2. For each: skip if `last_polled_at` is within the last 5 minutes
  3. Fetch `/matches/{api_match_id}`. Update `status` and `last_polled_at`. Only update `ft_home` and `ft_away` when the new status is `FINISHED` (the API returns null for these fields during live play). Read score from `score.regularTime.home` / `score.regularTime.away` — not `score.fullTime` — to capture regulation-time result only, regardless of extra time.
  4. On status transition to `FINISHED`: call `settle_match(id)` via Supabase RPC
  5. On status transition to `POSTPONED` or `CANCELLED`: call `void_match(id, NULL)` via RPC
- Structured JSON logging to stdout (so Docker captures it)
- HTTP `/health` endpoint for Traefik health checks
- HTTP `POST /pull-fixtures` endpoint (admin-triggered fixture import). Accepts `{ competition_code, season, tournament_id }` body + `Authorization: Bearer <supabase-jwt>` header. Worker validates the JWT via Supabase, checks `is_admin = true` on the profile, then fetches `/competitions/{code}/matches?season=YYYY` from football-data.org and upserts into `matches`. Returns `{ inserted, updated, errors }` synchronously. Exposed via Traefik on the same subdomain under `/api/worker/pull-fixtures`.
- Docker container with `restart: always`

### Worker pseudocode

```
loop every 60s:
  now = current_timestamp()  // compute once per iteration

  matches = supabase.from('matches')
    .select('*')
    .in('status', ['SCHEDULED','TIMED','IN_PLAY','PAUSED'])
    .gte('kickoff_at', now - 4h)
    .lte('kickoff_at', now + 15min)
    .order('status', { IN_PLAY and PAUSED first })  // prioritize live matches

  for m in matches:
    if m.last_polled_at && (now - m.last_polled_at) < 5min: continue

    response = await fd_client.get(`/matches/${m.api_match_id}`)
    prev_status = m.status
    new_status = response.status

    update_payload = {
      status: new_status,
      last_polled_at: now
    }

    // Only write scores when the match is finished (API returns null during live play).
    // Use regularTime, not fullTime, to capture regulation result only.
    if new_status == 'FINISHED':
      update_payload.ft_home = response.score.regularTime.home
      update_payload.ft_away = response.score.regularTime.away

    await supabase.from('matches').update(update_payload).eq('id', m.id)

    if prev_status != 'FINISHED' && new_status == 'FINISHED':
      await supabase.rpc('settle_match', { p_match_id: m.id })
    elif new_status in ('POSTPONED', 'CANCELLED'):
      await supabase.rpc('void_match', { p_match_id: m.id, p_admin_id: null })
```

**Done when:** during a weekend, the worker can pick up a live Premier League match, update its score every 5 min, and automatically settle when the match finishes. Verified by checking the leaderboard updates in real time on the frontend.

**Effort:** 1.5–2 days

---

## Phase 5 — Player experience

**Goal:** the actual user-facing product. Mobile-first.

**Tasks**

- `/` dashboard
  - List of open tournaments
  - Per-tournament balance card (running total in IDR, formatted `Rp1,050,000`)
  - "Upcoming matches you haven't predicted" — next 5 matches across all tournaments
- `/tournaments/[id]`
  - Match list grouped by status: upcoming (with predict button), live (with live score banner), finished (with your prediction, actual score, and settlement amount). Paginated — a full season can be 380+ matches.
  - Leaderboard panel: all participants, balance, sortable, tiebreaker via earliest correct prediction
- `/match/[id]`
  - Two number inputs (home goals, away goals) + submit button
  - Form disabled if `kickoff_at <= now` (trigger also enforces this server-side)
  - Live score banner subscribed to `matches` row via Supabase Realtime
  - After kickoff: reveal all other players' predictions
  - After FT and settlement: show settlement breakdown (winners, losers, amounts)
- `/history`
  - All your predictions, settled and pending, filterable by tournament
  - CSV export (nice-to-have, can defer)
- Currency formatter utility: Indonesian `Rp` with comma thousands, no decimals
- Realtime subscriptions on the match page (score updates) and the leaderboard (balance changes after settlement). The predictions Realtime channel (`predictions:match_id=eq.{id}`) must only be opened after `kickoff_at <= now` — opening it before kickoff would expose other players' predictions in real time.
- Responsive layout, tested at 360px viewport width

**Done when:** a non-admin player can log in, see active tournaments, submit a prediction on an upcoming match, watch the live score update during the match, see the settlement appear automatically after FT, view their balance and history.

**Effort:** 4–5 days

---

## Phase 6 — Polish & launch

**Goal:** production-ready.

**Tasks**

- Empty states (no tournaments, no predictions yet, no history)
- Error states (API down, prediction lock just expired, score correction in progress)
- Admin audit log viewer at `/admin/audit`
- Backup strategy: nightly `pg_dump` of Supabase to VPS local disk (or S3)
- Pre-launch dress rehearsal: create a mock tournament using the upcoming weekend's Premier League matches; run end-to-end with admin + 2 test player accounts; verify settlement, void, and recalculate work
- Production deploy
- Onboard real players: collect Google account emails, pre-approve via SQL, share signup link

**Done when:** real players can log in and use the app for a full match cycle without you intervening.

**Effort:** 1.5–2 days

---

## UI/UX Design System

Mirrors the TOP87 alumni site exactly — same stack, same tokens, same component patterns. Copy the design system wholesale; don't redesign.

### Dependencies

- **Tailwind CSS v4** via `@tailwindcss/vite` plugin. No separate config file — all customisation in `src/index.css` using `@theme`.
- **Motion** (Framer Motion) for animations.
- **Lucide React** for icons.

### Design tokens (`src/index.css`)

```css
@theme {
  --color-charcoal: #111111;     /* primary background */
  --color-navy:     #0A192F;     /* secondary bg / overlays */
  --color-gold:     #D4AF37;     /* primary accent */
  --color-gold-light: #F9E27D;  /* hover / lighter accent */
  --font-serif: "Playfair Display", serif;
  --font-sans:  "Inter", sans-serif;
}

.glass      { @apply bg-white/5 backdrop-blur-md border border-white/10; }
.glass-gold { @apply bg-gold/5  backdrop-blur-md border border-gold/20; }
.gold-glow  { text-shadow: 0 0 10px rgba(212, 175, 55, 0.5); }
```

### Typography

| Role | Classes |
|---|---|
| Page / section heading | `font-serif font-bold text-white` |
| Section label (eyebrow) | `text-xs uppercase tracking-[0.3em] text-gold font-bold` |
| Body text | `font-sans text-gray-300` |
| Secondary / meta text | `font-sans text-gray-400 text-sm` |
| Caption / timestamp | `text-xs text-gray-500 uppercase tracking-widest` |

### Layout

- Root: `bg-charcoal min-h-screen font-sans`
- Container: `max-w-7xl mx-auto px-6`
- Inner page vertical padding: `py-8`
- **Grid: max 2 columns.** The betting app has few content types. Default to 1-col on mobile, 2-col (`sm:grid-cols-2`) on tablet and above. Never 3 or 4 columns.
- List rows (matches, leaderboard, history): stacked with `space-y-3`. Use `.glass` cards as rows, not HTML `<table>`.

### Status color mapping

| State | Text | Background |
|---|---|---|
| Live / IN_PLAY | `text-yellow-400` | `bg-yellow-400/10` |
| Upcoming / SCHEDULED | `text-white` | `bg-white/5` |
| Finished | `text-gray-400` | `bg-white/5` |
| Postponed / Cancelled | `text-orange-400` | `bg-orange-400/10` |
| Winner (settlement) | `text-gold` | `bg-gold/10` |
| Loser (settlement) | `text-red-400` | `bg-red-400/10` |
| Void match | `text-gray-500` | `bg-white/5` |
| Member pending | `text-yellow-400` | `bg-yellow-400/10` |
| Member active | `text-green-400` | `bg-green-500/10` |
| Member suspended | `text-orange-400` | `bg-orange-400/10` |

### Core component patterns

**Card**: `.glass rounded-2xl p-5 hover:border-gold/20 transition-colors`

**Primary button**: `bg-gold hover:bg-gold-light text-charcoal px-8 py-4 rounded-full font-bold tracking-widest transition-colors shadow-[0_0_20px_rgba(212,175,55,0.3)]`

**Secondary / ghost button**: `.glass px-6 py-3 rounded-full uppercase tracking-widest text-sm hover:bg-white/10 transition-colors`

**Text input**: `bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-gold/50 transition-colors`

**Score input** (the goal number fields): same as text input + `w-16 text-center text-2xl font-bold`

**Status badge / pill**: `rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest font-bold`

**Avatar**: Circular photo; fallback is a gold-background circle with initials.

**Animations**: Motion staggered entry on list items (`delay: i * 0.04`). Dropdown pop-in: `opacity/y/scale 0.95 → 1`.

### Page-by-page layout notes

- **`/login`**: Full-screen charcoal. Centered card with logo + single "Sign in with Google" button. No nav.
- **`/pending`**: Same centered card layout. Friendly approval message. Supabase Realtime on own profile row auto-redirects once approved.
- **`/` (dashboard)**: Section heading. Balance cards in a 1-col (mobile) / 2-col (tablet+) grid. "Upcoming matches without a prediction" as stacked `.glass` rows below.
- **`/tournaments/[id]`**: Match rows (full width, 1-col) grouped into upcoming / live / finished sections. Leaderboard as stacked rows below the match list. Paginated.
- **`/match/[id]`**: Match header card. Score input row: two `w-16` number inputs with a `vs` label between them. Live score banner when IN_PLAY. Other players' predictions revealed after kickoff as stacked rows. Settlement breakdown (winners / losers / amounts) after FT.
- **`/history`**: Tournament + status filter bar. Stacked prediction rows showing match, prediction, result, and settlement amount.
- **`/admin/*`**: Same glass card patterns as player pages. Member and match lists as stacked rows. Action buttons as small icon-pill pairs.

---

## Suggested sequencing

Phase 0 → Phase 1 → Phase 2 in series (each depends on the previous). Phases 3 and 4 can run in parallel if two devs available — Phase 3 is frontend-heavy, Phase 4 is a self-contained worker. Phase 5 starts once 2 and 4 are done (needs working schema + at least one match in the system to test against). Phase 6 last.

---

## Deferred to v2

- WhatsApp / Telegram kickoff reminders for unfilled predictions
- Indonesian / Asian league support (requires different API; football-data.org doesn't cover them)
- Alternative prediction types beyond exact score (over/under, first scorer, correct outcome only)
- Social features (chat per match, reactions on predictions, badges)
- Native mobile apps (PWA install prompt may be enough)

---

## Open items needing your input

- **Tiebreaker semantics.** Among players with tied balance, "earliest correct prediction" interpretation: (a) whoever's very first correct prediction across all matches was submitted earliest in absolute time, or (b) whoever consistently submits correct predictions earliest relative to kickoff (e.g. cumulative "minutes before kickoff" over correct predictions). I've defaulted the plan to (a). Flag if you want (b).
- **First admin email** to bootstrap `is_admin = true` in Phase 2.
- **Subdomain name** for the app (e.g. `bet.yourdomain.com`).
- **Self-hosted Supabase vs Supabase Cloud** — which is your alumni site using? Plan assumes whichever is in place; cost and operations differ slightly. If self-hosted, add ~0.5 day to Phase 0 for the second Supabase instance setup.

---

## Out-of-scope assumptions

- No real money transfer is built in. Settlements are bookkeeping only; payment between players happens offline (WhatsApp transfer, cash, however the group already settles up).
- Single language (English). Bahasa Indonesia translation is straightforward to add later via i18n but not in scope.
- No KYC, no compliance layer. This is a private friendly group, not a public gambling platform.

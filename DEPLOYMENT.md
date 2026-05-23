# Deployment Guide — pildun (bola.top87.id)

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 6, served by nginx inside Docker |
| Worker | Node 22, Express, polls football-data.org |
| Database | Supabase cloud (project: `pildun`, ref: `wgaoxftcxpoacxeqisxt`) |
| VPS | Hostinger srv1664106, Ubuntu 24.04, IP `187.77.117.43` |
| Reverse proxy | nginx (native on VPS) + Let's Encrypt via certbot |
| Container orchestration | Docker Compose (`docker-compose.prod.yml`) |

---

## One-time infrastructure setup

### 1. DNS

In Hostinger DNS Manager for `top87.id`, add an A record:

| Host | Points to | TTL |
|------|-----------|-----|
| `bola` | `187.77.117.43` | 14400 |

### 2. nginx config

Create `/etc/nginx/sites-available/bola.top87.id`:

```nginx
server {
    server_name bola.top87.id;

    location /api/worker/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8092;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
```

Enable and test:
```bash
ln -s /etc/nginx/sites-available/bola.top87.id /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 3. SSL certificate

```bash
certbot --nginx -d bola.top87.id --non-interactive --agree-tos -m chibib.bibieb@gmail.com
```

Certbot auto-configures renewal. Certificate expires 90 days; auto-renewed by the systemd timer installed by certbot.

### 4. Clone the repo

```bash
git clone https://github.com/AgenticAITest/goal87.git /opt/bola
```

### 5. Create `.env`

Create `/opt/bola/.env` (never commit this file):

```env
FD_API_TOKEN=0fe9f577feb64cb0be35e5453ae9af58

SUPABASE_URL=https://wgaoxftcxpoacxeqisxt.supabase.co
SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase dashboard>

VITE_SUPABASE_URL=https://wgaoxftcxpoacxeqisxt.supabase.co
VITE_SUPABASE_ANON_KEY=<same as SUPABASE_ANON_KEY>
VITE_WORKER_URL=https://bola.top87.id/api/worker

POLL_INTERVAL_MS=60000
```

Keys are in: Supabase dashboard → Project Settings → API → **API Keys (Legacy)**.

### 6. First build & deploy

```bash
cd /opt/bola
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tee /tmp/bola-build.log
```

Verify containers are running:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep bola
```

Expected output:
```
bola-frontend-1       Up N minutes   127.0.0.1:8092->80/tcp
bola-score-worker-1   Up N minutes   127.0.0.1:3001->3001/tcp
```

---

## Database migrations

Run once against the production Supabase project. Open the SQL Editor:

```
https://supabase.com/dashboard/project/wgaoxftcxpoacxeqisxt/sql/new
```

Paste and run the contents of all files in `supabase/migrations/` **in filename order**:

```
20260522000001_tables.sql
20260522000002_rls.sql
20260522000003_functions.sql
20260522000004_realtime.sql
20260522000005_auth_trigger.sql
20260522000006_admin_functions.sql
20260522000007_nullable_competition.sql
20260522000008_relax_rls.sql
20260522000009_highlight_clips.sql
```

---

## Google OAuth setup

### Supabase side

1. Supabase dashboard → Authentication → Sign In / Providers → Google
2. Enable, and enter:
   - **Client ID**: `521383591339-mqh58rogc4fhb9epjo0ugd0hq03uphan.apps.googleusercontent.com`
   - **Client Secret**: from Google Cloud Console → "bola" project (wyahya@gmail.com) → Google Auth Platform → Clients → this OAuth client → Add secret
3. Save

Then under **URL Configuration**:
- **Site URL**: `https://bola.top87.id`
- **Redirect URLs**: add `https://bola.top87.id/**`

### Google Cloud Console side

The existing OAuth 2.0 client for `top87.id` is reused. You must add the new callback URI:

1. Go to Google Cloud Console → sign in as **wyahya@gmail.com** → select project **bola**
2. Google Auth Platform → Clients → click `521383591339-mqh58rogc4fhb9epjo0ugd0hq03uphan`
3. Under **Authorized redirect URIs**, ensure this is listed:
   ```
   https://wgaoxftcxpoacxeqisxt.supabase.co/auth/v1/callback
   ```
4. Save

---

## Post-deployment: first admin

After logging in for the first time via Google at `https://bola.top87.id`:

1. Your profile is created with `status = 'pending'`
2. Run in the Supabase SQL editor:

```sql
UPDATE profiles
SET status = 'active', is_admin = true
WHERE email = 'your-email@gmail.com';
```

---

## Redeployment (code updates)

```bash
ssh root@187.77.117.43
cd /opt/bola
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

To rebuild only the worker (faster, no frontend rebuild):
```bash
docker compose -f docker-compose.prod.yml up -d --build score-worker
```

To rebuild only the frontend:
```bash
docker compose -f docker-compose.prod.yml up -d --build frontend
```

---

## Logs & debugging

```bash
# Live logs from both containers
docker compose -f docker-compose.prod.yml logs -f

# Worker logs only
docker logs bola-score-worker-1 --tail 50 -f

# Frontend logs (nginx)
docker logs bola-frontend-1 --tail 50

# nginx error log
tail -f /var/log/nginx/error.log
```

### Manual score poll

```bash
curl -X POST https://bola.top87.id/api/worker/poll-now \
  -H "Authorization: Bearer <your-supabase-jwt>"
```

---

## Key URLs

| Purpose | URL |
|---------|-----|
| Production app | https://bola.top87.id |
| Supabase dashboard | https://supabase.com/dashboard/project/wgaoxftcxpoacxeqisxt |
| Supabase SQL editor | https://supabase.com/dashboard/project/wgaoxftcxpoacxeqisxt/sql/new |
| Worker health check | https://bola.top87.id/api/worker/health |
| GitHub repo | https://github.com/AgenticAITest/goal87 |

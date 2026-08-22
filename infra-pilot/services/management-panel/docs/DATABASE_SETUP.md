# database setup instructions

## using supabase with docker compose

### step 1: clone supabase docker repository

```bash
git clone https://github.com/supabase/supabase.git
cd supabase/docker
```

### step 2: configure environment

edit `docker/.env` and set a strong jwt secret:

```bash
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
```

### step 3: start supabase

```bash
docker compose up -d
```

this starts:
- api: http://localhost:8000
- supabase dashboard: http://localhost:3000
- postgresql: localhost:5432

### step 4: access dashboard

• go to http://localhost:3000
• email: `supabase@example.com`
• password: `password`

### step 5: create anon key

• in supabase dashboard, go to **settings → api**
• copy the `anon` public key
• add to `.env.local`:
   ```
   VITE_SUPABASE_ANON_KEY=eyJhbGc...
   ```

### step 6: initialize schema

• in supabase dashboard, go to **sql editor**
• create new query
• copy contents of `db/schema.sql`
• execute

or via psql:

```bash
psql -h localhost -U postgres -d postgres < db/schema.sql
```

(default postgres password: `postgres`)

### step 7: enable jwt auth

in supabase dashboard → settings → auth, ensure:
- email/password enabled
- email confirmation disabled (for dev)

## environment variables

create `.env.local`:

```bash
# Supabase (Docker Compose)
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<copy-from-dashboard>

# API Backend
VITE_API_URL=http://localhost:3001

# Docker
DOCKER_HOST=unix:///var/run/docker.sock
```

## production deployment

### using managed supabase

• sign up at https://supabase.com
• create a new project
• go to settings → api
• copy your `url` and `anon key`
• set in production environment:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-key>
   ```
• run schema migration on your production database

### self-hosted postgresql

if not using supabase, you need to:

• set up postgresql 15+
• create a database for the panel
• run `db/schema.sql` to initialize
• set up supabase auth (separate component) or migrate to a simpler auth method
• update backend to connect to your postgresql instance

## troubleshooting

### port 54321 already in use
```bash
lsof -i :54321
kill -9 <PID>
# Or change docker-compose port mapping
```

### can't connect to postgresql
```bash
docker compose logs postgres
# Check credentials in docker/.env
```

### schema migration fails
```bash
# Check DB logs
docker compose logs postgres

# Verify psql connection
psql -h localhost -U postgres -d postgres
```

### jwt secret format invalid
must be minimum 32 characters. generate with:

```bash
openssl rand -base64 32
```

## next steps

once setup is complete:

```bash
npm run dev
```

then visit http://localhost:5173 to initialize the panel.

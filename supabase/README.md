# Supabase

Project ref `egxjnsvizvuvtegysndi` (Seoul, ap-northeast-2). Keys live in the root `.env.local` only.

## Applying migrations

Applied by hand with psql through the session pooler (direct `db.<ref>.supabase.co` is IPv6-only):

```bash
PGPASSWORD=... psql -h aws-0-ap-northeast-2.pooler.supabase.com -p 5432 -U postgres.egxjnsvizvuvtegysndi -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/<file>.sql
```

| Migration | Applied |
|---|---|
| 20261115000000_init.sql | 2026-11-15 |
| 20261115120000_plans_workout.sql | 2026-11-15 |
| 20261115170000_multi_user_profiles.sql | 2026-11-15 |
| 20261115190000_ai_usage.sql | 2026-11-15 (server-only writes, not synced) |

After applying: every public table must show RLS on, one owner policy, and membership in `supabase_realtime`.

## Auth settings (dashboard)

- URL Configuration: Site URL `https://diet-routine.vercel.app`, redirect URLs `https://diet-routine.vercel.app/**`, `http://localhost:4792/**`, `dietroutine://**` (iPhone Google sign-in)
- Email template "Magic Link": include `{{ .Token }}` so the iPhone app can sign in with the 6-digit code

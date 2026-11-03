-- Smart SOS initial schema
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text, updated_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  pass_hash text NOT NULL,
  pw_version int NOT NULL DEFAULT 1,
  disabled boolean NOT NULL DEFAULT false,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  key_enc text,
  partner text NOT NULL,
  org_name text NOT NULL,
  webhook_url text,
  webhook_secret text NOT NULL,
  read_token text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  owner_admin_id uuid NULL REFERENCES admins(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS partner_keys_owner ON partner_keys(owner_admin_id);

CREATE TABLE IF NOT EXISTS partner_activity (
  id bigserial PRIMARY KEY,
  key_id uuid REFERENCES partner_keys(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  method text, endpoint text, session_id text, status int, ip text
);
CREATE INDEX IF NOT EXISTS partner_activity_key_ts ON partner_activity(key_id, ts DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  source text, partner text,
  key_id uuid NULL REFERENCES partner_keys(id) ON DELETE SET NULL,
  owner_admin_id uuid NULL,
  external_ref text, device_id text, decoy_name text,
  "user" jsonb, metadata jsonb,
  room text, active boolean NOT NULL DEFAULT false, status text,
  started_at bigint, ended_at bigint, end_reason text, ended_by text,
  callback_url text,
  last_lat double precision, last_lng double precision, last_acc double precision, last_seen bigint,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner_admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_key ON sessions(key_id);
CREATE INDEX IF NOT EXISTS sessions_active ON sessions(active);

CREATE TABLE IF NOT EXISTS session_locations (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts bigint NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, acc double precision, speed double precision
);
CREATE INDEX IF NOT EXISTS session_locations_s ON session_locations(session_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS session_locations_uq ON session_locations(session_id, ts, lat, lng);

CREATE TABLE IF NOT EXISTS session_nearby (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts bigint NOT NULL, data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS session_nearby_s ON session_nearby(session_id, ts DESC);

CREATE TABLE IF NOT EXISTS session_events (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts bigint NOT NULL, type text NOT NULL, data jsonb
);
CREATE INDEX IF NOT EXISTS session_events_s ON session_events(session_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS session_events_uq ON session_events(session_id, ts, type);

CREATE TABLE IF NOT EXISTS media_files (
  id bigserial PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind text NOT NULL, cam text, rel_path text NOT NULL, name text NOT NULL,
  bytes bigint, mime text, duration_ms int, seq int,
  created_at timestamptz NOT NULL DEFAULT now(),
  marked boolean NOT NULL DEFAULT false, merged boolean NOT NULL DEFAULT false,
  UNIQUE (session_id, rel_path)
);
CREATE INDEX IF NOT EXISTS media_files_s ON media_files(session_id, kind);

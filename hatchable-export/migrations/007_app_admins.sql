CREATE TABLE IF NOT EXISTS app_admins (
  user_id TEXT PRIMARY KEY,
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_admins_created_at_idx ON app_admins(created_at);
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(80) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES
  ('organization_name', '"Netra NOC"'::jsonb),
  ('timezone', '"Asia/Jakarta"'::jsonb),
  ('dashboard_refresh_seconds', '30'::jsonb),
  ('default_monitoring_method', '"icmp"'::jsonb)
ON CONFLICT (key) DO NOTHING;

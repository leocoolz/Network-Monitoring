CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE CHECK (username = LOWER(username)),
  password_hash TEXT NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator', 'viewer', 'auditor')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_hash CHAR(64) NOT NULL,
  ip_address INET,
  user_agent VARCHAR(500),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  model VARCHAR(160) NOT NULL,
  type VARCHAR(40) NOT NULL,
  code VARCHAR(4) NOT NULL,
  ip_address INET NOT NULL UNIQUE,
  location VARCHAR(200) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'warning', 'offline', 'unknown')),
  monitoring_method VARCHAR(20) NOT NULL DEFAULT 'icmp' CHECK (monitoring_method IN ('icmp', 'snmp', 'tcp', 'api', 'onvif')),
  tcp_port INTEGER CHECK (tcp_port BETWEEN 1 AND 65535),
  cpu_percent NUMERIC(5,2) CHECK (cpu_percent BETWEEN 0 AND 100),
  memory_percent NUMERIC(5,2) CHECK (memory_percent BETWEEN 0 AND 100),
  traffic_mbps NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (traffic_mbps >= 0),
  latency_ms NUMERIC(10,2) CHECK (latency_ms >= 0),
  uptime_seconds BIGINT NOT NULL DEFAULT 0 CHECK (uptime_seconds >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS devices_status_idx ON devices(status);
CREATE INDEX IF NOT EXISTS devices_type_idx ON devices(type);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title VARCHAR(180) NOT NULL,
  detail VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'acknowledged', 'resolved')),
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alerts_status_created_idx ON alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_device_idx ON alerts(device_id);

CREATE TABLE IF NOT EXISTS traffic_samples (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('all', 'internet', 'wan', 'lan')),
  download_mbps NUMERIC(14,2) NOT NULL CHECK (download_mbps >= 0),
  upload_mbps NUMERIC(14,2) NOT NULL CHECK (upload_mbps >= 0),
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS traffic_samples_scope_time_idx ON traffic_samples(scope, sampled_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_user_time_idx ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_time_idx ON audit_logs(action, created_at DESC);

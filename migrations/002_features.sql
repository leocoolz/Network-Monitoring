-- ============================================================================
-- MIGRATION 002: Add notification, escalation, maintenance, SLA, groups, etc
-- ============================================================================

-- Device Groups (for organization and escalation)
CREATE TABLE IF NOT EXISTS device_groups (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS device_groups_name_idx ON device_groups(name);

-- Device Group Members
CREATE TABLE IF NOT EXISTS device_group_members (
  group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, device_id)
);
CREATE INDEX IF NOT EXISTS device_group_members_device_idx ON device_group_members(device_id);

-- Notification Channels (email, webhook, teams, slack, etc)
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY,
  type VARCHAR(30) NOT NULL CHECK (type IN ('email', 'webhook', 'teams', 'slack', 'telegram')),
  name VARCHAR(100) NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_channels_type_idx ON notification_channels(type);

-- Notification Preferences (who gets notified and how)
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('critical', 'warning', 'info', 'all')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, channel_id, severity)
);
CREATE INDEX IF NOT EXISTS notification_preferences_user_idx ON notification_preferences(user_id);

-- Alert Escalation Policies
CREATE TABLE IF NOT EXISTS alert_escalation_policies (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500),
  device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL,
  escalation_minutes INTEGER NOT NULL CHECK (escalation_minutes > 0),
  escalate_to_group VARCHAR(100),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert Escalation History
CREATE TABLE IF NOT EXISTS alert_escalation_history (
  id BIGSERIAL PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES alert_escalation_policies(id) ON DELETE SET NULL,
  escalation_level INTEGER NOT NULL CHECK (escalation_level > 0),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alert_escalation_history_alert_idx ON alert_escalation_history(alert_id);

-- Maintenance Windows (suppress alerts during maintenance)
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(500),
  device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  suppress_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS maintenance_windows_start_idx ON maintenance_windows(start_time);
CREATE INDEX IF NOT EXISTS maintenance_windows_device_group_idx ON maintenance_windows(device_group_id);
CREATE INDEX IF NOT EXISTS maintenance_windows_device_idx ON maintenance_windows(device_id);

-- SLA Policies
CREATE TABLE IF NOT EXISTS sla_policies (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500),
  device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL,
  target_uptime_percent NUMERIC(5,2) NOT NULL CHECK (target_uptime_percent BETWEEN 0 AND 100),
  response_time_minutes INTEGER CHECK (response_time_minutes > 0),
  resolution_time_minutes INTEGER CHECK (resolution_time_minutes > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SLA History (monthly tracking)
CREATE TABLE IF NOT EXISTS sla_history (
  id UUID PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  month_year DATE NOT NULL,
  target_uptime_percent NUMERIC(5,2) NOT NULL,
  actual_uptime_percent NUMERIC(5,2) NOT NULL,
  total_downtime_seconds BIGINT NOT NULL DEFAULT 0,
  total_incidents INTEGER NOT NULL DEFAULT 0,
  avg_response_minutes NUMERIC(10,2),
  avg_resolution_minutes NUMERIC(10,2),
  sla_met BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(policy_id, device_id, month_year)
);
CREATE INDEX IF NOT EXISTS sla_history_policy_idx ON sla_history(policy_id);
CREATE INDEX IF NOT EXISTS sla_history_device_idx ON sla_history(device_id);

-- Device Configurations (backup)
CREATE TABLE IF NOT EXISTS device_configurations (
  id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  config_data TEXT NOT NULL,
  config_hash CHAR(64) NOT NULL,
  backup_type VARCHAR(30) NOT NULL CHECK (backup_type IN ('manual', 'automatic', 'export')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS device_configurations_device_idx ON device_configurations(device_id);
CREATE INDEX IF NOT EXISTS device_configurations_created_idx ON device_configurations(created_at DESC);

-- Scheduled Reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('sla', 'uptime', 'traffic', 'incidents', 'custom')),
  device_group_id UUID REFERENCES device_groups(id) ON DELETE SET NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  format VARCHAR(20) NOT NULL CHECK (format IN ('pdf', 'csv', 'html', 'email')),
  recipients TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scheduled_reports_next_run_idx ON scheduled_reports(next_run_at);

-- Notification Events (log sent notifications)
CREATE TABLE IF NOT EXISTS notification_events (
  id BIGSERIAL PRIMARY KEY,
  alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES notification_channels(id) ON DELETE SET NULL,
  recipient VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retried')),
  error_message VARCHAR(500),
  retry_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_events_alert_idx ON notification_events(alert_id);
CREATE INDEX IF NOT EXISTS notification_events_status_idx ON notification_events(status);
CREATE INDEX IF NOT EXISTS notification_events_created_idx ON notification_events(created_at DESC);

-- Topology (device relationships/links)
CREATE TABLE IF NOT EXISTS device_topology (
  id UUID PRIMARY KEY,
  source_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  target_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL CHECK (relationship_type IN ('upstream', 'downstream', 'peer', 'redundant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_device_id, target_device_id, relationship_type),
  CHECK (source_device_id != target_device_id)
);
CREATE INDEX IF NOT EXISTS device_topology_source_idx ON device_topology(source_device_id);
CREATE INDEX IF NOT EXISTS device_topology_target_idx ON device_topology(target_device_id);
CREATE INDEX IF NOT EXISTS device_topology_type_idx ON device_topology(relationship_type);

-- WebSocket Session Tracking (for real-time updates)
CREATE TABLE IF NOT EXISTS ws_sessions (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subscribed_groups TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ws_sessions_user_idx ON ws_sessions(user_id);
CREATE INDEX IF NOT EXISTS ws_sessions_last_heartbeat_idx ON ws_sessions(last_heartbeat);

-- API Tokens (for programmatic access, webhooks)
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  scopes TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS api_tokens_expires_idx ON api_tokens(expires_at);

-- Device Auto-Discovery Tables
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  target_subnet CIDR NOT NULL,
  scanning_method VARCHAR(20) NOT NULL CHECK (scanning_method IN ('icmp', 'arp', 'snmp', 'tcp')),
  total_hosts_scanned INTEGER NOT NULL DEFAULT 0,
  devices_discovered INTEGER NOT NULL DEFAULT 0,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discovery_sessions_user_time_idx ON discovery_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovery_sessions_status_idx ON discovery_sessions(status);

CREATE TABLE IF NOT EXISTS discovered_devices (
  id UUID PRIMARY KEY,
  discovery_session_id UUID NOT NULL REFERENCES discovery_sessions(id) ON DELETE CASCADE,
  ip_address INET NOT NULL,
  mac_address VARCHAR(17),
  hostname VARCHAR(255),
  device_type VARCHAR(100),
  manufacturer VARCHAR(255),
  port_open INTEGER,
  service_detected VARCHAR(100),
  snmp_community_string VARCHAR(100),
  snmp_sys_description TEXT,
  snmp_sys_name VARCHAR(255),
  response_time_ms NUMERIC(10,2),
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_as_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discovered_devices_session_idx ON discovered_devices(discovery_session_id);
CREATE INDEX IF NOT EXISTS discovered_devices_ip_address_idx ON discovered_devices(ip_address);
CREATE INDEX IF NOT EXISTS discovered_devices_is_approved_idx ON discovered_devices(is_approved);
CREATE UNIQUE INDEX IF NOT EXISTS discovered_devices_unique_per_session ON discovered_devices(discovery_session_id, ip_address);

CREATE TABLE IF NOT EXISTS discovery_result_details (
  id BIGSERIAL PRIMARY KEY,
  discovered_device_id UUID NOT NULL REFERENCES discovered_devices(id) ON DELETE CASCADE,
  probe_type VARCHAR(50) NOT NULL,
  probe_result VARCHAR(20) NOT NULL CHECK (probe_result IN ('success', 'timeout', 'error', 'filtered')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discovery_result_details_device_idx ON discovery_result_details(discovered_device_id);

CREATE TABLE IF NOT EXISTS discovery_settings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  target_subnets TEXT[] NOT NULL,
  scanning_methods VARCHAR(20)[] NOT NULL DEFAULT ARRAY['icmp'],
  snmp_community_strings TEXT[] DEFAULT ARRAY['public'],
  tcp_ports INTEGER[] DEFAULT ARRAY[22, 23, 80, 443, 161, 5900, 9200],
  auto_import_matching BOOLEAN NOT NULL DEFAULT FALSE,
  auto_import_rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS discovery_settings_user_idx ON discovery_settings(user_id);

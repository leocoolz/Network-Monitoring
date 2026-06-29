ALTER TABLE devices ADD COLUMN IF NOT EXISTS snmp_community_encrypted TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS snmp_version VARCHAR(10) DEFAULT 'v2c';
ALTER TABLE devices DROP COLUMN IF EXISTS snmp_community;

ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_snmp_version_check;
ALTER TABLE devices ADD CONSTRAINT devices_snmp_version_check CHECK (snmp_version IN ('v1', 'v2c'));

ALTER TABLE discovered_devices DROP COLUMN IF EXISTS snmp_community_string;
ALTER TABLE discovery_settings DROP COLUMN IF EXISTS snmp_community_strings;

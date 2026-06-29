-- Migration 004: Add encrypted SNMP fields to devices table

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS snmp_community_encrypted TEXT,
ADD COLUMN IF NOT EXISTS snmp_version VARCHAR(10) DEFAULT 'v2c';

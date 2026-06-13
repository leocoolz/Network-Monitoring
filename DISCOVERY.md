# 🔍 Device Auto-Discovery

## Overview

**Device Auto-Discovery** enables automatic scanning and discovery of devices on your network without manual configuration. The system can probe networks using multiple methods (ICMP, ARP, SNMP, TCP), identify devices, and allow administrators to approve and import discovered devices into the inventory.

---

## Features

### 1. **Network Scanning Methods**

- 🔵 **ICMP** - Fast ping-based discovery
- 🔵 **ARP** - Layer 2 address resolution
- 🔵 **SNMP** - SNMP probing for detailed device info
- 🔵 **TCP** - Port-based service detection (SSH, HTTP, HTTPS, SNMP)

### 2. **Discovery Sessions**

- Track active and completed discovery scans
- Monitor scan progress and results
- Cancel running scans
- View discovery statistics

### 3. **Discovered Device Management**

- Review discovered devices with metadata
- Approve/reject individual devices
- Batch import into main inventory
- Store discovery history

### 4. **Discovery Settings**

- Save and reuse discovery configurations
- Pre-configured subnets and scanning methods
- Custom SNMP community strings
- Custom TCP port scanning

### 5. **Automatic Integration**

- Import discovered devices with smart defaults
- Optional auto-import based on rules
- Full audit trail for imports
- Link back to discovery source

---

## Database Schema

### discovery_sessions

Tracks individual discovery scan sessions

```sql
CREATE TABLE discovery_sessions (
  id UUID PRIMARY KEY,
  user_id UUID,                    -- Who started the scan
  status VARCHAR(20),              -- running|completed|failed|cancelled
  target_subnet CIDR,              -- Network to scan
  scanning_method VARCHAR(20),     -- icmp|arp|snmp|tcp
  total_hosts_scanned INTEGER,     -- Total IPs probed
  devices_discovered INTEGER,      -- Devices found
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  error_message TEXT               -- If failed
);
```

### discovered_devices

Individual devices found during a scan

```sql
CREATE TABLE discovered_devices (
  id UUID PRIMARY KEY,
  discovery_session_id UUID,       -- Parent scan session
  ip_address INET,                 -- Device IP
  mac_address VARCHAR(17),         -- Device MAC address
  hostname VARCHAR(255),           -- Reverse DNS or SNMP name
  device_type VARCHAR(100),        -- Device classification
  manufacturer VARCHAR(255),       -- Vendor/manufacturer
  port_open INTEGER,               -- Open port if TCP scan
  service_detected VARCHAR(100),   -- Service running
  snmp_sys_name VARCHAR(255),      -- From SNMP sysName
  response_time_ms NUMERIC,        -- Probe response time
  is_approved BOOLEAN,             -- Admin approval status
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  imported_as_device_id UUID,      -- Link to imported device
  imported_at TIMESTAMPTZ,
  notes TEXT                        -- Admin notes
);
```

### discovery_settings

Saved discovery configurations

```sql
CREATE TABLE discovery_settings (
  id UUID PRIMARY KEY,
  user_id UUID,                    -- Owner
  name VARCHAR(100),               -- Config name
  target_subnets TEXT[],           -- Subnets to scan
  scanning_methods VARCHAR(20)[],  -- Methods to use
  snmp_community_strings TEXT[],   -- SNMP credentials
  tcp_ports INTEGER[],             -- Ports to check
  auto_import_matching BOOLEAN,    -- Auto-import rules
  is_active BOOLEAN                -- Enabled/disabled
);
```

---

## API Endpoints

### Discovery Sessions

#### Start Discovery Scan

```http
POST /api/discovery/sessions
Content-Type: application/json
Authorization: Session-Cookie
X-CSRF-Token: token

{
  "targetSubnet": "192.168.1.0/24",
  "scanningMethod": "icmp"
}
```

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user-uuid",
  "status": "running",
  "target_subnet": "192.168.1.0/24",
  "scanning_method": "icmp",
  "total_hosts_scanned": 0,
  "devices_discovered": 0,
  "start_time": "2026-06-13T15:30:00Z",
  "created_at": "2026-06-13T15:30:00Z"
}
```

#### List Discovery Sessions

```http
GET /api/discovery/sessions?page=1&limit=20&status=completed
```

#### Get Discovery Session

```http
GET /api/discovery/sessions/{sessionId}
```

#### Cancel Discovery Scan

```http
POST /api/discovery/sessions/{sessionId}/cancel
```

---

### Discovered Devices

#### List Discovered Devices

```http
GET /api/discovery/sessions/{sessionId}/devices?page=1&limit=50&approved=false
```

**Parameters:**

- `page` - Page number (default: 1)
- `limit` - Results per page (default: 50, max: 100)
- `approved` - Filter by approval status (true/false)

**Response:**

```json
{
  "rows": [
    {
      "id": "device-uuid",
      "ip_address": "192.168.1.10",
      "mac_address": "00:11:22:33:44:55",
      "hostname": "router-01",
      "device_type": "router",
      "manufacturer": "Mikrotik",
      "service_detected": "SSH",
      "response_time_ms": 2.5,
      "is_approved": false,
      "notes": null
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 50,
  "pages": 1
}
```

#### Get Discovered Device Details

```http
GET /api/discovery/devices/{deviceId}
```

#### Approve Discovered Device

```http
POST /api/discovery/devices/{deviceId}/approve
Content-Type: application/json
X-CSRF-Token: token

{
  "notes": "Optional admin notes"
}
```

#### Reject Discovered Device

```http
POST /api/discovery/devices/{deviceId}/reject
```

#### Import Discovered Device

```http
POST /api/discovery/devices/{deviceId}/import
Content-Type: application/json
X-CSRF-Token: token

{
  "name": "Router-01",
  "model": "RouterOS 7.x",
  "type": "router",
  "code": "ROS1",
  "location": "Data Center"
}
```

---

### Discovery Settings

#### List Discovery Settings

```http
GET /api/discovery/settings?page=1&limit=20
```

#### Create Discovery Setting

```http
POST /api/discovery/settings
Content-Type: application/json
X-CSRF-Token: token

{
  "name": "Office Network Scan",
  "targetSubnets": ["192.168.1.0/24", "192.168.2.0/24"],
  "scanningMethods": ["icmp", "tcp"],
  "snmpCommunityStrings": ["public", "internal"],
  "tcpPorts": [22, 23, 80, 443, 161]
}
```

#### Update Discovery Setting

```http
PATCH /api/discovery/settings/{settingId}
Content-Type: application/json
X-CSRF-Token: token

{
  "name": "Updated Name",
  "targetSubnets": ["10.0.0.0/16"]
}
```

#### Delete Discovery Setting

```http
DELETE /api/discovery/settings/{settingId}
```

---

## Usage Workflow

### Step 1: Start a Discovery Scan

```bash
curl -X POST http://localhost:3000/api/discovery/sessions \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: sessionId=$SESSION_ID" \
  -d '{
    "targetSubnet": "192.168.1.0/24",
    "scanningMethod": "icmp"
  }'
```

**Response includes:** Session ID, status "running", timestamps

### Step 2: Monitor Scan Progress

```bash
# Check status
curl http://localhost:3000/api/discovery/sessions/$SESSION_ID
```

The system will scan the subnet in the background and populate `discovered_devices` table as devices are found.

### Step 3: Review Discovered Devices

```bash
curl "http://localhost:3000/api/discovery/sessions/$SESSION_ID/devices?approved=false"
```

Shows all newly discovered devices pending approval.

### Step 4: Approve Devices

```bash
curl -X POST http://localhost:3000/api/discovery/devices/$DEVICE_ID/approve \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: sessionId=$SESSION_ID" \
  -d '{
    "notes": "Approved for production monitoring"
  }'
```

### Step 5: Import into Inventory

```bash
curl -X POST http://localhost:3000/api/discovery/devices/$DEVICE_ID/import \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: sessionId=$SESSION_ID" \
  -d '{
    "name": "Router-Office",
    "model": "TP-Link TL-WR1043N",
    "type": "router",
    "code": "TPL1",
    "location": "Office"
  }'
```

**Response:** New device created in `devices` table with link back to discovered source

---

## Scanning Methods

### ICMP Ping

- **Speed:** Fast ✅
- **Details:** Minimal (IP, response time only)
- **Requirements:** ICMP allowed
- **Best for:** Quick network scan

```bash
ping -c 1 -W 1 192.168.1.10
```

### ARP Discovery

- **Speed:** Very Fast ✅✅
- **Details:** MAC address, local network only
- **Requirements:** Layer 2 access
- **Best for:** Subnet enumeration

```bash
# Uses arp-scan or similar tools
arp-scan 192.168.1.0/24
```

### SNMP Probing

- **Speed:** Medium ⏱️
- **Details:** Hostname, system description, contact, location
- **Requirements:** SNMP enabled, community string known
- **Best for:** Detailed device classification

```bash
snmpget -v 2c -c public 192.168.1.10 sysName.0
```

### TCP Port Scan

- **Speed:** Slow ⏰
- **Details:** Open ports, service identification
- **Requirements:** TCP connectivity
- **Best for:** Service discovery

```bash
# Scans common ports: SSH(22), Telnet(23), HTTP(80), HTTPS(443), SNMP(161)
nc -zv -w1 192.168.1.10 22
```

---

## Security Considerations

### Authentication & Authorization

- ✅ Admin & operator roles only
- ✅ User ID tracked on all scans
- ✅ CSRF protection on all operations
- ✅ Audit trail maintained

### Network Impact

- ⚠️ Large /16 subnets may generate significant traffic
- ⚠️ Some devices may rate-limit or block probes
- ⚠️ SNMP credentials stored in database (consider encryption)

### Data Sensitivity

- 📋 Discovered device data includes MAC addresses, hostnames, service info
- 📋 Consider access controls and audit log reviews
- 📋 Only import devices that were explicitly approved

---

## Best Practices

### 1. **Start with ICMP**

Best for initial quick scan, then follow up with SNMP for detail.

```bash
# Quick scan first
POST /api/discovery/sessions
{
  "targetSubnet": "192.168.1.0/24",
  "scanningMethod": "icmp"
}
```

### 2. **Scan During Off-Hours**

Large scans generate network traffic. Schedule for maintenance windows.

### 3. **Save Reusable Configurations**

Create discovery settings for recurring scans:

```bash
POST /api/discovery/settings
{
  "name": "Weekly Office Scan",
  "targetSubnets": ["192.168.1.0/24", "192.168.2.0/24"],
  "scanningMethods": ["icmp"]
}
```

### 4. **Review Before Importing**

Always approve devices individually before importing to avoid duplication.

### 5. **Use SNMP for Classification**

Combine ICMP scan with SNMP to automatically identify device types.

### 6. **Track Source**

Every imported device records its `discovery_session_id` for traceability.

---

## Examples

### Example 1: Quick Subnet Scan

```bash
#!/bin/bash

SESSION=$(curl -s -X POST http://localhost:3000/api/discovery/sessions \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: sessionId=$SESSION_ID" \
  -d '{"targetSubnet": "192.168.1.0/24", "scanningMethod": "icmp"}' | jq -r '.id')

echo "Scanning session: $SESSION"

# Wait for scan to complete
sleep 10

# Get discovered devices
curl "http://localhost:3000/api/discovery/sessions/$SESSION/devices?approved=false" \
  -H "Cookie: sessionId=$SESSION_ID" | jq '.rows[] | {ip: .ip_address, hostname: .hostname, type: .device_type}'
```

### Example 2: Batch Import Approved Devices

```bash
#!/bin/bash

SESSION_ID=$1

# Get all approved devices
DEVICES=$(curl -s "http://localhost:3000/api/discovery/sessions/$SESSION_ID/devices?approved=true" \
  -H "Cookie: sessionId=$SESSION_ID" | jq -r '.rows[] | .id')

for DEVICE_ID in $DEVICES; do
  # Import each device
  curl -X POST "http://localhost:3000/api/discovery/devices/$DEVICE_ID/import" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -H "Cookie: sessionId=$SESSION_ID" \
    -d '{
      "name": "Auto-imported-'$(date +%s)'",
      "model": "Discovered",
      "type": "router",
      "code": "AUTO",
      "location": "Auto"
    }'
done

echo "Batch import complete"
```

### Example 3: Automated Nightly Scan

```bash
#!/bin/bash
# Run via cron: 0 2 * * * /scripts/nightly-discovery.sh

curl -X POST http://localhost:3000/api/discovery/sessions \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: sessionId=$SESSION_ID" \
  -d '{
    "targetSubnet": "192.168.0.0/16",
    "scanningMethod": "icmp"
  }' | jq '.'
```

---

## Troubleshooting

### Scan Hangs

- Check network connectivity to target subnet
- Verify firewall allows ICMP/SNMP/TCP traffic
- Check server resources (CPU, memory)

### No Devices Discovered

- Verify subnet is correct
- Check if SNMP/SSH services are running on devices
- Ensure scanning method matches network environment
- Try ICMP first (most compatible)

### SNMP Fails

- Verify community string is correct
- Check SNMP service is running on target device
- Ensure UDP port 161 is accessible
- Try `snmpget` command manually to test

### Import Fails

- Check device name is unique (required constraint)
- Verify IP address not already in system
- Ensure location and model fields are valid
- Check admin privileges on user account

---

## Audit & Compliance

All discovery operations are logged in `audit_logs`:

- ✅ Discovery session started
- ✅ Discovery session cancelled
- ✅ Device approved
- ✅ Device rejected
- ✅ Device imported

```sql
SELECT * FROM audit_logs
WHERE action LIKE 'discovery%'
ORDER BY created_at DESC;
```

---

## Summary

| Feature           | Details                                     |
| ----------------- | ------------------------------------------- |
| **Methods**       | ICMP, ARP, SNMP, TCP                        |
| **Max Scan Size** | Limited by timeout (recommend /24 for ICMP) |
| **Approval**      | Required before import                      |
| **Audit**         | Full trail maintained                       |
| **Security**      | RBAC, CSRF, user tracking                   |
| **Performance**   | Async background scanning                   |

---

## API Status Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 201  | Created (new session/device imported)         |
| 200  | Success                                       |
| 400  | Invalid subnet format or parameters           |
| 401  | Not authenticated                             |
| 403  | Insufficient permissions (not admin/operator) |
| 404  | Resource not found                            |
| 409  | Conflict (device name duplicate)              |
| 500  | Server error                                  |

---

**Device Auto-Discovery is now ready for production use!** 🚀

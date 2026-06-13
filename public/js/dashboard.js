import { drawTrafficChart, setTrafficData } from "./chart.js";
import { escapeHtml, formatLatency, formatTraffic, formatUptime, timeAgo } from "./format.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const colors = ["#756cf7", "#25d9f8", "#24d99b", "#f6b94b", "#f07ec6", "#58a5f7", "#ff7d6e", "#94a3b8"];
const state = { devices: [], alerts: [], distribution: [], summary: null };

function normalizeDevice(device) {
  return {
    id: device.id,
    name: device.name,
    model: device.model,
    type: device.type,
    code: device.code,
    ip: device.ip_address,
    location: device.location,
    status: device.status,
    method: device.monitoring_method,
    tcpPort: device.tcp_port,
    cpu: Number(device.cpu_percent || 0),
    memory: Number(device.memory_percent || 0),
    trafficMbps: Number(device.traffic_mbps || 0),
    latencyMs: device.latency_ms == null ? null : Number(device.latency_ms),
    uptimeSeconds: Number(device.uptime_seconds || 0),
    lastSeenAt: device.last_seen_at
  };
}

export function renderOverview(overview) {
  state.devices = overview.devices.map(normalizeDevice);
  state.alerts = overview.alerts;
  state.distribution = overview.distribution;
  state.summary = overview.summary;
  renderSummary();
  renderInfrastructure();
  renderLegend();
  renderAlerts();
  renderNotifications();
  renderDevices();
  setTrafficData(overview.traffic);
}

function renderSummary() {
  const summary = state.summary;
  $("#healthValue").textContent = Number(summary.health).toFixed(1);
  $(".health-bar span").style.width = `${Math.min(100, summary.health)}%`;
  $("#activeDeviceValue").textContent = summary.active;
  $("#totalDeviceValue").textContent = `/ ${summary.total}`;
  $("#criticalAlertValue").textContent = summary.criticalAlerts;
  $("#offlineDeviceValue").textContent = `${summary.offline} offline`;
  $("#warningAlertValue").textContent = summary.activeAlerts;
  const acknowledged = state.alerts.filter((alert) => alert.status === "acknowledged").length;
  const fresh = state.alerts.filter((alert) => alert.status === "new").length;
  $("#acknowledgedAlertValue").textContent = `${acknowledged} acknowledged`;
  $("#newAlertValue").textContent = `${fresh} new`;
  $("#navDeviceCount").textContent = summary.total;
  $("#navAlertCount").textContent = summary.activeAlerts;
  $("#notificationCount").textContent = summary.activeAlerts;
  $("#notificationCount").style.display = summary.activeAlerts ? "grid" : "none";
  $("#distributionTotal").textContent = summary.total;
  $("#distributionSubtitle").textContent = `${summary.total} total managed devices`;
  const healthLabel = summary.health >= 95 ? "Excellent" : summary.health >= 80 ? "Good" : summary.health >= 60 ? "Degraded" : "Critical";
  $("#healthLabel").textContent = healthLabel;
  $("#healthDetail").textContent = summary.offline
    ? `${summary.offline} device offline`
    : summary.warning
      ? `${summary.warning} device warning`
      : "All systems stable";
  $("#availabilityGauge").style.setProperty("--value", summary.availability);
  $("#availabilityGaugeValue").textContent = `${Number(summary.availability).toFixed(2)}%`;
  $("#availabilityIssueValue").textContent = summary.warning + summary.offline;
  const availability = $(".kpi-card:nth-child(2) > small b");
  if (availability) availability.textContent = `${Number(summary.availability).toFixed(1)}%`;
}

function renderInfrastructure() {
  const preferredTypes = new Set(["Router", "Firewall", "Switch", "Radio WiFi", "WAN Link"]);
  const devices = state.devices.filter((device) => preferredTypes.has(device.type)).slice(0, 3);
  $("#infrastructureLinks").innerHTML =
    devices
      .map(
        (device, index) => `
    <button type="button" data-device-id="${escapeHtml(device.id)}"><span class="link-icon ${index === 1 ? "alt" : index === 2 ? "vpn" : "isp"}">${escapeHtml(device.code)}</span><div><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.model)}</small></div><em class="${escapeHtml(device.status)}"><i class="${device.status === "warning" ? "warning" : ""}"></i>${escapeHtml(device.status.toUpperCase())}</em></button>
  `
      )
      .join("") || '<div class="empty-state" style="display:block;padding:24px">No infrastructure device registered.</div>';
  $$("#infrastructureLinks [data-device-id]").forEach((button) => button.addEventListener("click", () => openDevice(button.dataset.deviceId)));

  const topologyTypes = [null, "Firewall", "Router", "Switch", "Access Point"];
  $$("#topologyCanvas .topology-node").forEach((node, index) => {
    if (index === 0) return;
    const match = state.devices.find((device) => device.type === topologyTypes[index]);
    if (!match) return;
    node.dataset.device = match.id;
    node.querySelector("strong").textContent = match.name;
    node.querySelector("small").textContent = `${match.status.toUpperCase()} / ${formatTraffic(match.trafficMbps)}`;
  });
}

function renderLegend() {
  $("#deviceLegend").innerHTML = state.distribution
    .map(
      (item, index) => `
    <div class="legend-row"><i style="background:${colors[index % colors.length]}"></i><span>${escapeHtml(item.type)}</span><strong>${item.count}</strong></div>
  `
    )
    .join("");
  const total = Math.max(1, state.summary.total);
  let cursor = 0;
  const segments = state.distribution.map((item, index) => {
    const start = cursor;
    cursor += (item.count / total) * 100;
    return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  $(".donut-chart").style.background = `conic-gradient(${segments.join(",")})`;
}

export function renderMiniBars() {
  $("#deviceMiniBars").innerHTML = Array.from(
    { length: 34 },
    (_, index) => `<i style="height:${5 + ((index * 7) % 12)}px;opacity:${0.35 + index / 55}"></i>`
  ).join("");
}

function renderAlerts() {
  $("#alertList").innerHTML = state.alerts
    .map(
      (alert) => `
    <div class="alert-row">
      <span class="severity-icon ${escapeHtml(alert.severity)}">${alert.severity === "info" ? "i" : "!"}</span>
      <div class="alert-message"><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></div>
      <div class="alert-source"><strong>${escapeHtml(alert.device_name || "System")}</strong><small>${escapeHtml(alert.location || "-")}</small></div>
      <span class="alert-time">${timeAgo(alert.created_at)}</span>
      <span class="alert-status ${escapeHtml(alert.status)}">${escapeHtml(alert.status)}</span>
      <button class="alert-menu" type="button" aria-label="Alert options">...</button>
    </div>
  `
    )
    .join("");
}

function renderNotifications() {
  const list = $("#notificationPopover ul");
  list.innerHTML =
    state.alerts
      .slice(0, 4)
      .map(
        (alert) => `
    <li><i class="${escapeHtml(alert.severity)}"></i><span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.device_name || "System")} - ${timeAgo(alert.created_at)}</small></span></li>
  `
      )
      .join("") || "<li><span><strong>No active notifications</strong></span></li>";
}

export function getFilteredDevices() {
  const query = $("#deviceSearch").value.trim().toLowerCase();
  const type = $("#typeFilter").value;
  const status = $("#statusFilter").value;
  return state.devices.filter((device) => {
    const haystack = [device.name, device.model, device.ip, device.location, device.type].join(" ").toLowerCase();
    return haystack.includes(query) && (type === "all" || device.type === type) && (status === "all" || device.status === status);
  });
}

export function populateFilters() {
  const selected = $("#typeFilter").value;
  const types = [...new Set(state.devices.map((device) => device.type))].sort();
  $("#typeFilter").innerHTML =
    '<option value="all">Semua tipe</option>' + types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  if (types.includes(selected)) $("#typeFilter").value = selected;
}

export function renderDevices() {
  populateFilters();
  const filtered = getFilteredDevices();
  $("#deviceTableBody").innerHTML = filtered
    .slice(0, 25)
    .map(
      (device) => `
    <tr data-device-id="${escapeHtml(device.id)}">
      <td><div class="device-cell"><span class="device-type-icon">${escapeHtml(device.code)}</span><div><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.model)}</small></div></div></td>
      <td>${escapeHtml(device.type)}</td><td>${escapeHtml(device.ip)}</td><td>${escapeHtml(device.location)}</td><td>${formatUptime(device.uptimeSeconds)}</td><td>${formatLatency(device.latencyMs)}</td>
      <td><span class="status-pill ${escapeHtml(device.status)}">${escapeHtml(device.status)}</span></td><td><button class="row-action" type="button" aria-label="Open device">...</button></td>
    </tr>
  `
    )
    .join("");
  $("#emptyState").style.display = filtered.length ? "none" : "block";
  $("#tableCount").textContent = `Menampilkan ${Math.min(filtered.length, 25)} dari ${filtered.length} perangkat`;
  $$("#deviceTableBody [data-device-id]").forEach((row) => row.addEventListener("click", () => openDevice(row.dataset.deviceId)));
}

function fallbackDevice(name) {
  const wan = name.includes("Internet");
  return {
    id: null,
    name,
    model: wan ? "Managed WAN Link" : "Managed network group",
    type: wan ? "WAN Link" : "Network Group",
    code: wan ? "IN" : "NW",
    ip: "Multiple",
    location: "Jakarta HQ",
    status: name.includes("VPN") ? "warning" : "online",
    method: "api",
    cpu: 0,
    memory: 0,
    trafficMbps: wan ? 866 : 1200,
    latencyMs: wan ? 7.4 : 2.1,
    uptimeSeconds: 0
  };
}

export function openDevice(identifier) {
  const device = state.devices.find((item) => item.id === identifier || item.name === identifier) || fallbackDevice(identifier);
  $("#drawerName").textContent = device.name;
  $("#drawerIcon").textContent = device.code;
  $("#drawerBody").innerHTML = `
    <div class="drawer-status"><div><span>Current status</span><strong>${device.status === "online" ? "Operational" : device.status === "warning" ? "Needs attention" : "Unreachable"}</strong></div><span class="status-pill ${escapeHtml(device.status)}">${escapeHtml(device.status)}</span></div>
    <div class="detail-grid">
      <div class="detail-card"><span>IP ADDRESS</span><strong>${escapeHtml(device.ip)}</strong></div>
      <div class="detail-card"><span>DEVICE TYPE</span><strong>${escapeHtml(device.type)}</strong></div>
      <div class="detail-card"><span>LOCATION</span><strong>${escapeHtml(device.location)}</strong></div>
      <div class="detail-card"><span>UPTIME</span><strong>${formatUptime(device.uptimeSeconds)}</strong></div>
      <div class="detail-card"><span>LATENCY</span><strong>${formatLatency(device.latencyMs)}</strong></div>
      <div class="detail-card"><span>TRAFFIC</span><strong>${formatTraffic(device.trafficMbps)}</strong></div>
    </div>
    <div class="drawer-section"><h3>RESOURCE UTILIZATION</h3>
      <div class="metric-row"><div><span>CPU utilization</span><strong>${device.cpu.toFixed(0)}%</strong></div><div class="metric-bar"><span style="width:${Math.min(100, device.cpu)}%"></span></div></div>
      <div class="metric-row"><div><span>Memory utilization</span><strong>${device.memory.toFixed(0)}%</strong></div><div class="metric-bar"><span style="width:${Math.min(100, device.memory)}%"></span></div></div>
    </div>
    <div class="drawer-section"><h3>MONITORING SERVICE</h3><div class="detail-grid"><div class="detail-card"><span>METHOD</span><strong>${escapeHtml(device.method.toUpperCase())}</strong></div><div class="detail-card"><span>LAST SEEN</span><strong>${device.lastSeenAt ? timeAgo(device.lastSeenAt) : "No response"}</strong></div></div></div>
    <div class="drawer-actions"><button class="button secondary" id="closeDrawerAction" type="button">Close</button><button class="button primary" id="refreshDeviceAction" type="button">Refresh Dashboard</button></div>
  `;
  $("#deviceDrawer").classList.add("open");
  $("#drawerOverlay").classList.add("open");
  $("#deviceDrawer").setAttribute("aria-hidden", "false");
  $("#closeDrawerAction").addEventListener("click", closeDrawer);
  $("#refreshDeviceAction").addEventListener("click", () => window.dispatchEvent(new CustomEvent("netra:refresh")));
}

export function closeDrawer() {
  $("#deviceDrawer").classList.remove("open");
  $("#drawerOverlay").classList.remove("open");
  $("#deviceDrawer").setAttribute("aria-hidden", "true");
}

export function bindTopology() {
  $$("[data-device]", $("#topologyCanvas")).forEach((node) => node.addEventListener("click", () => openDevice(node.dataset.device)));
}

export function refreshChart() {
  requestAnimationFrame(drawTrafficChart);
}

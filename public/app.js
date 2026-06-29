import {
  acknowledgeAllAlerts,
  addDevice,
  ApiError,
  deleteDevice,
  downloadDeviceReport,
  getOverview,
  getSession,
  getSettings,
  login,
  logout,
  updateDevice,
  updateSettings
} from "./js/api.js";
import { drawTrafficChart, setTrafficRange, setTrafficScope, tooltipData } from "./js/chart.js";
import { bindTopology, closeDrawer, getDevice, refreshChart, renderDevices, renderMiniBars, renderOverview } from "./js/dashboard.js";
import { initials } from "./js/format.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
let currentUser = null;
let editingDeviceId = null;
let pendingDeleteId = null;
let applicationSettings = null;
let refreshTimer = null;

function setAuthState(loggedIn) {
  document.body.classList.remove("auth-pending", "logged-in", "logged-out");
  document.body.classList.add(loggedIn ? "logged-in" : "logged-out");
  if (!loggedIn) setTimeout(() => $("#loginUsername")?.focus(), 50);
}

function applyUser(user) {
  currentUser = user;
  document.body.dataset.role = user.role;
  const shortName = user.displayName.split(/\s+/)[0];
  const userInitials = initials(user.displayName);
  $("#profileName").textContent = shortName;
  $("#profileButton > span").textContent = userInitials;
  $("#profileInitials").textContent = userInitials;
  $("#profilePopoverName").textContent = user.displayName;
  $("#profileEmail").textContent = user.email;
  $("#profileRole").textContent = user.role.toUpperCase();
  $("#addDeviceButton").style.display = ["admin", "operator"].includes(user.role) ? "inline-flex" : "none";
  $("#ackAllButton").style.display = ["admin", "operator"].includes(user.role) ? "inline-flex" : "none";
  $("#navSettings").style.display = user.role === "admin" ? "flex" : "none";
}

function clearLoginValidation() {
  $$(".login-field").forEach((field) => field.classList.remove("invalid"));
  $$(".field-error").forEach((error) => {
    error.textContent = "";
  });
  $("#loginError").classList.remove("show");
}

function showLoginError(error) {
  const message = error.code === "ACCOUNT_LOCKED" ? error.message : "Username atau password tidak sesuai.";
  $("#loginError small").textContent = message;
  $("#loginError").classList.add("show");
}

export function showToast(title, message, tone = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<span class="toast-icon">${tone === "error" ? "!" : "OK"}</span><div><strong></strong><small></small></div>`;
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = message;
  $("#toastStack").appendChild(toast);
  setTimeout(() => toast.remove(), 3800);
}

async function loadDashboard() {
  const overview = await getOverview();
  renderOverview(overview);
  $("#lastSync").textContent = "just now";
}

function scheduleDashboardRefresh() {
  globalThis.clearInterval(refreshTimer);
  const seconds = Number(applicationSettings?.dashboardRefreshSeconds || 30);
  refreshTimer = globalThis.setInterval(() => loadDashboard().catch(() => {}), seconds * 1000);
}

function updateMonitoringFields() {
  const method = $("#monitoringMethod").value;
  const device = editingDeviceId ? getDevice(editingDeviceId) : null;
  $("#tcpPort").required = method === "tcp";
  $("#snmpConfigRow").style.display = method === "snmp" ? "flex" : "none";
  $("#snmpCommunity").required = method === "snmp" && !device?.hasSnmpCredentials;
  $("#snmpCommunity").placeholder = device?.hasSnmpCredentials ? "Kosongkan untuk mempertahankan credential" : "Masukkan community yang unik";
}

function openDeviceForm(device = null) {
  editingDeviceId = device?.id || null;
  const form = $("#addDeviceForm");
  form.reset();
  $("#editDeviceId").value = editingDeviceId || "";
  $("#deviceModalSubtitle").textContent = editingDeviceId ? "UPDATE MANAGED ASSET" : "NEW MANAGED ASSET";
  $("#deviceModalTitle").textContent = editingDeviceId ? "Edit Perangkat" : "Tambah Perangkat";
  $("#submitDeviceBtn").textContent = editingDeviceId ? "Update Perangkat" : "Simpan Perangkat";
  if (device) {
    $("#devName").value = device.name;
    $("#devModel").value = device.model;
    $("#devCode").value = device.code;
    $("#devType").value = device.type;
    $("#devIp").value = device.ip;
    $("#devLocation").value = device.location;
    $("#monitoringMethod").value = device.method;
    $("#tcpPort").value = device.tcpPort || "";
    $("#snmpVersion").value = device.snmpVersion || "v2c";
  } else if (applicationSettings?.defaultMonitoringMethod) {
    $("#monitoringMethod").value = applicationSettings.defaultMonitoringMethod;
  }
  updateMonitoringFields();
  $("#addDeviceModal").classList.add("open");
  $("#addDeviceModal").setAttribute("aria-hidden", "false");
}

async function openSettings() {
  try {
    applicationSettings = await getSettings();
    $("#settingOrganization").value = applicationSettings.organizationName || "Netra NOC";
    $("#settingTimezone").value = applicationSettings.timezone || "Asia/Jakarta";
    $("#settingRefresh").value = applicationSettings.dashboardRefreshSeconds || 30;
    $("#settingMethod").value = applicationSettings.defaultMonitoringMethod || "icmp";
    $("#settingsModal").classList.add("open");
    $("#settingsModal").setAttribute("aria-hidden", "false");
  } catch (error) {
    showToast("Settings gagal dimuat", error.message, "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearLoginValidation();
  const username = $("#loginUsername").value.trim();
  const password = $("#loginPassword").value;
  let valid = true;
  for (const [input, message] of [
    ["#loginUsername", "Username wajib diisi."],
    ["#loginPassword", "Password wajib diisi."]
  ]) {
    if (!$(input).value) {
      const field = $(input).closest(".login-field");
      field.classList.add("invalid");
      field.querySelector(".field-error").textContent = message;
      valid = false;
    }
  }
  if (!valid) return;

  const submit = $("#loginSubmit");
  submit.disabled = true;
  submit.querySelector("span").textContent = "Memverifikasi...";
  try {
    const session = await login({ username, password, remember: $("#rememberSession").checked });
    applyUser(session.user);
    setAuthState(true);
    applicationSettings = await getSettings();
    scheduleDashboardRefresh();
    await loadDashboard();
    refreshChart();
    $("#loginPassword").value = "";
    showToast("Login berhasil", "Selamat datang di Netra Network Operations Center");
  } catch (error) {
    showLoginError(error);
    $("#loginPassword").value = "";
    $("#loginPassword").focus();
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "Masuk ke Dashboard";
  }
}

async function handleLogout() {
  try {
    await logout();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) showToast("Logout warning", error.message, "error");
  }
  currentUser = null;
  globalThis.clearInterval(refreshTimer);
  $("#profilePopover").classList.remove("open");
  $("#loginForm").reset();
  $("#rememberSession").checked = true;
  clearLoginValidation();
  setAuthState(false);
}

function bindAuth() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#passwordToggle").addEventListener("click", () => {
    const password = $("#loginPassword");
    password.type = password.type === "password" ? "text" : "password";
    $("#passwordToggle").textContent = password.type === "password" ? "SHOW" : "HIDE";
  });
  $$("#loginForm input").forEach((input) =>
    input.addEventListener("input", () => {
      input.closest(".login-field")?.classList.remove("invalid");
      $("#loginError").classList.remove("show");
    })
  );
  $("#forgotButton").addEventListener("click", () => showToast("Reset password", "Hubungi Network Administrator untuk memulihkan akses"));
  $("#profileButton").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#notificationPopover").classList.remove("open");
    $("#profilePopover").classList.toggle("open");
  });
  $("#logoutButton").addEventListener("click", handleLogout);
}

function bindNavigation() {
  $("#menuButton").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebarOverlay").classList.add("open");
  });
  $("#sidebarOverlay").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebarOverlay").classList.remove("open");
  });
  $$(".nav-item[data-section]").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("#sidebar").classList.remove("open");
      $("#sidebarOverlay").classList.remove("open");
    })
  );
  $("#notificationButton").addEventListener("click", (event) => {
    event.stopPropagation();
    $("#profilePopover").classList.remove("open");
    $("#notificationPopover").classList.toggle("open");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#notificationPopover") && !event.target.closest("#notificationButton")) $("#notificationPopover").classList.remove("open");
    if (!event.target.closest("#profilePopover") && !event.target.closest("#profileButton")) $("#profilePopover").classList.remove("open");
  });
  $("#markRead").addEventListener("click", () => {
    $("#notificationPopover").classList.remove("open");
    showToast("Notifications reviewed", "Active alert status remains available in the alert panel");
  });
  $("#navReports")?.addEventListener("click", () => {
    showToast("Under Development", "Menu Reports Interface sedang dalam tahap pengembangan. Namun sistem backend laporan global (Export) sudah aktif.", "info");
  });
  $("#navSettings")?.addEventListener("click", () => {
    openSettings();
  });
}

function bindDashboardActions() {
  ["#deviceSearch", "#typeFilter", "#statusFilter"].forEach((selector) =>
    $(selector).addEventListener(selector === "#deviceSearch" ? "input" : "change", renderDevices)
  );
  $("#globalSearch").addEventListener("input", (event) => {
    $("#deviceSearch").value = event.target.value;
    renderDevices();
    if (event.target.value.length > 1) $("#devices").scrollIntoView({ behavior: "smooth" });
  });
  $$(".range-tabs button").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".range-tabs button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      setTrafficRange(button.dataset.range);
    })
  );
  $("#trafficScope").addEventListener("change", (event) => setTrafficScope(event.target.value));
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#drawerOverlay").addEventListener("click", closeDrawer);
  $("#exportButton").addEventListener("click", async () => {
    try {
      await downloadDeviceReport();
      showToast("Report exported", "Device inventory CSV berhasil dibuat");
    } catch (error) {
      showToast("Export gagal", error.message, "error");
    }
  });
  $("#addDeviceButton").addEventListener("click", () => {
    openDeviceForm();
  });
  $$("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", () => {
      $("#addDeviceModal").classList.remove("open");
      $("#addDeviceModal").setAttribute("aria-hidden", "true");
      editingDeviceId = null;
    })
  );
  $("#monitoringMethod").addEventListener("change", updateMonitoringFields);
  $("#addDeviceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    delete data.id;
    if (!data.tcpPort) delete data.tcpPort;
    if (!data.snmpCommunity) delete data.snmpCommunity;
    if (data.monitoringMethod !== "snmp") {
      delete data.snmpCommunity;
      delete data.snmpVersion;
    }
    try {
      if (editingDeviceId) await updateDevice(editingDeviceId, data);
      else await addDevice(data);
      form.reset();
      $("#addDeviceModal").classList.remove("open");
      $("#addDeviceModal").setAttribute("aria-hidden", "true");
      await loadDashboard();
      closeDrawer();
      showToast(
        editingDeviceId ? "Device updated" : "Device added",
        editingDeviceId ? "Perubahan perangkat berhasil disimpan" : "Perangkat siap menerima data dari poller"
      );
      editingDeviceId = null;
    } catch (error) {
      showToast(editingDeviceId ? "Gagal mengubah perangkat" : "Gagal menambah perangkat", error.message, "error");
    }
  });
  window.addEventListener("netra:edit-device", (event) => {
    const device = getDevice(event.detail.id);
    if (device) openDeviceForm(device);
  });
  window.addEventListener("netra:delete-device", (event) => {
    pendingDeleteId = event.detail.id;
    $("#deleteDeviceName").textContent = event.detail.name;
    $("#confirmDeleteModal").classList.add("open");
    $("#confirmDeleteModal").setAttribute("aria-hidden", "false");
  });
  $$("[data-cancel-delete]").forEach((button) =>
    button.addEventListener("click", () => {
      pendingDeleteId = null;
      $("#confirmDeleteModal").classList.remove("open");
      $("#confirmDeleteModal").setAttribute("aria-hidden", "true");
    })
  );
  $("#confirmDeleteButton").addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteDevice(pendingDeleteId);
      pendingDeleteId = null;
      $("#confirmDeleteModal").classList.remove("open");
      $("#confirmDeleteModal").setAttribute("aria-hidden", "true");
      closeDrawer();
      await loadDashboard();
      showToast("Device deleted", "Perangkat dinonaktifkan dan audit log tetap disimpan");
    } catch (error) {
      showToast("Gagal menghapus perangkat", error.message, "error");
    }
  });
  $$("[data-close-settings]").forEach((button) =>
    button.addEventListener("click", () => {
      $("#settingsModal").classList.remove("open");
      $("#settingsModal").setAttribute("aria-hidden", "true");
    })
  );
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = Object.fromEntries(new FormData(event.currentTarget));
    formData.dashboardRefreshSeconds = Number(formData.dashboardRefreshSeconds);
    try {
      applicationSettings = await updateSettings(formData);
      scheduleDashboardRefresh();
      $("#settingsModal").classList.remove("open");
      $("#settingsModal").setAttribute("aria-hidden", "true");
      showToast("Settings updated", "Konfigurasi aplikasi berhasil disimpan");
    } catch (error) {
      showToast("Settings gagal disimpan", error.message, "error");
    }
  });
  $("#ackAllButton").addEventListener("click", async () => {
    try {
      const result = await acknowledgeAllAlerts();
      await loadDashboard();
      showToast("Alerts acknowledged", `${result.acknowledged} alert diperbarui`);
    } catch (error) {
      showToast("Acknowledge gagal", error.message, "error");
    }
  });
  const canvas = $("#trafficChart");
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const data = tooltipData(event.clientX, rect);
    const tooltip = $("#chartTooltip");
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(rect.width - 118, Math.max(5, data.x + 8))}px`;
    tooltip.style.top = `${Math.max(5, event.clientY - rect.top - 45)}px`;
    tooltip.innerHTML = `<strong style="color:#25d9f8">${data.download.toFixed(1)} Mbps</strong><br><span style="color:#8279ff">${data.upload.toFixed(1)} Mbps upload</span>`;
  });
  canvas.addEventListener("mouseleave", () => {
    $("#chartTooltip").style.display = "none";
  });
  window.addEventListener("resize", drawTrafficChart);
  window.addEventListener("netra:refresh", async () => {
    await loadDashboard();
    showToast("Dashboard refreshed", "Latest collector data has been loaded");
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && currentUser) {
      event.preventDefault();
      $("#globalSearch").focus();
    }
    if (event.key === "Escape") {
      closeDrawer();
      $("#addDeviceModal").classList.remove("open");
      $("#settingsModal").classList.remove("open");
      $("#confirmDeleteModal").classList.remove("open");
      $("#notificationPopover").classList.remove("open");
      $("#profilePopover").classList.remove("open");
    }
  });
}

async function initialize() {
  renderMiniBars();
  bindAuth();
  bindNavigation();
  bindDashboardActions();
  bindTopology();
  try {
    const session = await getSession();
    applyUser(session.user);
    setAuthState(true);
    applicationSettings = await getSettings();
    scheduleDashboardRefresh();
    await loadDashboard();
    refreshChart();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) showToast("Service unavailable", error.message, "error");
    setAuthState(false);
  }
}

document.addEventListener("DOMContentLoaded", initialize);

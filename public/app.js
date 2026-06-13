import { acknowledgeAllAlerts, addDevice, ApiError, downloadDeviceReport, getOverview, getSession, login, logout } from "./js/api.js";
import { drawTrafficChart, setTrafficRange, setTrafficScope, tooltipData } from "./js/chart.js";
import { bindTopology, closeDrawer, refreshChart, renderDevices, renderMiniBars, renderOverview } from "./js/dashboard.js";
import { initials } from "./js/format.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
let currentUser = null;

function setAuthState(loggedIn) {
  document.body.classList.remove("auth-pending", "logged-in", "logged-out");
  document.body.classList.add(loggedIn ? "logged-in" : "logged-out");
  if (!loggedIn) setTimeout(() => $("#loginUsername")?.focus(), 50);
}

function applyUser(user) {
  currentUser = user;
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
    $("#addDeviceModal").classList.add("open");
    $("#addDeviceModal").setAttribute("aria-hidden", "false");
  });
  $$("[data-close-modal]").forEach((button) =>
    button.addEventListener("click", () => {
      $("#addDeviceModal").classList.remove("open");
      $("#addDeviceModal").setAttribute("aria-hidden", "true");
    })
  );
  $("#monitoringMethod").addEventListener("change", (event) => {
    $("#tcpPort").required = event.target.value === "tcp";
  });
  $("#addDeviceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!data.tcpPort) delete data.tcpPort;
    try {
      await addDevice(data);
      form.reset();
      $("#addDeviceModal").classList.remove("open");
      await loadDashboard();
      showToast("Device added", "Perangkat siap menerima data dari collector");
    } catch (error) {
      showToast("Gagal menambah perangkat", error.message, "error");
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
    await loadDashboard();
    refreshChart();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) showToast("Service unavailable", error.message, "error");
    setAuthState(false);
  }
}

document.addEventListener("DOMContentLoaded", initialize);

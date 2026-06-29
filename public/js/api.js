let csrfToken = null;

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || `Request failed with status ${status}`);
    this.status = status;
    this.code = payload?.error?.code || "REQUEST_FAILED";
    this.details = payload?.error?.details;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) headers.set("X-CSRF-Token", csrfToken);

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function getSession() {
  const response = await request("/api/auth/session");
  csrfToken = response.data.csrfToken;
  return response.data;
}

export async function login(credentials) {
  const response = await request("/api/auth/login", { method: "POST", body: credentials });
  csrfToken = response.data.csrfToken;
  return response.data;
}

export async function logout() {
  await request("/api/auth/logout", { method: "POST" });
  csrfToken = null;
}

export async function getOverview() {
  return (await request("/api/dashboard/overview")).data;
}

export async function addDevice(device) {
  return (await request("/api/devices", { method: "POST", body: device })).data;
}

export async function updateDevice(id, data) {
  return (await request(`/api/devices/${id}`, { method: "PATCH", body: data })).data;
}

export async function deleteDevice(id) {
  return request(`/api/devices/${id}`, { method: "DELETE" });
}

export async function getSettings() {
  return (await request("/api/settings")).data;
}

export async function updateSettings(settings) {
  return (await request("/api/settings", { method: "PATCH", body: settings })).data;
}

export async function acknowledgeAllAlerts() {
  return (await request("/api/alerts/acknowledge", { method: "POST", body: {} })).data;
}

export async function downloadDeviceReport() {
  const response = await fetch("/api/export/devices.csv", { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => null));
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "netra-devices.csv";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

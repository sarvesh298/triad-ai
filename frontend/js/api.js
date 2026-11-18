/**
 * REST client for the TRIAD DMS backend.
 * Every function maps to one backend endpoint; errors are thrown as ApiError with the server's message.
 */
// Served by the Flask app itself (e.g. on Render): same origin. Served by a separate static server
// (Live Server / http.server on 5500, nginx on 8080): the API runs on port 5000 of the same host.
const STATIC_DEV_PORTS = ["5500", "8080"];
const DEFAULT_API = location.protocol === "file:" ? "http://127.0.0.1:5000/api"
  : STATIC_DEV_PORTS.includes(location.port) ? `${location.protocol}//${location.hostname}:5000/api`
    : `${location.origin}/api`;
export const API_BASE = (localStorage.getItem("dms_api") || DEFAULT_API).replace(/\/+$/, "");

const TOKEN_KEY = "dms_token";
let token = localStorage.getItem(TOKEN_KEY) || "";
const unauthorizedHandlers = new Set();

export class ApiError extends Error {
  constructor(message, status = 0, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const session = {
  get token() { return token; },
  set(newToken) { token = newToken; localStorage.setItem(TOKEN_KEY, newToken); },
  clear() { token = ""; localStorage.removeItem(TOKEN_KEY); },
  /** Called when an authenticated request comes back 401 (expired, invalid or deactivated). */
  onUnauthorized(fn) { unauthorizedHandlers.add(fn); return () => unauthorizedHandlers.delete(fn); },
};

function notifyUnauthorized(path, status) {
  if (status === 401 && token && !path.startsWith("/auth/login")) {
    unauthorizedHandlers.forEach((fn) => fn());
  }
}

function buildUrl(path, query) {
  const url = new URL(API_BASE + path);
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

async function request(path, { method = "GET", body, query } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_BASE}. Check that the backend is running.`, 0);
  }
  const data = await res.json().catch(() => ({}));
  notifyUnauthorized(path, res.status);
  if (!res.ok) throw new ApiError(data.error || data.msg || `Request failed (${res.status})`, res.status, data);
  return data;
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim()); } catch { /* use plain filename */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Fetch a document's file as a Blob (used for both preview and download). */
async function fetchFile(id) {
  let res;
  try {
    res = await fetch(buildUrl(`/documents/${encodeURIComponent(id)}/download`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_BASE}.`, 0);
  }
  notifyUnauthorized("/documents", res.status);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Download failed (${res.status})`, res.status, data);
  }
  return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get("Content-Disposition")) };
}

/**
 * Upload one file with progress reporting (fetch has no upload progress, so this uses XHR).
 * Returns { promise, abort }.
 */
function uploadFile(file, { title = "", metadata = {} } = {}, onProgress = () => {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("metadata", JSON.stringify(metadata));
    xhr.open("POST", buildUrl("/documents/upload"));
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onProgress(1, "processing");
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON error page */ }
      notifyUnauthorized("/documents/upload", xhr.status);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(`Can't reach the server at ${API_BASE}.`, 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", -1));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export const api = {
  // Auth
  health: () => request("/health"),
  divisions: () => request("/auth/divisions"),
  register: (body) => request("/auth/register", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),
  me: () => request("/auth/me"),

  // Documents
  listDocuments: (query) => request("/documents", { query }),
  documentStats: () => request("/documents/stats"),
  getDocument: (id) => request(`/documents/${encodeURIComponent(id)}`),
  fetchFile,
  uploadFile,

  // Search
  search: (q) => request("/search", { query: { q } }),

  // Access requests
  requestAccess: (docId) => request("/access/request", { method: "POST", body: { doc_id: docId } }),
  inbox: () => request("/access/inbox"),
  myRequests: () => request("/access/my-requests"),
  approveRequest: (id) => request("/access/approve", { method: "POST", body: { request_id: id } }),
  rejectRequest: (id) => request("/access/reject", { method: "POST", body: { request_id: id } }),

  // Metadata fields
  fields: (includeInactive = false) =>
    request("/metadata/fields", { query: includeInactive ? { include_inactive: "true" } : {} }),
  createField: (body) => request("/metadata/fields", { method: "POST", body }),
  updateField: (key, body) => request(`/metadata/fields/${encodeURIComponent(key)}`, { method: "PATCH", body }),

  // Admin
  users: (status) => request("/admin/users", { query: { status } }),
  userAction: (id, action, body = {}) =>
    request(`/admin/users/${encodeURIComponent(id)}/${action}`, { method: "POST", body }),
};

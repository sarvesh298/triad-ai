/** Small shared helpers: escaping, formatting, status text, dialogs, toasts, theme. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Escape text and wrap case-insensitive matches of `term` in <mark> (never splits an HTML entity). */
export function highlight(text, term) {
  const source = String(text ?? "");
  const t = String(term || "").trim();
  if (!t) return esc(source);
  const lower = source.toLowerCase();
  const needle = t.toLowerCase();
  let out = "";
  let from = 0;
  let idx;
  while ((idx = lower.indexOf(needle, from)) !== -1) {
    out += `${esc(source.slice(from, idx))}<mark>${esc(source.slice(idx, idx + t.length))}</mark>`;
    from = idx + t.length;
  }
  return out + esc(source.slice(from));
}

/* ---------- Formatting ---------- */

export function formatDate(iso) {
  return iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso)) : "—";
}
export function formatDateTime(iso) {
  return iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
}
export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(s) >= size) return rtf.format(-Math.round(s / size), unit);
  }
  return "just now";
}
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fileKind(doc) {
  const name = (doc.filename || "").toLowerCase();
  if (name.endsWith(".pdf") || doc.content_type === "application/pdf") return "pdf";
  if (/\.(png|jpe?g|tiff?)$/.test(name) || (doc.content_type || "").startsWith("image/")) return "image";
  return "other";
}
export const fileExt = (doc) => (doc.filename || "").split(".").pop().slice(0, 4).toUpperCase() || "FILE";

/* ---------- Status text ---------- */

const OCR = { completed: ["ok", "Indexed"], no_text: ["", "No text found"], failed: ["bad", "OCR failed"], unknown: ["", "Not processed"] };
export function ocrStatus(status) {
  const [cls, label] = OCR[status] || OCR.unknown;
  return `<span class="status ${cls}">${label}</span>`;
}

const REQ = { pending: ["warn", "Pending"], approved: ["ok", "Approved"], rejected: ["bad", "Rejected"] };
export function requestStatus(status) {
  const [cls, label] = REQ[status] || ["", status];
  return `<span class="status ${cls}">${esc(label)}</span>`;
}

export function userStatus(status) {
  const cls = { active: "ok", pending: "warn", rejected: "bad", deactivated: "" }[status] ?? "";
  return `<span class="status ${cls}">${esc(status[0].toUpperCase() + status.slice(1))}</span>`;
}

/** "Report Type: Financial, Year: 2026" */
export function metadataText(metadata, labels = {}) {
  const entries = Object.entries(metadata || {});
  if (!entries.length) return `<span class="muted">—</span>`;
  return `<span class="badges-row">${entries.map(([k, v]) => `<span class="badge"><b>${esc(labels[k] || k)}:</b> ${esc(v)}</span>`).join("")}</span>`;
}

export const emptyRow = (text, action = "") => `<div class="empty">${esc(text)}${action ? `<div>${action}</div>` : ""}</div>`;
export const loadingRow = (text = "Loading…") => `<div class="loading-row"><span class="spinner"></span>${esc(text)}</div>`;
export const errorRow = (message, retryId = "") =>
  `<div class="empty" style="color:var(--danger)">${esc(message)}${retryId ? ` <button class="btn btn-sm" id="${retryId}" style="margin-left:6px">Retry</button>` : ""}</div>`;

/* ---------- Toasts ---------- */

export function toast(type, title, message = "", timeout = 4000) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<div class="msg"><strong>${esc(title)}</strong>${message ? `<p>${esc(message)}</p>` : ""}</div><button class="close" aria-label="Dismiss">×</button>`;
  const remove = () => el.remove();
  el.querySelector("button").onclick = remove;
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  if (timeout) setTimeout(remove, timeout);
}

export const notify = {
  success: (t, m) => toast("success", t, m),
  error: (t, m) => toast("error", t, m, 6000),
  info: (t, m) => toast("info", t, m),
  warning: (t, m) => toast("warning", t, m, 6000),
};

/* ---------- Dialogs ---------- */

let openCount = 0;
export const modalIsOpen = () => openCount > 0;

/** Open a dialog. Returns { el, close, closed }. */
export function openModal({ title, body = "", footer = "", wide = false, dismissible = true }) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="dialog ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="dialog-head"><h2>${esc(title)}</h2>${dismissible ? `<button class="icon-btn" data-close aria-label="Close">×</button>` : ""}</div>
    <div class="dialog-body">${body}</div>
    ${footer ? `<div class="dialog-foot">${footer}</div>` : ""}
  </div>`;
  const previous = document.activeElement;
  let resolve;
  const closed = new Promise((r) => { resolve = r; });
  let done = false;
  const close = (result) => {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    openCount -= 1;
    previous?.focus?.();
    resolve(result);
  };
  const onKey = (e) => { if (e.key === "Escape" && dismissible) close(undefined); };
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && dismissible) close(undefined); });
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => close(undefined)));
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  openCount += 1;
  overlay.querySelector("[data-autofocus], input:not([type=file]):not(:disabled), select, textarea")?.focus();
  return { el: overlay, close, closed };
}

/** Promise<boolean> confirmation dialog. tone "danger" uses a red confirm button. */
export function confirmDialog({ title, message, confirmText = "Confirm", tone = "" }) {
  const { el, close, closed } = openModal({
    title,
    body: `<p>${message}</p>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn ${tone === "danger" ? "btn-danger" : "btn-primary"}" data-confirm data-autofocus>${esc(confirmText)}</button>`,
  });
  el.querySelector("[data-confirm]").addEventListener("click", () => close(true));
  return closed.then((r) => r === true);
}

/* ---------- Theme ---------- */

export function getThemePref() {
  try { return localStorage.getItem("dms_theme") || "dark"; } catch { return "dark"; }
}
export function setThemePref(pref) {
  try { localStorage.setItem("dms_theme", pref); } catch { /* storage unavailable */ }
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/* ---------- Misc ---------- */

export async function copyText(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); notify.success(label); } catch { notify.info("Copy this value", text); }
}

export function setLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("loading", loading);
  button.disabled = loading;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

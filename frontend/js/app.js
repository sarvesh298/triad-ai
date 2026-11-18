/**
 * Entry point: session bootstrap, hash router and the page layout (sidebar + top bar).
 * Routes: #/login #/register #/dashboard #/documents #/documents/<id> #/search?q= #/requests #/admin #/settings
 */
import { api, session } from "./api.js";
import { icon } from "./icons.js";
import { state, events, isAdmin, loadFields, resetState } from "./state.js";
import { $, $$, esc, timeAgo, notify, modalIsOpen, errorRow } from "./ui.js";
import { openUploadModal } from "./upload.js";
import * as authView from "./views/auth.js";
import * as dashboardView from "./views/dashboard.js";
import * as documentsView from "./views/documents.js";
import * as detailsView from "./views/details.js";
import * as searchView from "./views/search.js";
import * as requestsView from "./views/requests.js";
import * as adminView from "./views/admin.js";
import * as settingsView from "./views/profile.js";

const ROUTES = [
  { pattern: /^\/dashboard$/, view: dashboardView, nav: "dashboard", title: "Dashboard" },
  { pattern: /^\/documents$/, view: documentsView, nav: "documents", title: "Documents" },
  { pattern: /^\/documents\/([0-9a-fA-F]{24})$/, view: detailsView, nav: "documents", title: "Document" },
  { pattern: /^\/search$/, view: searchView, nav: "search", title: "Search" },
  { pattern: /^\/requests$/, view: requestsView, nav: "requests", title: "Access requests" },
  { pattern: /^\/admin$/, view: adminView, nav: "admin", title: "Admin", admin: true },
  { pattern: /^\/(settings|profile)$/, view: settingsView, nav: "settings", title: "Settings" },
];

const root = document.getElementById("root");
let cleanup = null;
let renderId = 0;

export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: path || "/", query: new URLSearchParams(qs) };
}

export function navigate(path, query) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== "" && v != null)).toString() : "";
  const target = `#${path}${qs ? `?${qs}` : ""}`;
  if (location.hash === target) route(); else location.hash = target;
}

/* ---------- Layout ---------- */

function layoutHtml() {
  const u = state.user;
  const link = (id, ico, label) => `<a href="#/${id}" data-nav="${id}">${icon(ico)}<span>${label}</span>${id === "requests" ? `<em class="count hidden" data-count></em>` : ""}</a>`;
  const initials = esc((u.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase());
  return `<div class="layout" id="layout">
    <aside class="sidebar">
      <div class="side-head"><a href="#/dashboard"><span class="mark">${icon("layers")}</span><span>TRIAD AI<small>Document Management</small></span></a></div>
      <nav class="side-nav">
        <div class="label">Workspace</div>
        ${link("dashboard", "dashboard", "Dashboard")}
        ${link("documents", "files", "Documents")}
        ${link("search", "search", "Search")}
        ${link("requests", "inbox", "Access requests")}
        <div class="label">Account</div>
        ${isAdmin() ? link("admin", "shieldCheck", "Admin") : ""}
        ${link("settings", "settings", "Settings")}
      </nav>
      <div class="side-foot">
        <span class="avatar">${initials}</span>
        <div class="who">
          <div class="name truncate">${esc(u.name)}</div>
          <div class="div truncate">${esc(u.division)}${u.role === "admin" ? " · Admin" : ""}</div>
        </div>
        <button class="icon-btn" id="logout-btn" aria-label="Sign out" title="Sign out">${icon("logout")}</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${icon("menu")}</button>
        <form class="top-search" id="top-search" role="search">
          ${icon("search")}
          <input class="input" name="q" id="top-search-input" placeholder="Search documents, metadata and text…" autocomplete="off" aria-label="Search documents">
          <kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>
        </form>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="top-upload" aria-label="Upload">${icon("upload")}<span class="lbl">Upload</span></button>
        <div style="position:relative">
          <button class="icon-btn" id="bell" aria-label="Notifications" title="Notifications">${icon("bell")}<span class="badge-dot hidden" id="bell-dot"></span></button>
          <div class="menu hidden" id="notif-menu"></div>
        </div>
        <a href="#/settings" class="avatar" title="${esc(u.name)}" style="text-decoration:none">${initials}</a>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
}

function mountLayout() {
  root.innerHTML = layoutHtml();
  $("#menu-btn").onclick = () => toggleNav(true);
  $("#top-upload").onclick = () => openUploadModal();
  $("#logout-btn").onclick = () => logout();
  $("#bell").onclick = (e) => { e.stopPropagation(); toggleNotifications(); };
  $("#top-search").onsubmit = (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    navigate("/search", q ? { q } : undefined);
  };
  refreshCounts();
}

function toggleNav(open) {
  const layout = $("#layout");
  if (!layout) return;
  layout.classList.toggle("nav-open", open);
  $(".nav-backdrop")?.remove();
  if (open) {
    const b = document.createElement("div");
    b.className = "nav-backdrop";
    b.onclick = () => toggleNav(false);
    layout.appendChild(b);
  }
}

/** Pending incoming requests: sidebar count and notification dot. */
async function refreshCounts() {
  try {
    const n = (await api.documentStats()).incoming_pending;
    $$("[data-count]").forEach((el) => { el.textContent = n; el.classList.toggle("hidden", !n); });
    const dot = $("#bell-dot");
    if (dot) { dot.textContent = n; dot.classList.toggle("hidden", !n); }
  } catch { /* optional */ }
}

async function toggleNotifications() {
  const menu = $("#notif-menu");
  if (!menu.classList.contains("hidden")) { menu.classList.add("hidden"); return; }
  menu.classList.remove("hidden");
  menu.innerHTML = `<div class="menu-head">Notifications <a href="#/requests" class="small">View requests</a></div><div id="notif-items">${'<div class="loading-row"><span class="spinner"></span>Loading…</div>'}</div>`;
  try {
    const [inbox, mine] = await Promise.all([api.inbox(), api.myRequests()]);
    const weekAgo = Date.now() - 7 * 864e5;
    const items = [
      ...inbox.requests.filter((r) => r.status === "pending").map((r) => ({ at: r.created_at, href: "#/requests",
        text: `${esc(r.requester_name)} (${esc(r.requester_division)}) requested access to ${esc(r.document_title)}` })),
      ...mine.requests.filter((r) => r.reviewed_at && new Date(r.reviewed_at) > weekAgo).map((r) => ({ at: r.reviewed_at, href: `#/documents/${r.document_id}`,
        text: `${esc(r.document_division)} ${r.status} your request for ${esc(r.document_title)}` })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    $("#notif-items").innerHTML = items.length
      ? items.map((n) => `<a class="item" href="${n.href}">${n.text}<span class="time">${timeAgo(n.at)}</span></a>`).join("")
      : `<div class="empty">No new notifications</div>`;
  } catch (err) {
    $("#notif-items").innerHTML = errorRow(err.message);
  }
}

document.addEventListener("click", (e) => {
  const menu = $("#notif-menu");
  if (menu && !menu.classList.contains("hidden") && (!e.target.closest("#notif-menu, #bell") || e.target.closest("a"))) menu.classList.add("hidden");
});

/* ---------- Session ---------- */

async function onAuthenticated(user) {
  state.user = user;
  mountLayout();
  loadFields().catch(() => {});
  const { path } = parseHash();
  if (["/", "/login", "/register"].includes(path)) navigate("/dashboard"); else route();
}

function logout(message) {
  session.clear();
  resetState();
  cleanup?.();
  cleanup = null;
  $$(".overlay").forEach((o) => o.remove());
  if (message) notify.warning("Signed out", message);
  navigate("/login");
}

session.onUnauthorized(() => { if (state.user) logout("Your session has expired. Please sign in again."); });

/* ---------- Router ---------- */

async function route() {
  const { path, query } = parseHash();
  cleanup?.();
  cleanup = null;
  const id = ++renderId;

  if (!state.user) {
    document.title = "Sign in – TRIAD AI";
    authView.render(root, { mode: path === "/register" ? "register" : "login", onAuthenticated });
    return;
  }
  if (!$("#layout")) mountLayout();
  if (["/", "/login", "/register"].includes(path)) { navigate("/dashboard"); return; }

  let match = null;
  const found = ROUTES.find((r) => (match = path.match(r.pattern)));
  const content = $("#content");
  toggleNav(false);
  $("#notif-menu")?.classList.add("hidden");
  window.scrollTo({ top: 0 });
  $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === found?.nav));
  if (found?.nav !== "search") $("#top-search-input").value = "";
  refreshCounts();

  if (!found || (found.admin && !isAdmin())) {
    document.title = "Not found – TRIAD AI";
    content.innerHTML = `<div class="page-head"><h1>Page not found</h1></div><p class="muted">${found ? "This page is only available to administrators." : "This page doesn't exist."} <a href="#/dashboard">Go to dashboard</a></p>`;
    return;
  }

  document.title = `${found.title} – TRIAD AI`;
  content.innerHTML = `<div></div>`;
  const ctx = { root: content.firstElementChild, params: match.slice(1), query, navigate, isCurrent: () => id === renderId };
  try {
    const result = await found.view.render(ctx);
    if (id === renderId) cleanup = typeof result === "function" ? result : null;
    else if (typeof result === "function") result();
  } catch (err) {
    console.error(err);
    if (id === renderId) ctx.root.innerHTML = errorRow(err.message || "Failed to load this page.");
  }
}

window.addEventListener("hashchange", route);
events.on("requests:changed", refreshCounts);
events.on("documents:changed", refreshCounts);
setInterval(() => { if (state.user && document.visibilityState === "visible") refreshCounts(); }, 60000);

document.addEventListener("keydown", (e) => {
  if (!state.user || modalIsOpen()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); $("#top-search-input")?.focus(); }
  if (e.key === "Escape") { $("#notif-menu")?.classList.add("hidden"); toggleNav(false); }
});

(async function boot() {
  if (!session.token) { route(); return; }
  try {
    const { user } = await api.me();
    await onAuthenticated(user);
  } catch (err) {
    session.clear();
    route();
    if (err.status === 0) notify.error("Server unavailable", err.message);
  }
})();

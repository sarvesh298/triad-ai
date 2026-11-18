/** Settings: account details, theme, server status and sign out. */
import { api, API_BASE } from "../api.js";
import { state } from "../state.js";
import { $, esc, getThemePref, setThemePref } from "../ui.js";

export async function render({ root, isCurrent }) {
  const u = state.user;
  root.classList.add("narrow");
  root.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="section"><div class="section-head"><h2>Account</h2></div><div class="section-body"><dl class="props">
      <dt>Name</dt><dd>${esc(u.name)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd>
      <dt>Division</dt><dd>${esc(u.division)}</dd><dt>Role</dt><dd>${u.role === "admin" ? "Admin" : "User"}</dd>
    </dl><p class="hint" style="margin-top:10px">Contact an administrator to change your division or role.</p></div></div>
    <div class="section"><div class="section-head"><h2>Appearance</h2></div><div class="section-body">
      <div class="field" style="max-width:240px"><label for="theme">Theme</label><select class="select" id="theme">
        <option value="light">Light</option><option value="dark">Dark</option><option value="system">Same as system</option></select></div></div></div>
    <div class="section"><div class="section-head"><h2>Server status</h2><button class="btn btn-sm" id="recheck">Check again</button></div>
      <div class="section-body" id="health"></div></div>
    <div class="section"><div class="section-body"><button class="btn" id="sign-out">Sign out</button></div></div>`;

  const theme = $("#theme", root);
  theme.value = getThemePref();
  theme.onchange = () => setThemePref(theme.value);

  async function health() {
    const host = $("#health", root);
    host.innerHTML = `<span class="muted">Checking…</span>`;
    try {
      const h = await api.health();
      if (!isCurrent()) return;
      const row = (label, ok, value) => `<dt>${label}</dt><dd><span class="status ${ok ? "ok" : "bad"}">${esc(value)}</span></dd>`;
      host.innerHTML = `<dl class="props">
        <dt>API</dt><dd class="mono">${esc(API_BASE)}</dd>
        ${row("Database", h.database === "Connected", h.database)}
        ${row("OCR", h.ocr.tesseract !== "Not installed", h.ocr.tesseract === "Not installed" ? "Not installed" : `Tesseract ${h.ocr.tesseract.split(".").slice(0, 2).join(".")}`)}
        ${row("PDF support", h.ocr.poppler === "Available", h.ocr.poppler)}
      </dl>`;
    } catch (err) {
      if (isCurrent()) host.innerHTML = `<span class="status bad">${err.status === 503 ? "Database unavailable" : "Server unreachable"}</span>`;
    }
  }
  $("#recheck", root).onclick = health;
  $("#sign-out", root).onclick = () => document.getElementById("logout-btn")?.click();
  health();
}

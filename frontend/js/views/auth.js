/** Sign in and registration: centred card, segmented control, minimal icon fields. */
import { api, session } from "../api.js";
import { $, esc, setLoading, notify, setThemePref } from "../ui.js";
import { icon } from "../icons.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const field = (name, label, type, autocomplete, ico, placeholder) => `
  <div class="field" data-field="${name}"><label class="sr-only" for="f-${name}">${label}</label>
    <div class="ifield">${icon(ico)}<input class="input" id="f-${name}" name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}"></div></div>`;

const isDark = () => document.documentElement.dataset.theme === "dark";

function formHtml(mode) {
  const login = mode === "login";
  const feat = (ico, title, text) => `<li><span class="fi">${icon(ico)}</span><div><b>${title}</b><span>${text}</span></div></li>`;
  return `<div class="login">
    <aside class="login-hero">
      <div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>
      <a class="brand" href="#/login"><span class="mark">${icon("layers")}</span>TRIAD AI</a>
      <div class="hero-copy">
        <span class="eyebrow">Document Management System</span>
        <h2>Secure Document Intelligence &amp; Division Isolation</h2>
        <p>Store, search and share your division's documents with OCR-powered search and approval-based access.</p>
        <ul class="hero-feats">
          ${feat("shieldCheck", "Division isolation", "Documents stay private to the division that owns them.")}
          ${feat("scan", "OCR text search", "Find words inside PDFs and scanned images.")}
          ${feat("key", "Access approvals", "Request and grant cross-division access with one click.")}
        </ul>
      </div>
      <span class="hero-foot">© TRIAD AI</span>
    </aside>
    <div class="login-pane">
    <header class="login-top">
      <a class="brand" href="#/login"><span class="mark">${icon("layers")}</span>TRIAD AI</a>
      <button type="button" class="icon-btn" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">${icon(isDark() ? "sun" : "moon")}</button>
    </header>
    <main class="login-main"><div class="login-box">
      <div class="login-card">
        <div class="login-head">
          <span class="mark mark-lg">${icon("layers")}</span>
          <h1>${login ? "Welcome back" : "Create your account"}</h1>
          <p class="sub">${login ? "Sign in to your TRIAD AI workspace" : "Get started with your division's workspace"}</p>
        </div>
        <nav class="seg" aria-label="Account">
          <a href="#/login" class="${login ? "active" : ""}" ${login ? 'aria-current="page"' : ""}>Sign in</a>
          <a href="#/register" class="${login ? "" : "active"}" ${login ? "" : 'aria-current="page"'}>Create account</a>
        </nav>
        <div id="auth-alert"></div>
        <form id="auth-form" novalidate>
          ${login ? "" : field("name", "Full name", "text", "name", "user", "Full name")}
          ${field("email", "Email", "email", login ? "username" : "email", "mail", "Email address")}
          <div class="field" data-field="password"><label class="sr-only" for="f-password">Password</label>
            <div class="ifield pw">${icon("lock")}<input class="input" id="f-password" name="password" type="password" autocomplete="${login ? "current-password" : "new-password"}" placeholder="${login ? "Password" : "Password (8+ characters)"}">
              <button type="button" id="pw-toggle" aria-label="Show password" title="Show password">${icon("eye")}</button></div>
          </div>
          ${login ? "" : `<div class="field" data-field="division"><label class="sr-only" for="f-division">Division</label><div class="ifield">${icon("building")}<div id="division-host"><select class="select" disabled><option>Loading divisions…</option></select></div></div></div>`}
          <button class="btn btn-primary btn-block btn-lg" type="submit">${login ? "Sign in" : "Create account"}</button>
        </form>
        <p class="login-alt">${login ? `New to TRIAD AI? <a href="#/register">Create an account</a>` : `Already have an account? <a href="#/login">Sign in</a>`}</p>
      </div>
    </div></main>
    </div>
  </div>`;
}

function setError(form, name, message) {
  const f = form.querySelector(`[data-field="${name}"]`);
  if (!f) return;
  f.classList.toggle("invalid", Boolean(message));
  f.querySelector(".err")?.remove();
  if (message) f.insertAdjacentHTML("beforeend", `<span class="err">${esc(message)}</span>`);
}

function showAlert(type, message) {
  $("#auth-alert").innerHTML = message ? `<div class="alert alert-${type}" style="margin-bottom:14px">${esc(message)}</div>` : "";
}

async function loadDivisions() {
  let divisions = [];
  try { ({ divisions } = await api.divisions()); } catch { /* fall back to free text */ }
  const host = $("#division-host");
  if (!host) return;
  host.innerHTML = divisions.length
    ? `<select class="select" id="f-division" name="division"><option value="">Select your division</option>${divisions.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select>`
    : `<input class="input" id="f-division" name="division" placeholder="e.g. Division A">`;
}

export function render(root, { mode, onAuthenticated }) {
  root.innerHTML = formHtml(mode);
  const form = $("#auth-form");
  $("#pw-toggle").onclick = (e) => {
    const input = $("#f-password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    const label = show ? "Hide password" : "Show password";
    Object.assign(e.currentTarget, { innerHTML: icon(show ? "eyeOff" : "eye"), title: label });
    e.currentTarget.setAttribute("aria-label", label);
  };
  $("#theme-toggle").onclick = (e) => {
    setThemePref(isDark() ? "light" : "dark");
    e.currentTarget.innerHTML = icon(isDark() ? "sun" : "moon");
  };
  form.addEventListener("input", (e) => {
    const f = e.target.closest("[data-field]");
    if (f) setError(form, f.dataset.field, "");
  });
  if (mode === "register") loadDivisions();

  form.onsubmit = async (e) => {
    e.preventDefault();
    showAlert("", "");
    const data = Object.fromEntries(new FormData(form));
    const errors = {};
    if (mode === "register" && !data.name?.trim()) errors.name = "Enter your name.";
    if (!EMAIL_RE.test(data.email?.trim() || "")) errors.email = "Enter a valid email address.";
    if (!data.password) errors.password = "Enter your password.";
    else if (mode === "register" && data.password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (mode === "register" && !data.division?.trim()) errors.division = "Select a division.";
    ["name", "email", "password", "division"].forEach((k) => setError(form, k, errors[k]));
    if (Object.keys(errors).length) { form.querySelector(".invalid input, .invalid select")?.focus(); return; }

    const button = form.querySelector('button[type="submit"]');
    setLoading(button, true);
    try {
      if (mode === "register") {
        // New accounts are active immediately: sign straight in and open the dashboard.
        await api.register({ name: data.name.trim(), email: data.email.trim(), password: data.password, division: data.division });
        notify.success("Account created");
      }
      const res = await api.login({ email: data.email.trim(), password: data.password });
      session.set(res.access_token);
      await onAuthenticated(res.user);
    } catch (err) {
      if (err.status === 409) setError(form, "email", err.message);
      else showAlert("error", err.message);
    } finally {
      if (button.isConnected) setLoading(button, false);
    }
  };
}

/** Admin: metadata fields and user accounts. */
import { api } from "../api.js";
import { state, loadFields } from "../state.js";
import { $, $$, esc, formatDate, userStatus, loadingRow, emptyRow, errorRow, openModal, confirmDialog, notify, setLoading } from "../ui.js";

const TYPES = { text: "Text", select: "List", date: "Date" };
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

function fieldDialog(existing, onSaved) {
  const editing = Boolean(existing);
  const f = existing || { key: "", label: "", type: "text", required: false, options: [] };
  const { el, close } = openModal({
    title: editing ? "Edit field" : "Add field",
    body: `<form id="field-form" style="display:grid;gap:12px" novalidate>
      <div class="field" data-f="key"><label for="ff-key">Key</label><input class="input" id="ff-key" name="key" value="${esc(f.key)}" ${editing ? "disabled" : ""} maxlength="64">
        <span class="hint">Used to store and filter the value. Can't be changed later.</span></div>
      <div class="field"><label for="ff-label">Label</label><input class="input" id="ff-label" name="label" value="${esc(f.label)}" maxlength="100"></div>
      <div class="field"><label for="ff-type">Type</label><select class="select" id="ff-type" name="type">${Object.entries(TYPES).map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field ${f.type === "select" ? "" : "hidden"}" data-f="options" id="opts"><label for="ff-options">Options (one per line)</label><textarea class="textarea" id="ff-options" name="options" rows="5">${esc(f.options.join("\n"))}</textarea></div>
      <label class="check"><input type="checkbox" name="required" ${f.required ? "checked" : ""}> Required</label>
      <div id="ff-error"></div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ff-save">Save</button>`,
  });
  const form = $("#field-form", el);
  form.type.onchange = () => $("#opts", el).classList.toggle("hidden", form.type.value !== "select");
  const save = async () => {
    const key = form.key.value.trim();
    const options = form.options.value.split(/\n|,/).map((o) => o.trim()).filter(Boolean);
    const body = { label: form.label.value.trim() || key, type: form.type.value, required: form.required.checked, options };
    $$(".field", form).forEach((x) => x.classList.remove("invalid"));
    let error = "";
    if (!editing && !KEY_RE.test(key)) { error = "Key may only contain letters, numbers, spaces, _ and -."; form.querySelector('[data-f="key"]').classList.add("invalid"); }
    else if (body.type === "select" && !options.length) { error = "Add at least one option."; form.querySelector('[data-f="options"]').classList.add("invalid"); }
    const box = $("#ff-error", el);
    box.innerHTML = error ? `<div class="alert alert-error">${esc(error)}</div>` : "";
    if (error) return;
    const btn = $("#ff-save", el);
    setLoading(btn, true);
    try {
      if (editing) await api.updateField(f.key, body); else await api.createField({ key, ...body });
      notify.success(editing ? "Field updated" : "Field added");
      close();
      onSaved();
    } catch (err) { box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; setLoading(btn, false); }
  };
  $("#ff-save", el).onclick = save;
  form.onsubmit = (e) => { e.preventDefault(); save(); };
}

export async function render({ root, query, isCurrent }) {
  let tab = query.get("tab") === "users" ? "users" : "fields";
  let status = ["pending", "active", "rejected", "deactivated"].includes(query.get("status")) ? query.get("status") : "active";
  let fields = [];
  let users = [];

  root.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1></div><button class="btn btn-primary" id="add-field">Add field</button></div>
    <div class="tabs"><button data-tab="fields">Metadata fields</button><button data-tab="users">Users <span class="n" id="n-pending"></span></button></div>
    <div id="admin-body"></div>`;
  const body = $("#admin-body", root);

  async function showFields() {
    body.innerHTML = `<div class="section">${loadingRow()}</div>`;
    try {
      ({ fields } = await api.fields(true));
      if (!isCurrent() || tab !== "fields") return;
      body.innerHTML = `<p class="muted" style="margin-bottom:10px">These fields appear in the upload form and as filters on the Documents page.</p>
        <div class="section">${fields.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Label</th><th>Key</th><th>Type</th><th class="hide-sm">Options</th><th>Required</th><th>Status</th><th></th></tr></thead><tbody>
        ${fields.map((f) => `<tr><td>${esc(f.label)}</td><td class="mono">${esc(f.key)}</td><td>${TYPES[f.type] || esc(f.type)}</td>
          <td class="hide-sm">${f.options.length ? esc(f.options.join(", ")) : "—"}</td><td>${f.required ? "Yes" : "No"}</td>
          <td>${f.active ? `<span class="status ok">Active</span>` : `<span class="status">Inactive</span>`}</td>
          <td class="actions"><button class="btn btn-sm" data-edit="${esc(f.key)}">Edit</button><button class="btn btn-sm" data-toggle="${esc(f.key)}">${f.active ? "Deactivate" : "Activate"}</button></td></tr>`).join("")}
        </tbody></table></div>` : emptyRow("No fields yet.")}</div>`;
      loadFields(true).catch(() => {});
    } catch (err) { body.innerHTML = `<div class="section">${errorRow(err.message)}</div>`; }
  }

  async function showUsers() {
    body.innerHTML = `<div class="filters"><div class="field"><label for="u-status">Status</label><select class="select" id="u-status">
      ${["active", "pending", "rejected", "deactivated"].map((s) => `<option value="${s}" ${s === status ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></div></div>
      <div class="section" id="users">${loadingRow()}</div>`;
    $("#u-status", root).onchange = (e) => { status = e.target.value; show(); };
    try {
      ({ users } = await api.users(status));
      if (!isCurrent() || tab !== "users") return;
      $("#users", root).innerHTML = users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">Email</th><th>Division</th><th class="hide-sm">Role</th><th class="hide-sm">Joined</th><th>Status</th><th></th></tr></thead><tbody>
        ${users.map((u) => {
          const self = u.id === state.user.id;
          const act = self ? `<span class="muted">You</span>`
            : u.status === "pending" ? `<button class="btn btn-sm btn-success" data-user="${u.id}" data-act="approve">Approve</button><button class="btn btn-sm btn-danger" data-user="${u.id}" data-act="reject">Reject</button>`
              : u.status === "active" ? `<button class="btn btn-sm" data-user="${u.id}" data-act="deactivate">Deactivate</button>`
                : `<button class="btn btn-sm" data-user="${u.id}" data-act="approve">Reactivate</button>`;
          return `<tr><td>${esc(u.name)}</td><td class="hide-sm">${esc(u.email)}</td><td>${esc(u.division)}</td><td class="hide-sm">${u.role === "admin" ? "Admin" : "User"}</td>
            <td class="hide-sm">${formatDate(u.created_at)}</td><td>${userStatus(u.status)}</td><td class="actions">${act}</td></tr>`;
        }).join("")}</tbody></table></div>` : emptyRow(`No ${status} users.`);
    } catch (err) { $("#users", root).innerHTML = errorRow(err.message); }
  }

  function show() {
    $$("[data-tab]", root).forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#add-field", root).classList.toggle("hidden", tab !== "fields");
    const p = new URLSearchParams();
    if (tab === "users") { p.set("tab", "users"); if (status !== "active") p.set("status", status); }
    history.replaceState(null, "", `#/admin${p.toString() ? `?${p}` : ""}`);
    return tab === "fields" ? showFields() : showUsers();
  }

  root.addEventListener("click", async (e) => {
    const t = e.target;
    const tb = t.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; show(); return; }
    if (t.closest("#add-field")) { fieldDialog(null, showFields); return; }
    const ed = t.closest("[data-edit]");
    if (ed) { fieldDialog(fields.find((f) => f.key === ed.dataset.edit), showFields); return; }
    const tg = t.closest("[data-toggle]");
    if (tg) {
      const f = fields.find((x) => x.key === tg.dataset.toggle);
      if (!(await confirmDialog({ title: f.active ? "Deactivate field" : "Activate field",
        message: f.active ? `"${esc(f.label)}" will be hidden from the upload form and filters. Existing values are kept.` : `"${esc(f.label)}" will be shown in the upload form and filters.`,
        confirmText: f.active ? "Deactivate" : "Activate" }))) return;
      try { await api.updateField(f.key, { active: !f.active }); notify.success(f.active ? "Field deactivated" : "Field activated"); showFields(); }
      catch (err) { notify.error("Couldn't update field", err.message); }
      return;
    }
    const act = t.closest("[data-act]");
    if (act) {
      const u = users.find((x) => x.id === act.dataset.user);
      const verb = { approve: u.status === "pending" ? "Approve" : "Reactivate", reject: "Reject", deactivate: "Deactivate" }[act.dataset.act];
      if (!(await confirmDialog({ title: `${verb} user`, message: `${verb} ${esc(u.name)} (${esc(u.email)})?`, confirmText: verb, tone: act.dataset.act === "approve" ? "" : "danger" }))) return;
      setLoading(act, true);
      try { const res = await api.userAction(u.id, act.dataset.act); notify.success(res.message); showUsers(); }
      catch (err) { notify.error("Couldn't update user", err.message); setLoading(act, false); }
    }
  });

  api.users("pending").then((r) => { if (isCurrent() && r.users.length) $("#n-pending", root).textContent = `(${r.users.length} pending)`; }).catch(() => {});
  await show();
}

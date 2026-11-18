/** Access requests: incoming (for your division's documents) and sent (by you). */
import { api } from "../api.js";
import { state, events } from "../state.js";
import { $, $$, esc, formatDate, requestStatus, loadingRow, emptyRow, errorRow, confirmDialog, notify, setLoading } from "../ui.js";
import { downloadDocument } from "../actions.js";
import { icon } from "../icons.js";

const initials = (n) => esc((n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase());

export async function render({ root, query, navigate, isCurrent }) {
  let tab = query.get("tab") === "outgoing" ? "outgoing" : "incoming";
  let status = ["pending", "approved", "rejected"].includes(query.get("status")) ? query.get("status") : "";
  let data = null;

  root.innerHTML = `
    <div class="page-head"><div><h1>Access requests</h1><p>Users from other divisions need approval from the owning division before they can download a document.</p></div></div>
    <div class="tabs">
      <button data-tab="incoming">Incoming <span class="n" id="n-in"></span></button>
      <button data-tab="outgoing">Sent <span class="n" id="n-out"></span></button>
    </div>
    <div id="open-box" class="hidden">
      <form class="filters" id="open-form">
        <div class="field grow"><label for="doc-id">Open a document from another division by its ID</label><input class="input mono" id="doc-id" name="doc_id" placeholder="24-character document ID"></div>
        <button class="btn" type="submit">Open</button>
      </form>
    </div>
    <div class="filters"><div class="field"><label for="status">Status</label><select class="select" id="status">
      <option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div></div>
    <div id="req-body">${loadingRow()}</div>`;
  $("#status", root).value = status;

  function draw() {
    $$("[data-tab]", root).forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("#open-box", root).classList.toggle("hidden", tab !== "outgoing");
    const p = new URLSearchParams();
    if (tab === "outgoing") p.set("tab", "outgoing");
    if (status) p.set("status", status);
    history.replaceState(null, "", `#/requests${p.toString() ? `?${p}` : ""}`);
    if (!data) return;
    const pin = data.incoming.filter((r) => r.status === "pending").length;
    $("#n-in", root).textContent = pin ? `(${pin} pending)` : `(${data.incoming.length})`;
    $("#n-out", root).textContent = `(${data.outgoing.length})`;

    const items = data[tab].filter((r) => !status || r.status === status);
    const body = $("#req-body", root);
    if (!items.length) {
      body.innerHTML = emptyRow(data[tab].length ? "No requests with this status."
        : tab === "incoming" ? `No one has requested ${state.user.division}'s documents yet.` : "You haven't requested any documents.");
      return;
    }
    if (tab === "incoming") {
      body.innerHTML = `<ul class="req-list">${items.map((r) => `<li class="req-card" data-id="${r.id}">
          <span class="avatar">${initials(r.requester_name)}</span>
          <div class="req-main">
            <div class="req-who"><b>${esc(r.requester_name)}</b><span class="badge">${esc(r.requester_division)}</span>${requestStatus(r.status)}</div>
            <div class="req-doc">${icon("file")}<a href="#/documents/${r.document_id}">${esc(r.document_title)}</a><span class="muted">· ${formatDate(r.created_at)}</span></div>
          </div>
          <div class="req-actions">${r.status === "pending" ? `<button class="btn btn-success" data-decide="approve">${icon("check")}Approve</button><button class="btn btn-danger" data-decide="reject">${icon("x")}Reject</button>` : ""}</div>
        </li>`).join("")}</ul>`;
    } else {
      body.innerHTML = `<ul class="req-list">${items.map((r) => `<li class="req-card">
          <span class="req-ico">${icon("file")}</span>
          <div class="req-main">
            <div class="req-who"><a href="#/documents/${r.document_id}"><b>${esc(r.document_title)}</b></a>${requestStatus(r.status)}</div>
            <div class="req-doc"><span class="badge">${esc(r.document_division)}</span><span class="muted">Requested ${formatDate(r.created_at)}</span></div>
          </div>
          <div class="req-actions">${r.status === "approved" ? `<button class="btn btn-primary" data-download="${r.document_id}" data-name="${esc(r.document_title)}">${icon("download")}Download</button>`
            : r.status === "rejected" ? `<button class="btn" data-again="${r.document_id}">Request again</button>` : ""}</div>
        </li>`).join("")}</ul>`;
    }
  }

  async function load() {
    try {
      const [inc, out] = await Promise.all([api.inbox(), api.myRequests()]);
      if (!isCurrent()) return;
      data = { incoming: inc.requests, outgoing: out.requests };
      draw();
    } catch (err) {
      if (isCurrent()) $("#req-body", root).innerHTML = errorRow(err.message, "retry");
    }
  }

  root.addEventListener("click", async (e) => {
    const t = e.target;
    const tb = t.closest("[data-tab]");
    if (tb) { tab = tb.dataset.tab; draw(); return; }
    const dec = t.closest("[data-decide]");
    if (dec) {
      const r = data.incoming.find((x) => x.id === dec.closest("[data-id]").dataset.id);
      const approve = dec.dataset.decide === "approve";
      const ok = await confirmDialog({
        title: approve ? "Approve request" : "Reject request",
        message: approve ? `Allow ${esc(r.requester_name)} (${esc(r.requester_division)}) to download "${esc(r.document_title)}"?`
          : `Reject ${esc(r.requester_name)}'s request for "${esc(r.document_title)}"?`,
        confirmText: approve ? "Approve" : "Reject", tone: approve ? "" : "danger",
      });
      if (!ok) return;
      setLoading(dec, true);
      try { const res = await (approve ? api.approveRequest(r.id) : api.rejectRequest(r.id)); notify.success(res.message); events.emit("requests:changed"); }
      catch (err) { notify.error("Couldn't update request", err.message); setLoading(dec, false); if (err.status === 409) load(); }
      return;
    }
    const dl = t.closest("[data-download]");
    if (dl) { downloadDocument(dl.dataset.download, dl.dataset.name, dl); return; }
    const again = t.closest("[data-again]");
    if (again) {
      setLoading(again, true);
      try { const res = await api.requestAccess(again.dataset.again); notify.success("Request sent", res.message); events.emit("requests:changed"); }
      catch (err) { notify.error("Couldn't send request", err.message); setLoading(again, false); }
      return;
    }
    if (t.closest("#retry")) load();
  });
  $("#status", root).onchange = (e) => { status = e.target.value; draw(); };
  $("#open-form", root).onsubmit = (e) => {
    e.preventDefault();
    const id = $("#doc-id", root).value.trim();
    if (!/^[0-9a-fA-F]{24}$/.test(id)) { notify.error("Invalid document ID", "A document ID is 24 characters (0-9, a-f)."); return; }
    navigate(`/documents/${id}`);
  };

  draw();
  await load();
  return events.on("requests:changed", () => { if (isCurrent()) load(); });
}

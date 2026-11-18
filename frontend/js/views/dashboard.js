/** Dashboard: counts, recent documents, pending requests and recent activity. */
import { api } from "../api.js";
import { state, events } from "../state.js";
import { $, esc, formatDate, timeAgo, fileExt, fileKind, loadingRow, emptyRow, errorRow, confirmDialog, notify, setLoading } from "../ui.js";
import { openUploadModal } from "../upload.js";
import { downloadDocument } from "../actions.js";
import { icon } from "../icons.js";

const STAT_ICONS = { "Documents": "files", "Added this week": "upload", "OCR indexed": "scan", "Pending requests": "clock" };
const stat = (label, value) => `<div class="stat"><div class="stat-top"><span class="label">${label}</span><span class="stat-ico">${icon(STAT_ICONS[label])}</span></div><div class="value">${value}</div></div>`;
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function recentTable(docs) {
  if (!docs.length) return emptyRow("No documents yet.", `<button class="btn btn-primary btn-sm" id="dash-upload">Upload a document</button>`);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th class="hide-sm">Division</th><th class="hide-sm">Uploaded by</th><th>Date</th><th></th></tr></thead><tbody>
    ${docs.map((d) => `<tr class="link" data-href="#/documents/${d.id}">
      <td><div class="doc-name"><span class="ext" title="${esc(fileExt(d))}">${icon(fileKind(d) === "image" ? "image" : "fileText")}</span><a href="#/documents/${d.id}">${esc(d.title)}</a></div></td>
      <td class="hide-sm"><span class="badge">${esc(d.division)}</span></td><td class="hide-sm">${esc(d.owner_name || "—")}</td><td class="nowrap">${formatDate(d.created_at)}</td>
      <td class="actions"><button class="btn btn-sm" data-download="${d.id}" data-name="${esc(d.filename)}" title="Download" aria-label="Download">${icon("download")}</button></td></tr>`).join("")}
  </tbody></table></div>`;
}

function pendingList(pending) {
  if (!pending.length) return emptyRow("No pending requests.");
  return `<ul class="list">${pending.slice(0, 6).map((r) => `<li data-id="${r.id}">
    <div><strong>${esc(r.requester_name)}</strong> <span class="muted">(${esc(r.requester_division)})</span></div>
    <div class="small muted">${esc(r.document_title)} · ${timeAgo(r.created_at)}</div>
    <div class="row" style="margin-top:6px"><button class="btn btn-sm btn-success" data-decide="approve">${icon("check")}Approve</button><button class="btn btn-sm btn-danger" data-decide="reject">${icon("x")}Reject</button></div>
  </li>`).join("")}</ul>${pending.length > 6 ? `<div class="pager"><a href="#/requests">View all ${pending.length}</a></div>` : ""}`;
}

function activityList(docs, inbox, outgoing) {
  const items = [];
  docs.forEach((d) => items.push({ at: d.created_at, text: `${esc(d.owner_name || "Someone")} uploaded <a href="#/documents/${d.id}">${esc(d.title)}</a>` }));
  inbox.forEach((r) => {
    items.push({ at: r.created_at, text: `${esc(r.requester_name)} requested ${esc(r.document_title)}` });
    if (r.reviewed_at) items.push({ at: r.reviewed_at, text: `Request from ${esc(r.requester_name)} was ${r.status}` });
  });
  outgoing.forEach((r) => {
    items.push({ at: r.created_at, text: `You requested ${esc(r.document_title)} from ${esc(r.document_division)}` });
    if (r.reviewed_at) items.push({ at: r.reviewed_at, text: `${esc(r.document_division)} ${r.status} your request for <a href="#/documents/${r.document_id}">${esc(r.document_title)}</a>` });
  });
  const sorted = items.filter((i) => i.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
  if (!sorted.length) return emptyRow("No activity yet.");
  return `<ul class="list">${sorted.map((i) => `<li>${i.text}<div class="small muted">${timeAgo(i.at)}</div></li>`).join("")}</ul>`;
}

export async function render({ root, isCurrent }) {
  root.innerHTML = `
    <div class="page-head welcome"><div><h1>${greeting()}, ${esc(state.user.name.split(" ")[0])}</h1><p>Here's what's happening in ${esc(state.user.division)}.</p></div></div>
    <div class="stats" id="stats">${stat("Documents", "–")}${stat("Added this week", "–")}${stat("OCR indexed", "–")}${stat("Pending requests", "–")}</div>
    <div class="dash">
      <div class="section"><div class="section-head"><h2>Recent documents</h2><a href="#/documents" class="small">View all</a></div><div id="recent">${loadingRow()}</div></div>
      <div class="stack">
        <div class="section"><div class="section-head"><h2>Pending requests</h2></div><div id="pending">${loadingRow()}</div></div>
        <div class="section"><div class="section-head"><h2>Recent activity</h2></div><div id="activity">${loadingRow()}</div></div>
      </div>
    </div>`;

  let pending = [];
  root.addEventListener("click", async (e) => {
    if (e.target.closest("#dash-upload, #dash-upload-top")) { openUploadModal(); return; }
    const dl = e.target.closest("[data-download]");
    if (dl) { e.stopPropagation(); downloadDocument(dl.dataset.download, dl.dataset.name, dl); return; }
    const decide = e.target.closest("[data-decide]");
    if (decide) {
      const r = pending.find((x) => x.id === decide.closest("[data-id]").dataset.id);
      const approve = decide.dataset.decide === "approve";
      const ok = await confirmDialog({
        title: approve ? "Approve request" : "Reject request",
        message: approve ? `Allow ${esc(r.requester_name)} (${esc(r.requester_division)}) to download "${esc(r.document_title)}"?`
          : `Reject ${esc(r.requester_name)}'s request for "${esc(r.document_title)}"?`,
        confirmText: approve ? "Approve" : "Reject", tone: approve ? "" : "danger",
      });
      if (!ok) return;
      setLoading(decide, true);
      try {
        const res = await (approve ? api.approveRequest(r.id) : api.rejectRequest(r.id));
        notify.success(res.message);
        events.emit("requests:changed");
      } catch (err) { notify.error("Couldn't update request", err.message); setLoading(decide, false); }
      return;
    }
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a")) location.hash = row.dataset.href;
  });

  async function load() {
    const [stats, docs, inbox, mine] = await Promise.allSettled([api.documentStats(), api.listDocuments({ limit: 8 }), api.inbox(), api.myRequests()]);
    if (!isCurrent()) return;
    if (stats.status === "fulfilled") {
      const s = stats.value;
      const pct = s.total_documents ? Math.round((s.ocr_completed / s.total_documents) * 100) : 0;
      $("#stats", root).innerHTML = stat("Documents", s.total_documents) + stat("Added this week", s.uploaded_this_week)
        + stat("OCR indexed", `${pct}%`) + stat("Pending requests", s.incoming_pending);
    }
    $("#recent", root).innerHTML = docs.status === "fulfilled" ? recentTable(docs.value.documents) : errorRow(docs.reason.message);
    pending = inbox.status === "fulfilled" ? inbox.value.requests.filter((r) => r.status === "pending") : [];
    $("#pending", root).innerHTML = inbox.status === "fulfilled" ? pendingList(pending) : errorRow(inbox.reason.message);
    $("#activity", root).innerHTML = activityList(
      docs.status === "fulfilled" ? docs.value.documents : [],
      inbox.status === "fulfilled" ? inbox.value.requests : [],
      mine.status === "fulfilled" ? mine.value.requests : [],
    );
  }

  await load();
  const offs = [events.on("documents:changed", load), events.on("requests:changed", load)];
  return () => offs.forEach((off) => off());
}

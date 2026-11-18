/** Documents: filter bar + table, server-side filtering, sorting and paging. */
import { api } from "../api.js";
import { state, events, loadFields, fieldLabels } from "../state.js";
import { $, $$, esc, formatDate, formatBytes, fileExt, fileKind, ocrStatus, metadataText, loadingRow, emptyRow, errorRow } from "../ui.js";
import { openUploadModal } from "../upload.js";
import { downloadDocument } from "../actions.js";
import { icon } from "../icons.js";

const PAGE_SIZE = 25;
const CONTROL = new Set(["_q", "_type", "_sort", "page"]);

function readQuery(query) {
  const filters = {};
  query.forEach((v, k) => { if (!CONTROL.has(k) && v) filters[k] = v; });
  return { q: query.get("_q") || "", type: query.get("_type") || "", sort: query.get("_sort") || "newest", page: Math.max(1, Number(query.get("page")) || 1), filters };
}

function filterControl(f, value) {
  const id = `flt-${f.key.replace(/\W+/g, "_")}`;
  const control = f.type === "select"
    ? `<select class="select" id="${id}" data-filter="${esc(f.key)}"><option value="">All</option>${f.options.map((o) => `<option ${o === value ? "selected" : ""} value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`
    : `<input class="input" id="${id}" data-filter="${esc(f.key)}" type="${f.type === "date" ? "date" : "text"}" value="${esc(value || "")}">`;
  return `<div class="field"><label for="${id}">${esc(f.label)}</label>${control}</div>`;
}

export async function render({ root, query, isCurrent }) {
  const s = readQuery(query);
  try { await loadFields(); } catch { /* no metadata filters */ }
  const fields = state.fields;
  const labels = fieldLabels();

  root.innerHTML = `
    <div class="page-head"><div><h1>Documents</h1><p>${esc(state.user.division)}</p></div></div>
    <div class="filters">
      <div class="field grow"><label for="doc-q">Name</label><input class="input" id="doc-q" value="${esc(s.q)}" placeholder="Filter by title or file name"></div>
      <div class="field"><label for="doc-type">Type</label><select class="select" id="doc-type">
        <option value="">All</option><option value="pdf" ${s.type === "pdf" ? "selected" : ""}>PDF</option><option value="image" ${s.type === "image" ? "selected" : ""}>Image</option></select></div>
      ${fields.map((f) => filterControl(f, s.filters[f.key])).join("")}
      <div class="field"><label for="doc-sort">Sort</label><select class="select" id="doc-sort">
        <option value="newest" ${s.sort === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${s.sort === "oldest" ? "selected" : ""}>Oldest first</option><option value="title" ${s.sort === "title" ? "selected" : ""}>Title</option></select></div>
      <button class="btn" id="clear">Clear</button>
    </div>
    <div class="section"><div id="doc-body">${loadingRow()}</div><div class="pager hidden" id="pager"></div></div>`;

  function syncUrl() {
    const p = new URLSearchParams();
    if (s.q) p.set("_q", s.q);
    if (s.type) p.set("_type", s.type);
    if (s.sort !== "newest") p.set("_sort", s.sort);
    if (s.page > 1) p.set("page", s.page);
    Object.entries(s.filters).forEach(([k, v]) => v && p.set(k, v));
    history.replaceState(null, "", `#/documents${p.toString() ? `?${p}` : ""}`);
  }

  let seqNo = 0;
  async function load() {
    const seq = ++seqNo;
    syncUrl();
    const body = $("#doc-body", root);
    body.innerHTML = loadingRow();
    $("#pager", root).classList.add("hidden");
    try {
      const res = await api.listDocuments({ ...s.filters, _q: s.q, _type: s.type, _sort: s.sort, page: s.page, limit: PAGE_SIZE });
      if (seq !== seqNo || !isCurrent()) return;
      const docs = res.documents;
      if (!docs.length) {
        body.innerHTML = (s.q || s.type || Object.keys(s.filters).length)
          ? emptyRow("No documents match these filters.")
          : emptyRow("No documents have been uploaded to your division yet.", `<button class="btn btn-primary btn-sm" id="empty-upload">Upload</button>`);
        return;
      }
      body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>
          <th>Name</th><th class="hide-sm">Division</th><th class="hide-sm">Uploaded by</th><th>Date</th><th class="hide-sm">Size</th><th class="hide-sm">Metadata</th><th class="hide-sm">OCR</th><th></th></tr></thead><tbody>
        ${docs.map((d) => `<tr class="link" data-href="#/documents/${d.id}">
          <td><div class="doc-name"><span class="ext" title="${esc(fileExt(d))}">${icon(fileKind(d) === "image" ? "image" : "fileText")}</span><a href="#/documents/${d.id}">${esc(d.title)}</a></div></td>
          <td class="hide-sm"><span class="badge">${esc(d.division)}</span></td>
          <td class="hide-sm">${esc(d.owner_name || "—")}</td>
          <td class="nowrap">${formatDate(d.created_at)}</td>
          <td class="hide-sm">${formatBytes(d.size)}</td>
          <td class="hide-sm">${metadataText(d.metadata, labels)}</td>
          <td class="hide-sm">${ocrStatus(d.ocr_status)}</td>
          <td class="actions"><button class="btn btn-sm" data-download="${d.id}" data-name="${esc(d.filename)}">${icon("download")}Download</button></td>
        </tr>`).join("")}</tbody></table></div>`;
      const pages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
      const from = (s.page - 1) * PAGE_SIZE + 1;
      const pager = $("#pager", root);
      pager.classList.remove("hidden");
      pager.innerHTML = `<span>${from}–${from + docs.length - 1} of ${res.total}</span><span class="row">
        <button class="btn btn-sm" data-page="${s.page - 1}" ${s.page <= 1 ? "disabled" : ""}>Previous</button>
        <button class="btn btn-sm" data-page="${s.page + 1}" ${s.page >= pages ? "disabled" : ""}>Next</button></span>`;
    } catch (err) {
      if (seq === seqNo) body.innerHTML = errorRow(err.message, "retry");
    }
  }

  let timer;
  const later = (fn, ms = 300) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  $("#doc-q", root).addEventListener("input", (e) => later(() => { s.q = e.target.value.trim(); s.page = 1; load(); }));
  $("#doc-type", root).onchange = (e) => { s.type = e.target.value; s.page = 1; load(); };
  $("#doc-sort", root).onchange = (e) => { s.sort = e.target.value; s.page = 1; load(); };
  $$("[data-filter]", root).forEach((input) => {
    const apply = () => { const v = input.value.trim(); if (v) s.filters[input.dataset.filter] = v; else delete s.filters[input.dataset.filter]; s.page = 1; load(); };
    input.addEventListener(input.tagName === "SELECT" || input.type === "date" ? "change" : "input", () => later(apply, input.tagName === "SELECT" ? 0 : 350));
  });
  $("#clear", root).onclick = () => {
    Object.assign(s, { q: "", type: "", sort: "newest", page: 1, filters: {} });
    $("#doc-q", root).value = "";
    $("#doc-type", root).value = "";
    $("#doc-sort", root).value = "newest";
    $$("[data-filter]", root).forEach((i) => (i.value = ""));
    load();
  };

  root.addEventListener("click", (e) => {
    const dl = e.target.closest("[data-download]");
    if (dl) { e.stopPropagation(); downloadDocument(dl.dataset.download, dl.dataset.name, dl); return; }
    const pg = e.target.closest("[data-page]");
    if (pg && !pg.disabled) { s.page = Number(pg.dataset.page); load(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest("#empty-upload")) { openUploadModal(); return; }
    if (e.target.closest("#retry")) { load(); return; }
    const row = e.target.closest("tr[data-href]");
    if (row && !e.target.closest("a, button")) location.hash = row.dataset.href;
  });

  await load();
  return events.on("documents:changed", load);
}

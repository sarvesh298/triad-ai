/** Document page: preview, extracted text, details, metadata and access. */
import { api } from "../api.js";
import { state, loadFields, fieldLabels } from "../state.js";
import { $, esc, formatDateTime, formatBytes, fileKind, ocrStatus, requestStatus, errorRow, copyText } from "../ui.js";
import { downloadDocument, requestDocumentAccess } from "../actions.js";
import { icon } from "../icons.js";

const BROWSER_IMAGE = /\.(png|jpe?g)$/i; // TIFF can't be shown by browsers

export async function render({ root, params, isCurrent }) {
  const [id] = params;
  let objectUrl = null;
  const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  root.innerHTML = `<a class="back" href="#/documents">← Documents</a><div class="loading-row"><span class="spinner"></span>Loading…</div>`;

  let data;
  try {
    [data] = await Promise.all([api.getDocument(id), loadFields().catch(() => [])]);
  } catch (err) {
    if (isCurrent()) root.innerHTML = `<a class="back" href="#/documents">← Documents</a>${errorRow(err.status === 404 ? "Document not found." : err.message)}`;
    return cleanup;
  }
  if (!isCurrent()) return cleanup;

  const d = data.document;
  const labels = fieldLabels();
  const own = d.division === state.user.division;
  const kind = fileKind(d);
  const meta = Object.entries(d.metadata || {});
  const reqStatus = data.access_request_status;

  const action = data.can_download ? `<button class="btn btn-primary" id="download-btn">${icon("download")}Download Document</button>` : "";
  const locked = !data.can_download ? `<div class="callout warn">${icon("lock")}
      <div class="grow"><b>This document belongs to ${esc(d.division)}.</b>
        <span>${reqStatus === "rejected" ? "Your last request was rejected. You can ask again." : "Your division requires access approval."}</span></div>
      ${reqStatus === "pending"
        ? `<span class="pending-pill"><i></i>Access request pending</span>`
        : `<button class="btn btn-warn" data-request>${icon("key")}${reqStatus === "rejected" ? "Request access again" : "Request access"}</button>`}
    </div>` : "";

  let accessText;
  if (own) accessText = `This document belongs to your division.`;
  else if (data.can_download) accessText = `Owned by ${esc(d.division)}. Your access request was approved.`;
  else if (reqStatus === "pending") accessText = `Owned by ${esc(d.division)}. Your request is waiting for their approval.`;
  else if (reqStatus === "rejected") accessText = `Owned by ${esc(d.division)}. Your last request was rejected.`;
  else accessText = `Owned by ${esc(d.division)}. You need their approval to view or download it.`;

  root.innerHTML = `
    <a class="back" href="#/documents">← Documents</a>
    <div class="page-head">
      <div style="min-width:0"><h1 style="overflow-wrap:anywhere">${esc(d.title)}</h1>
        <p>${kind === "pdf" ? "PDF" : kind === "image" ? "Image" : "File"} · ${formatBytes(d.size)} · ${esc(d.division)}</p></div>
      <div class="row"><button class="btn" id="copy-id">${icon("copy")}Copy ID</button>${action}</div>
    </div>
    ${locked}
    <div class="doc-layout">
      <div>
        <div class="section"><div class="section-head"><h2>Preview</h2>${data.can_download ? `<button class="btn btn-sm hidden" id="open-tab">Open in new tab</button>` : ""}</div>
          <div class="preview" id="preview"></div></div>
        ${data.ocr ? `<div class="section"><div class="section-head"><h2>Extracted text</h2>${data.ocr.text ? `<button class="btn btn-sm" id="copy-text">Copy</button>` : ""}</div>
          <div class="section-body">${data.ocr.status === "failed"
            ? `<p style="color:var(--danger)">OCR failed: ${esc(data.ocr.error || "unknown error")}</p>`
            : data.ocr.text ? `<pre class="ocr-text" id="ocr-text">${esc(data.ocr.text)}</pre>${data.ocr.truncated ? `<p class="hint" style="margin-top:8px">Showing the first ${data.ocr.text.length.toLocaleString()} of ${data.ocr.characters.toLocaleString()} characters.</p>` : ""}`
              : `<p class="muted">No text was found in this document.</p>`}</div></div>` : ""}
      </div>
      <div>
        <div class="section"><div class="section-head"><h2>Details</h2></div><div class="section-body"><dl class="props">
          <dt>Uploaded by</dt><dd>${esc(d.owner_name || "—")}</dd>
          <dt>Uploaded</dt><dd>${formatDateTime(d.created_at)}</dd>
          <dt>Division</dt><dd>${esc(d.division)}</dd>
          <dt>File</dt><dd>${esc(d.filename)}</dd>
          <dt>Size</dt><dd>${formatBytes(d.size)}</dd>
          ${data.can_download ? `<dt>OCR</dt><dd>${ocrStatus(d.ocr_status)}</dd>` : ""}
          <dt>ID</dt><dd class="mono">${esc(d.id)}</dd>
        </dl></div></div>
        <div class="section"><div class="section-head"><h2>Metadata</h2></div><div class="section-body">
          ${meta.length ? `<dl class="props">${meta.map(([k, v]) => `<dt>${esc(labels[k] || k)}</dt><dd><span class="badge">${esc(v)}</span></dd>`).join("")}</dl>` : `<p class="muted">No metadata</p>`}
        </div></div>
        <div class="section"><div class="section-head"><h2>Access</h2>${!own && reqStatus ? requestStatus(data.can_download ? "approved" : reqStatus) : ""}</div>
          <div class="section-body"><p>${accessText}</p></div></div>
      </div>
    </div>`;

  root.addEventListener("click", async (e) => {
    if (e.target.closest("#copy-id")) { copyText(d.id, "Document ID copied"); return; }
    if (e.target.closest("#copy-text")) { copyText(data.ocr.text, "Text copied"); return; }
    const dl = e.target.closest("#download-btn");
    if (dl) { downloadDocument(d.id, d.filename, dl); return; }
    const req = e.target.closest("[data-request]");
    if (req) {
      const res = await requestDocumentAccess(d, req);
      if (res && isCurrent()) window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  });

  const preview = $("#preview", root);
  if (!data.can_download) {
    preview.innerHTML = `<p class="muted" style="padding:24px;text-align:center">Preview is available after ${esc(d.division)} approves your request.</p>`;
  } else if (!(kind === "pdf" || BROWSER_IMAGE.test(d.filename))) {
    preview.innerHTML = `<p class="muted" style="padding:24px;text-align:center">This file type can't be previewed in the browser. Download it to view.</p>`;
  } else {
    preview.innerHTML = `<div class="loading-row"><span class="spinner"></span>Loading preview…</div>`;
    try {
      const { blob } = await api.fetchFile(d.id);
      if (!isCurrent()) return cleanup;
      objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: d.content_type }));
      preview.innerHTML = kind === "pdf" ? `<iframe src="${objectUrl}" title="Preview of ${esc(d.title)}"></iframe>` : `<img src="${objectUrl}" alt="Preview of ${esc(d.title)}">`;
      const openTab = $("#open-tab", root);
      openTab.classList.remove("hidden");
      openTab.onclick = () => window.open(objectUrl, "_blank", "noopener");
    } catch (err) {
      if (isCurrent()) preview.innerHTML = errorRow(err.message);
    }
  }
  return cleanup;
}

/** Search titles, metadata and OCR text; results show where the match was found. */
import { api } from "../api.js";
import { state, loadFields, fieldLabels } from "../state.js";
import { $, $$, esc, highlight, formatDate, fileKind, loadingRow, emptyRow, errorRow } from "../ui.js";

const IN = { all: "Anywhere", title: "Title or file name", metadata: "Metadata", content: "Document text" };
const MATCH = { title: "Title", filename: "File name", metadata: "Metadata", content: "OCR text" };

const inWhere = (r, w) => w === "all" || (w === "title" && (r.match.fields.includes("title") || r.match.fields.includes("filename"))) || r.match.fields.includes(w);
const inType = (r, t) => !t || fileKind(r) === t;

export async function render({ root, query, navigate, isCurrent }) {
  const q = (query.get("q") || "").trim();
  let where = IN[query.get("in")] ? query.get("in") : "all";
  let type = ["pdf", "image"].includes(query.get("type")) ? query.get("type") : "";
  loadFields().catch(() => {});
  const top = document.getElementById("top-search-input");
  if (top) top.value = q;

  root.innerHTML = `
    <div class="page-head"><div><h1>Search</h1><p>Searches document titles, metadata and extracted text in ${esc(state.user.division)}.</p></div></div>
    <form class="filters search-hero" id="search-form" role="search">
      <div class="field grow"><label for="search-input">Search for</label><input class="input" id="search-input" name="q" value="${esc(q)}" maxlength="200" autocomplete="off" placeholder="Search titles, metadata and text inside documents"></div>
      <button class="btn btn-primary" type="submit">Search</button>
    </form>
    <div class="chip-bar">
      <div class="chip-group" id="s-in" role="radiogroup" aria-label="Found in"><span class="chip-label">Found in</span>
        ${Object.entries(IN).map(([k, v]) => `<button type="button" class="fchip" role="radio" data-v="${k}">${v}</button>`).join("")}</div>
      <div class="chip-group" id="s-type" role="radiogroup" aria-label="File type"><span class="chip-label">Type</span>
        ${[["", "All"], ["pdf", "PDF"], ["image", "Image"]].map(([k, v]) => `<button type="button" class="fchip" role="radio" data-v="${k}">${v}</button>`).join("")}</div>
    </div>
    <div class="results" id="results">${q ? loadingRow("Searching…") : emptyRow("Enter a word or phrase to search.")}</div>`;

  $("#search-form", root).onsubmit = (e) => {
    e.preventDefault();
    const v = $("#search-input", root).value.trim();
    if (!v) { $("#search-input", root).focus(); return; }
    navigate("/search", { q: v, in: where !== "all" ? where : "", type });
  };
  // Filter chips: single-select groups, reflected in the URL and applied to the loaded results.
  function paintChips() {
    $$("#s-in .fchip", root).forEach((c) => { const on = c.dataset.v === where; c.classList.toggle("on", on); c.setAttribute("aria-checked", on); });
    $$("#s-type .fchip", root).forEach((c) => { const on = c.dataset.v === type; c.classList.toggle("on", on); c.setAttribute("aria-checked", on); });
  }
  paintChips();
  let onChip = null;
  root.addEventListener("click", (e) => {
    const c = e.target.closest(".fchip");
    if (!c) return;
    if (c.closest("#s-in")) where = c.dataset.v; else type = c.dataset.v;
    paintChips();
    onChip?.();
  });
  if (!q) { $("#search-input", root).focus(); return; }

  let res;
  try { res = await api.search(q); } catch (err) { if (isCurrent()) $("#results", root).innerHTML = errorRow(err.message); return; }
  if (!isCurrent()) return;
  const labels = fieldLabels();

  function draw() {
    const shown = res.results.filter((r) => inWhere(r, where) && inType(r, type));
    const head = `<div class="section-head"><span class="muted">${shown.length} of ${res.results.length} result${res.results.length === 1 ? "" : "s"} for “${esc(q)}”</span></div>`;
    if (!shown.length) {
      $("#results", root).innerHTML = head + emptyRow(res.results.length ? "No results with these filters." : "No documents matched your search.");
      return;
    }
    $("#results", root).innerHTML = head + shown.map((r) => {
      const meta = Object.entries(r.metadata || {}).map(([k, v]) => `${esc(labels[k] || k)}: ${r.match.metadata_keys.includes(k) ? highlight(v, q) : esc(v)}`).join(", ");
      return `<div class="result">
        <a class="title" href="#/documents/${r.id}">${highlight(r.title, q)}</a>
        <div class="small muted">${highlight(r.filename, q)} · ${esc(r.owner_name || "—")} · ${formatDate(r.created_at)}</div>
        ${r.match.snippet ? `<div class="snippet">${highlight(r.match.snippet, q)}</div>` : ""}
        ${meta ? `<div class="small" style="margin-top:8px">${meta}</div>` : ""}
        <div class="chips">${r.match.fields.map((f) => `<span class="chip ${f === "content" ? "chip-ocr" : f === "metadata" ? "chip-meta" : ""}">${MATCH[f] || esc(f)} match</span>`).join("")}</div>
      </div>`;
    }).join("");
  }
  onChip = () => { sync(); draw(); };
  const sync = () => history.replaceState(null, "", `#/search?${new URLSearchParams({ q, ...(where !== "all" ? { in: where } : {}), ...(type ? { type } : {}) })}`);
  draw();
}

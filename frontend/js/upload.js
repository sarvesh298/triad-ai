/** Upload dialog: choose or drop files, add metadata, upload with progress, show the OCR result. */
import { api } from "./api.js";
import { state, events, loadFields } from "./state.js";
import { $, $$, esc, formatBytes, openModal, notify } from "./ui.js";

const ALLOWED = [".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"];
const MAX_BYTES = 20 * 1024 * 1024; // backend default MAX_CONTENT_LENGTH
const extOf = (name) => (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();

function metadataInputs(fields) {
  if (!fields.length) {
    return `<div id="kv-host"></div><button type="button" class="btn btn-sm" id="kv-add">Add field</button>`;
  }
  return `<div class="form-row">${fields.map((f) => {
    const id = `m-${f.key.replace(/\W+/g, "_")}`;
    const control = f.type === "select"
      ? `<select class="select" id="${id}" data-meta="${esc(f.key)}"><option value=""></option>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`
      : `<input class="input" id="${id}" data-meta="${esc(f.key)}" type="${f.type === "date" ? "date" : "text"}">`;
    return `<div class="field" data-mfield data-required="${f.required}"><label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>${control}</div>`;
  }).join("")}</div>`;
}

const kvRow = () => `<div class="kv-row"><input class="input" data-k placeholder="Field"><input class="input" data-v placeholder="Value"><button type="button" class="icon-btn" data-kv-remove aria-label="Remove">×</button></div>`;

export async function openUploadModal() {
  let fields = state.fields;
  try { fields = await loadFields(); } catch { /* cached */ }

  const { el, close } = openModal({
    title: "Upload documents",
    wide: true,
    body: `
      <label class="dropzone" id="drop"><input type="file" id="file-input" multiple accept="${ALLOWED.join(",")}">
        Drop files here or <span style="color:var(--accent)">browse</span><div class="small">PDF, PNG, JPG or TIFF, up to 20 MB each</div></label>
      <div class="queue" id="queue"></div>
      <div class="field" style="margin-top:14px"><label for="up-title">Title</label>
        <input class="input" id="up-title" placeholder="Defaults to the file name"><span class="hint" id="title-hint"></span></div>
      <div class="subhead">Metadata</div>
      <div id="meta-host">${metadataInputs(fields)}</div>
      <p class="hint" style="margin-top:10px">Files are added to ${esc(state.user.division)}.</p>
      <div id="up-error" style="margin-top:10px"></div>`,
    footer: `<button class="btn" id="up-cancel">Cancel</button><button class="btn btn-primary" id="up-go" disabled>Upload</button>`,
  });

  const files = [];
  let busy = false;
  let finished = false;
  let current = null;
  const queue = $("#queue", el);
  const go = $("#up-go", el);
  const drop = $("#drop", el);
  const kvHost = $("#kv-host", el);

  if (kvHost) {
    kvHost.insertAdjacentHTML("beforeend", kvRow());
    $("#kv-add", el).onclick = () => kvHost.insertAdjacentHTML("beforeend", kvRow());
    kvHost.addEventListener("click", (e) => { if (e.target.closest("[data-kv-remove]")) e.target.closest(".kv-row").remove(); });
  }

  function draw() {
    queue.innerHTML = files.map((f, i) => `<div class="qitem" data-i="${i}">
      <div class="top"><span class="truncate" style="flex:1">${esc(f.file.name)}</span>
        <span class="small muted" data-status>${f.error ? `<span style="color:var(--danger)">${esc(f.error)}</span>` : formatBytes(f.file.size)}</span>
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(f.file.name)}" style="width:24px;height:24px">×</button></div>
      <div class="progress hidden" data-bar><i></i></div>
    </div>`).join("");
    const valid = files.filter((f) => !f.error).length;
    go.disabled = !valid;
    go.textContent = valid > 1 ? `Upload ${valid} files` : "Upload";
    $("#up-title", el).disabled = valid > 1;
    $("#title-hint", el).textContent = valid > 1 ? "Each file uses its file name as the title." : "";
  }

  function add(list) {
    if (busy || finished) return;
    [...list].forEach((file) => {
      let error = "";
      if (!ALLOWED.includes(extOf(file.name))) error = "Unsupported file type";
      else if (file.size > MAX_BYTES) error = "Larger than 20 MB";
      else if (!file.size) error = "Empty file";
      files.push({ file, error });
    });
    draw();
  }

  $("#file-input", el).onchange = (e) => { add(e.target.files); e.target.value = ""; };
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => add(e.dataTransfer.files));
  queue.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (b && !busy) { files.splice(Number(b.dataset.remove), 1); draw(); }
    if (e.target.closest("a")) close();
  });
  el.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("invalid"));

  function collect() {
    const metadata = {};
    const errors = [];
    if (kvHost) {
      $$(".kv-row", kvHost).forEach((row) => {
        const k = row.querySelector("[data-k]").value.trim();
        const v = row.querySelector("[data-v]").value.trim();
        if (k && v) metadata[k] = v;
        else if (k || v) errors.push("Each metadata row needs a field and a value.");
      });
    } else {
      $$("[data-mfield]", el).forEach((wrap) => {
        const input = wrap.querySelector("[data-meta]");
        const v = input.value.trim();
        if (v) metadata[input.dataset.meta] = v;
        else if (wrap.dataset.required === "true") {
          wrap.classList.add("invalid");
          errors.push(`${wrap.querySelector("label").textContent.replace("*", "").trim()} is required.`);
        }
      });
    }
    return { metadata, errors: [...new Set(errors)] };
  }

  function setRow(i, { status, progress, mode }) {
    const row = queue.querySelector(`[data-i="${i}"]`);
    if (!row) return;
    if (status !== undefined) row.querySelector("[data-status]").innerHTML = status;
    const bar = row.querySelector("[data-bar]");
    bar.className = `progress ${mode || ""}`;
    if (progress !== undefined) bar.querySelector("i").style.width = `${Math.round(progress * 100)}%`;
  }

  async function start() {
    const errBox = $("#up-error", el);
    errBox.innerHTML = "";
    const { metadata, errors } = collect();
    if (errors.length) { errBox.innerHTML = `<div class="alert alert-error">${errors.map(esc).join("<br>")}</div>`; return; }
    busy = true;
    go.classList.add("loading");
    go.disabled = true;
    queue.querySelectorAll("[data-remove]").forEach((b) => b.classList.add("hidden"));
    $$("input, select", $("#meta-host", el)).forEach((i) => (i.disabled = true));
    const title = files.filter((f) => !f.error).length === 1 ? $("#up-title", el).value.trim() : "";

    let ok = 0;
    let failed = 0;
    for (const [i, item] of files.entries()) {
      if (item.error) continue;
      setRow(i, { status: "Uploading 0%", progress: 0 });
      current = api.uploadFile(item.file, { title, metadata }, (p, phase) => {
        if (phase === "processing") setRow(i, { status: "Running OCR…", mode: "busy" });
        else setRow(i, { status: `Uploading ${Math.round(p * 100)}%`, progress: p });
      });
      try {
        const res = await current.promise;
        ok += 1;
        const ocr = res.ocr_status === "failed" ? `OCR failed: ${esc(res.ocr_error || "unknown error")}`
          : res.ocr_status === "no_text" ? "No text found" : `${res.ocr_characters.toLocaleString()} characters extracted`;
        setRow(i, { status: `Done · ${ocr} · <a href="#/documents/${res.document_id}">Open</a>`, progress: 1, mode: "done" });
      } catch (err) {
        if (err.status === -1) { setRow(i, { status: "Cancelled", progress: 0, mode: "fail" }); break; }
        failed += 1;
        setRow(i, { status: `<span style="color:var(--danger)">${esc(err.message)}</span>`, progress: 1, mode: "fail" });
        if (err.status === 401) break;
      }
    }
    current = null;
    busy = false;
    finished = true;
    go.classList.remove("loading");
    go.disabled = false;
    go.textContent = "Close";
    $("#up-cancel", el).classList.add("hidden");
    if (ok) {
      events.emit("documents:changed");
      notify.success(ok === 1 ? "Document uploaded" : `${ok} documents uploaded`, failed ? `${failed} failed` : "");
    } else if (failed) {
      notify.error("Upload failed");
    }
  }

  go.onclick = () => (finished ? close() : start());
  $("#up-cancel", el).onclick = () => (busy && current ? current.abort() : close());
  draw();
}

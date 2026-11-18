/** Document actions shared by several views. */
import { api } from "./api.js";
import { events } from "./state.js";
import { notify, saveBlob, setLoading, confirmDialog, esc } from "./ui.js";

export async function downloadDocument(id, fallbackName, button) {
  setLoading(button, true);
  try {
    const { blob, filename } = await api.fetchFile(id);
    saveBlob(blob, filename || fallbackName);
    notify.success("Download started", filename || fallbackName);
  } catch (err) {
    notify.error("Download failed", err.message);
  } finally {
    setLoading(button, false);
  }
}

/** Ask for confirmation, then send a cross-division access request. Returns the API response or null. */
export async function requestDocumentAccess(doc, button) {
  const ok = await confirmDialog({
    title: "Request access?",
    message: `Your request for <b>${esc(doc.title)}</b> will be sent to <b>${esc(doc.division)}</b>. A member of that division must approve it before you can download the file.`,
    confirmText: "Send request",
    iconName: "send",
  });
  if (!ok) return null;
  setLoading(button, true);
  try {
    const res = await api.requestAccess(doc.id);
    notify.success(res.status === "approved" ? "You already have access" : "Request sent", res.message);
    events.emit("requests:changed");
    return res;
  } catch (err) {
    notify.error("Couldn't send request", err.message);
    return null;
  } finally {
    setLoading(button, false);
  }
}

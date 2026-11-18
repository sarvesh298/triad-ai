/** Session-wide state and a tiny event bus shared by the views. */
import { api } from "./api.js";

export const state = {
  user: null,
  fields: [],          // active metadata field definitions
  fieldsLoaded: false,
};

const bus = new EventTarget();

export const events = {
  on(name, fn) {
    const handler = (e) => fn(e.detail);
    bus.addEventListener(name, handler);
    return () => bus.removeEventListener(name, handler);
  },
  emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); },
};

export const isAdmin = () => state.user?.role === "admin";

export async function loadFields(force = false) {
  if (state.fieldsLoaded && !force) return state.fields;
  const { fields } = await api.fields();
  state.fields = fields;
  state.fieldsLoaded = true;
  return fields;
}

/** key → display label for metadata fields (falls back to the key itself). */
export function fieldLabels() {
  return Object.fromEntries(state.fields.map((f) => [f.key, f.label || f.key]));
}

export function resetState() {
  state.user = null;
  state.fields = [];
  state.fieldsLoaded = false;
}

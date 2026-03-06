/* ─── Simple in-memory item cache for navigation transitions ──────
   When a MediaCard navigates to /media/[id], the full item is stored
   here so the detail page can display data instantly while fetching
   fresh data from the API.
   ────────────────────────────────────────────────────────────────── */

const _store = new Map();

export function setItemCache(id, item) {
  if (id) _store.set(String(id), item);
}

export function getItemCache(id) {
  return _store.get(String(id)) || null;
}

export function clearItemCache(id) {
  if (id) _store.delete(String(id));
}

/* =================================================================
   DagzFlix - API Layer with Client-Side Cache
   ================================================================= */

const apiCache = new Map();

const CACHE_TTLS = {
  'setup/check': 120000,
  'auth/session': 60000,
  'media/library': 300000,
  'media/genres': 600000,
  'media/detail': 600000,
  'media/seasons': 600000,
  'media/episodes': 600000,
  'media/trailer': 3600000,
  'media/collection': 3600000,
  'media/status': 60000,
  'media/resume': 300000,
  'media/rating': 30000,
  'search': 120000,
  'discover': 300000,
  'recommendations': 300000,
  'wizard': 120000,
  'admin/users': 15000,
  'telemetry': 0,
};

function getCacheTTL(path) {
  for (const [key, ttl] of Object.entries(CACHE_TTLS)) {
    if (path.startsWith(key)) return ttl;
  }
  return 60000;
}

export async function api(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // V7.8: Si le backend renvoie 401 sur un endpoint non-auth, token Jellyfin expiré → forcer re-login
    if (res.status === 401 && !path.startsWith('auth/')) {
      console.warn('[API] 401 reçu — token expiré, re-login nécessaire');
      window.dispatchEvent(new CustomEvent('dagzflix:session-expired'));
    }
    const message = payload?.error || payload?.message || `API ${path} failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function cachedApi(path, options = {}) {
  const isGet = !options.method || options.method === 'GET';
  if (isGet) {
    const cached = apiCache.get(path);
    if (cached && Date.now() - cached.ts < getCacheTTL(path)) return cached.data;
  }
  const data = await api(path, options);
  if (isGet && data && !data.error) apiCache.set(path, { data, ts: Date.now() });
  return data;
}

export function invalidateCache(prefix) {
  for (const key of apiCache.keys()) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
}

export function clearCache() {
  apiCache.clear();
}

/* =================================================================
   DagzFlix - API Layer with Client-Side Cache + SessionStorage
   V0.009 : Double couche Map + sessionStorage pour survie Back/Forward/F5
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
  'admin/telemetry': 15000,
  'telemetry': 0,
};

/**
 * Résout le TTL de cache pour un chemin API donné.
 * @param {string} path - Chemin API (ex: 'media/detail')
 * @returns {number} TTL en millisecondes
 */
function getCacheTTL(path) {
  for (const [key, ttl] of Object.entries(CACHE_TTLS)) {
    if (path.startsWith(key)) return ttl;
  }
  return 60000;
}

// ═══ SessionStorage helpers (couche 2 du cache) ═══

/**
 * Lit un item de sessionStorage avec vérification de TTL.
 * Survit aux navigations Back/Forward et aux F5 (soft reload).
 * @param {string} path - Clé API
 * @returns {Object|null} Données cachées ou null si expirée/absente
 */
function readSessionCache(path) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    const raw = sessionStorage.getItem(`dagz_${path}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > getCacheTTL(path)) {
      sessionStorage.removeItem(`dagz_${path}`);
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * Écrit un item dans sessionStorage (fire & forget).
 * Ignore silencieusement les erreurs (quota dépassé, SSR, etc.).
 * @param {string} path - Clé API
 * @param {Object} data - Données à cacher
 */
function writeSessionCache(path, data) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    sessionStorage.setItem(`dagz_${path}`, JSON.stringify({ data, ts: Date.now() }));
  } catch (_) {
    // sessionStorage plein → ignorer silencieusement
  }
}

/**
 * Appel API brut vers le BFF Next.js.
 * Gère la détection de tokens expirés (401) et dispatche un événement
 * `dagzflix:session-expired` pour forcer le re-login côté frontend.
 * @param {string} path - Chemin relatif (ex: 'media/library')
 * @param {Object} [options={}] - Options fetch (method, body, headers…)
 * @returns {Promise<Object>} Payload JSON de la réponse
 * @throws {Error} Si la réponse n'est pas OK (status >= 400)
 */
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

/**
 * Appel API avec cache double couche :
 *  1. Map en mémoire (rapide, perdue au rechargement)
 *  2. sessionStorage (persiste entre navigations Back/Forward et F5)
 *
 * Le cache n'est utilisé que pour les requêtes GET.
 * @param {string} path - Chemin API
 * @param {Object} [options={}] - Options fetch
 * @returns {Promise<Object>} Payload JSON (depuis cache ou réseau)
 */
export async function cachedApi(path, options = {}) {
  const isGet = !options.method || options.method === 'GET';
  if (isGet) {
    // 1) Cache mémoire (Map) — le plus rapide
    const memCached = apiCache.get(path);
    if (memCached && Date.now() - memCached.ts < getCacheTTL(path)) return memCached.data;

    // 2) Fallback sessionStorage — survit aux navigations Back/Forward et F5
    const sessionCached = readSessionCache(path);
    if (sessionCached) {
      // Réhydrater le cache mémoire pour les appels suivants
      apiCache.set(path, { data: sessionCached, ts: Date.now() });
      return sessionCached;
    }
  }
  const data = await api(path, options);
  if (isGet && data && !data.error) {
    apiCache.set(path, { data, ts: Date.now() });
    writeSessionCache(path, data);
  }
  return data;
}

/**
 * Invalide le cache (Map + sessionStorage) pour un préfixe donné.
 * Ex: invalidateCache('media/') supprime 'media/library', 'media/detail', etc.
 * @param {string} prefix - Préfixe de chemin API
 */
export function invalidateCache(prefix) {
  for (const key of apiCache.keys()) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(`dagz_${prefix}`)) sessionStorage.removeItem(key);
      }
    }
  } catch (_) { /* ignore */ }
}

/**
 * Vide intégralement le cache (Map + sessionStorage).
 * Appelé typiquement lors du logout.
 */
export function clearCache() {
  apiCache.clear();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('dagz_')) sessionStorage.removeItem(key);
      }
    }
  } catch (_) { /* ignore */ }
}

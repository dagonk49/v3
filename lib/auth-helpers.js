/**
 * lib/auth-helpers.js — Authentification & Session
 *
 * getSession (avec cache de validation token Jellyfin),
 * requireAdmin (garde RBAC),
 * jellyfinAuthHeader.
 */
import { getDb } from './db';
import { jsonResponse, getConfig } from './api-utils';

// Cache de validation des tokens Jellyfin (évite de re-valider à chaque requête)
const jellyfinTokenValidationCache = new Map();
const TOKEN_VALIDATION_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Construit le header X-Emby-Authorization pour les appels Jellyfin.
 * @param {string} [token] - Jeton d'authentification Jellyfin (optionnel)
 * @returns {string} Valeur complète du header MediaBrowser
 */
export function jellyfinAuthHeader(token) {
  const base = 'MediaBrowser Client="DagzFlix", Device="Web", DeviceId="dagzflix-web", Version="1.0"';
  return token ? `${base}, Token="${token}"` : base;
}

/**
 * Valide et retourne la session active depuis le cookie `dagzflix_session`.
 * Supprime automatiquement les sessions expirées.
 * @param {Request} req - Requête entrante (avec cookies)
 * @returns {Promise<Object|null>} Session {userId, jellyfinToken, jellyfinUserId, username} ou null
 */
export async function getSession(req) {
  try {
    const sessionId = req.cookies.get('dagzflix_session')?.value;
    if (!sessionId) return null;

    let db;
    try {
      db = await getDb();
    } catch (dbErr) {
      console.error('[getSession] MongoDB indisponible — session impossible:', dbErr.message);
      return null;
    }

    let session;
    try {
      session = await db.collection('sessions').findOne({ _id: sessionId });
    } catch (findErr) {
      console.error('[getSession] findOne failed:', findErr.message);
      return null;
    }
    if (!session) return null;

    if (new Date(session.expiresAt) < new Date()) {
      try { await db.collection('sessions').deleteOne({ _id: sessionId }); } catch (_) { /* non-blocking */ }
      return null;
    }

    // V7.8: Valider le token Jellyfin (cache 5 min pour éviter le spam)
    const cacheKey = `${session.jellyfinUserId}_${session.jellyfinToken}`;
    const cached = jellyfinTokenValidationCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TOKEN_VALIDATION_TTL) {
      if (!cached.valid) {
        // Token invalidé lors d'une vérification récente → purger la session
        try { await db.collection('sessions').deleteOne({ _id: sessionId }); } catch (_) { /* non-blocking */ }
        return null;
      }
      return session;
    }

    // Vérification réelle contre Jellyfin
    try {
      const config = await getConfig();
      if (config?.jellyfinUrl && session.jellyfinToken) {
        const checkRes = await fetch(
          `${config.jellyfinUrl}/Users/${session.jellyfinUserId}`,
          {
            headers: { 'X-Emby-Token': session.jellyfinToken },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (checkRes.status === 401) {
          console.warn(`[getSession] Token Jellyfin expiré pour ${session.username} — session invalidée`);
          jellyfinTokenValidationCache.set(cacheKey, { valid: false, ts: Date.now() });
          try { await db.collection('sessions').deleteOne({ _id: sessionId }); } catch (_) { /* non-blocking */ }
          return null;
        }
        jellyfinTokenValidationCache.set(cacheKey, { valid: true, ts: Date.now() });
      }
    } catch (err) {
      // Réseau down → on laisse passer (on ne veut pas bloquer si Jellyfin est temporairement indisponible)
      console.warn('[getSession] Token validation failed (network):', err.message);
    }

    return session;
  } catch (fatalErr) {
    // Dernière barrière : ne JAMAIS crasher le route handler à cause de getSession
    console.error('[getSession] FATAL — retour null par sécurité:', fatalErr.message);
    return null;
  }
}

/**
 * Garde RBAC centralisé : vérifie que la session existe ET que l'utilisateur
 * possède le rôle admin en interrogeant la base de données.
 * @param {Request} req - Requête entrante (avec cookies)
 * @returns {Promise<{session?: Object, profile?: Object, error?: NextResponse}>}
 *   - Si autorisé : {session, profile}
 *   - Si refusé : {error: NextResponse} à retourner immédiatement
 */
export async function requireAdmin(req) {
  const session = await getSession(req);
  if (!session) {
    return { error: jsonResponse({ error: 'Non authentifié' }, 401) };
  }
  const db = await getDb();
  const profile = await db.collection('users').findOne({ userId: session.userId });
  if (!profile || profile.role !== 'admin') {
    return { error: jsonResponse({ error: 'Accès réservé aux administrateurs' }, 403) };
  }
  return { session, profile };
}

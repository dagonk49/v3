/**
 * controllers/auth.controller.js — Authentification & Setup
 *
 * handleAuthLogin, handleAuthLogout, handleAuthSession,
 * handleSetupCheck, handleSetupTest, handleSetupSave.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { jsonResponse, getConfig } from '@/lib/api-utils';
import { getSession, jellyfinAuthHeader } from '@/lib/auth-helpers';
import { getUserProfile } from '@/lib/media-mappers';

/**
 * GET /api/setup/check
 * Vérifie l'état de la configuration initiale de DagzFlix.
 * @returns {Object} {setupComplete, jellyfinConfigured, jellyseerrConfigured}
 */
export async function handleSetupCheck() {
  try {
    const config = await getConfig();
    return jsonResponse({
      setupComplete: !!config?.setupComplete,
      jellyfinConfigured: !!config?.jellyfinUrl,
      jellyseerrConfigured: !!config?.jellyseerrUrl,
    });
  } catch (err) {
    return jsonResponse({
      setupComplete: false,
      jellyfinConfigured: false,
      jellyseerrConfigured: false,
      error: err.message,
    });
  }
}

/**
 * POST /api/setup/test
 * Teste la connexion à un serveur Jellyfin ou Jellyseerr.
 * @param {Request} req - Body JSON {type: 'jellyfin'|'jellyseerr', url, apiKey}
 * @returns {Object} {success, serverName?, version?}
 */
export async function handleSetupTest(req) {
  const { type, url, apiKey } = await req.json();
  if (!type || !url) return jsonResponse({ success: false, error: 'Type et URL requis' }, 400);

  if (type === 'jellyfin') {
    const res = await fetch(`${url}/System/Info/Public`, {
      headers: { 'X-Emby-Token': apiKey || '' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Jellyfin responded with ${res.status}`);
    const data = await res.json();
    return jsonResponse({ success: true, serverName: data.ServerName, version: data.Version });
  }

  if (type === 'jellyseerr') {
    const res = await fetch(`${url}/api/v1/status`, {
      headers: { 'X-Api-Key': apiKey || '' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Jellyseerr responded with ${res.status}`);
    const data = await res.json();
    return jsonResponse({ success: true, version: data.version });
  }

  return jsonResponse({ success: false, error: 'Type invalide' }, 400);
}

/**
 * POST /api/setup/save
 * Sauvegarde la configuration des serveurs Jellyfin et Jellyseerr dans MongoDB.
 * @param {Request} req - Body JSON {jellyfinUrl, jellyfinApiKey, jellyseerrUrl?, jellyseerrApiKey?}
 * @returns {Object} {success, message}
 */
export async function handleSetupSave(req) {
  const { jellyfinUrl, jellyfinApiKey, jellyseerrUrl, jellyseerrApiKey } = await req.json();
  if (!jellyfinUrl) return jsonResponse({ success: false, error: 'URL Jellyfin requise' }, 400);

  const db = await getDb();
  await db.collection('config').updateOne(
    { _id: 'main' },
    {
      $set: {
        jellyfinUrl: jellyfinUrl.replace(/\/$/, ''),
        jellyfinApiKey: jellyfinApiKey || '',
        jellyseerrUrl: (jellyseerrUrl || '').replace(/\/$/, ''),
        jellyseerrApiKey: jellyseerrApiKey || '',
        setupComplete: true,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return jsonResponse({ success: true, message: 'Configuration sauvegardee' });
}

/**
 * POST /api/auth/login
 * Authentifie l'utilisateur via Jellyfin (AuthenticateByName), crée une session MongoDB.
 * Pose le cookie `dagzflix_session` (httpOnly, 7 jours).
 * @param {Request} req - Body JSON {username, password}
 * @returns {Object} {success, user: {id, name}, onboardingComplete}
 */
export async function handleAuthLogin(req) {
  try {
    const { username, password } = await req.json();
    if (!username || password === undefined) return jsonResponse({ success: false, error: 'Identifiants requis' }, 400);

    const config = await getConfig();
    if (!config?.jellyfinUrl) return jsonResponse({ success: false, error: 'Serveur non configure' }, 400);

    const jellyfinRes = await fetch(`${config.jellyfinUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': jellyfinAuthHeader(),
      },
      body: JSON.stringify({ Username: username, Pw: password }),
      signal: AbortSignal.timeout(30000),
    });

    if (!jellyfinRes.ok) {
      if (jellyfinRes.status === 401 || jellyfinRes.status === 403) {
        return jsonResponse({ success: false, error: 'Identifiants incorrects' }, 401);
      }
      const errBody = await jellyfinRes.text().catch(() => '');
      console.error(`[handleAuthLogin] Jellyfin ${jellyfinRes.status}: ${errBody.substring(0, 200)}`);
      return jsonResponse({ success: false, error: 'Le serveur Jellyfin a rencontré une erreur. Réessayez dans quelques minutes.' }, 502);
    }

    const authData = await jellyfinRes.json();
    const userId = authData.User?.Id;
    const accessToken = authData.AccessToken;
    const displayName = authData.User?.Name || username;

    const sessionId = uuidv4();
    const db = await getDb();
    await db.collection('sessions').insertOne({
      _id: sessionId,
      userId,
      jellyfinToken: accessToken,
      jellyfinUserId: userId,
      username: displayName,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // ── Upsert user profile (rôle par défaut : adult) ──
    await db.collection('users').updateOne(
      { userId },
      { $setOnInsert: { userId, username: displayName, role: 'adult', maxRating: '', createdAt: new Date() }, $set: { lastLogin: new Date() } },
      { upsert: true }
    );
    const userProfile = await db.collection('users').findOne({ userId });

    const prefs = await db.collection('preferences').findOne({ userId });
    const response = jsonResponse({
      success: true,
      user: { id: userId, name: displayName, role: userProfile?.role || 'adult' },
      onboardingComplete: !!prefs?.onboardingComplete,
    });

    response.cookies.set('dagzflix_session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[handleAuthLogin] ERREUR:', err.message, err.stack?.split('\n').slice(0, 5).join(' | '));
    return jsonResponse({ success: false, error: err.message || 'Erreur interne' }, 500);
  }
}

/**
 * POST /api/auth/logout
 * Détruit la session MongoDB et supprime le cookie `dagzflix_session`.
 * @param {Request} req
 * @returns {Object} {success: true}
 */
export async function handleAuthLogout(req) {
  const sessionId = req.cookies.get('dagzflix_session')?.value;
  if (sessionId) {
    const db = await getDb();
    await db.collection('sessions').deleteOne({ _id: sessionId });
  }
  const response = jsonResponse({ success: true });
  response.cookies.set('dagzflix_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  return response;
}

/**
 * GET /api/auth/session
 * Retourne l'état de la session courante et si l'onboarding est complété.
 * @param {Request} req
 * @returns {Object} {authenticated, user?, onboardingComplete?}
 */
export async function handleAuthSession(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ authenticated: false });

  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId });
  const userProfile = await getUserProfile(session.userId);

  return jsonResponse({
    authenticated: true,
    user: {
      id: session.userId,
      name: session.username,
      jellyfinUserId: session.jellyfinUserId,
      role: userProfile?.role || 'adult',
    },
    onboardingComplete: !!prefs?.onboardingComplete,
  });
}

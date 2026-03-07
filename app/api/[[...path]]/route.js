/**
 * app/api/[[...path]]/route.js — Aiguilleur principal (router)
 *
 * Ce fichier ne contient AUCUNE logique métier.
 * Il dispatche chaque requête vers le bon controller.
 *
 * Architecture :
 *   lib/db.js            → MongoDB pool + Zod schemas
 *   lib/api-utils.js     → jsonResponse, validateOrigin, getConfig
 *   lib/auth-helpers.js  → getSession, requireAdmin, jellyfinAuthHeader
 *   lib/media-mappers.js → mapTmdbItem, mapJellyfinItem, resolveGenres, ...
 *   lib/dagzrank.js      → calculateDagzRank, loadTelemetryData, applyParentalFilter
 *
 *   controllers/auth.controller.js      → setup + auth handlers
 *   controllers/admin.controller.js     → admin handlers
 *   controllers/media.controller.js     → media detail, stream, status, episodes, proxy, ...
 *   controllers/discovery.controller.js → search, discover, recommendations, wizard discover
 *   controllers/user.controller.js      → favorites, preferences, telemetry, rate, wizard feedback
 */
import { NextResponse } from 'next/server';
import { jsonResponse, validateOrigin, ALLOWED_ORIGIN } from '@/lib/api-utils';

// ── Auth & Setup ──
import {
  handleSetupCheck,
  handleSetupTest,
  handleSetupSave,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthSession,
} from './controllers/auth.controller';

// ── Admin ──
import {
  handleAdminUsers,
  handleAdminUsersUpdate,
  handleAdminTelemetry,
  handleAdminUserStats,
} from './controllers/admin.controller';

// ── Media ──
import {
  handleMediaLibrary,
  handleMediaGenres,
  handleMediaDetail,
  handleMediaResume,
  handleMediaSeasons,
  handleMediaEpisodes,
  handleMediaTrailer,
  handleMediaCollection,
  handleMediaStatus,
  handleStream,
  handleNextEpisode,
  handlePersonDetail,
  handleMediaRequest,
  handleMediaProgress,
  handleProxyImage,
  handleProxyTmdb,
} from './controllers/media.controller';

// ── Discovery ──
import {
  handleSearch,
  handleDiscover,
  handleRecommendations,
  handleWizardDiscover,
} from './controllers/discovery.controller';

// ── User (favorites, preferences, telemetry, ratings, wizard feedback) ──
import {
  handleMediaFavoriteToggle,
  handleMediaFavoritesGet,
  handlePreferencesGet,
  handlePreferencesSave,
  handleTelemetryClick,
  handleMediaRate,
  handleMediaRatingGet,
  handleWizardFeedback,
} from './controllers/user.controller';

// ════════════════════════════════════════════════════════════════════════════
// ██  ROUTER
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extrait les segments de chemin depuis l'URL de la requête.
 * Ex: /api/media/detail → ['media', 'detail']
 */
function getPathParts(req) {
  return new URL(req.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

/**
 * Routeur principal GET — dispatche vers le bon handler selon le chemin.
 */
async function routeGet(parts, req) {
  const route = parts.join('/');

  if (route === 'setup/check') return handleSetupCheck(req);
  if (route === 'auth/session') return handleAuthSession(req);
  if (route === 'preferences') return handlePreferencesGet(req);

  if (route === 'media/library') return handleMediaLibrary(req);
  if (route === 'media/genres') return handleMediaGenres(req);
  if (route === 'media/favorites') return handleMediaFavoritesGet(req);
  if (route === 'media/detail') return handleMediaDetail(req);
  if (route === 'media/resume') return handleMediaResume(req);
  if (route === 'media/seasons') return handleMediaSeasons(req);
  if (route === 'media/episodes') return handleMediaEpisodes(req);
  if (route === 'media/trailer') return handleMediaTrailer(req);
  if (route === 'media/collection') return handleMediaCollection(req);
  if (route === 'media/status') return handleMediaStatus(req);
  if (route === 'media/stream') return handleStream(req);
  if (route === 'media/rating') return handleMediaRatingGet(req);
  if (route === 'media/next-episode') return handleNextEpisode(req);

  if (route === 'person/detail') return handlePersonDetail(req);

  if (route === 'search') return handleSearch(req);
  if (route === 'discover') return handleDiscover(req);
  if (route === 'recommendations') return handleRecommendations(req);

  if (route === 'admin/users') return handleAdminUsers(req);
  if (route === 'admin/telemetry') return handleAdminTelemetry(req);
  if (route === 'admin/user-stats') return handleAdminUserStats(req);

  if (route === 'proxy/image') return handleProxyImage(req);
  if (route === 'proxy/tmdb') return handleProxyTmdb(req);

  return jsonResponse({ error: `Route GET inconnue: /api/${route}` }, 404);
}

/**
 * Routeur principal POST — dispatche vers le bon handler selon le chemin.
 */
async function routePost(parts, req) {
  const route = parts.join('/');

  if (route === 'setup/test') return handleSetupTest(req);
  if (route === 'setup/save') return handleSetupSave(req);

  if (route === 'auth/login') return handleAuthLogin(req);
  if (route === 'auth/logout') return handleAuthLogout(req);

  if (route === 'preferences') return handlePreferencesSave(req);
  if (route === 'media/favorite') return handleMediaFavoriteToggle(req);
  if (route === 'media/request') return handleMediaRequest(req);
  if (route === 'media/progress') return handleMediaProgress(req);
  if (route === 'media/rate') return handleMediaRate(req);
  if (route === 'telemetry/click') return handleTelemetryClick(req);
  if (route === 'admin/users/update') return handleAdminUsersUpdate(req);
  if (route === 'wizard/discover') return handleWizardDiscover(req);
  if (route === 'wizard/feedback') return handleWizardFeedback(req);

  return jsonResponse({ error: `Route POST inconnue: /api/${route}` }, 404);
}

// ════════════════════════════════════════════════════════════════════════════
// ██  EXPORTS Next.js App Router
// ════════════════════════════════════════════════════════════════════════════

export async function GET(req) {
  try {
    return await routeGet(getPathParts(req), req);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function POST(req) {
  try {
    return await routePost(getPathParts(req), req);
  } catch (err) {
    console.error('[POST FATAL]', getPathParts(req), err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function OPTIONS(req) {
  const origin = req.headers.get('origin') || '';
  const validatedOrigin = validateOrigin(origin);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (validatedOrigin) {
    headers['Access-Control-Allow-Origin'] = validatedOrigin;
  }
  return new NextResponse(null, { status: 204, headers });
}

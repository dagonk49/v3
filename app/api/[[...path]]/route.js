import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

const MONGO_URL = process.env.MONGO_URL;
const DB_NAME = process.env.DB_NAME || 'dagzflix';

let cachedClient = null;
let cachedDb = null;

const TMDB_GENRE_ID_TO_NAME = {
  12: 'Adventure',
  14: 'Fantasy',
  16: 'Animation',
  18: 'Drama',
  27: 'Horror',
  28: 'Action',
  35: 'Comedy',
  36: 'History',
  37: 'Western',
  53: 'Thriller',
  80: 'Crime',
  99: 'Documentary',
  878: 'Science Fiction',
  9648: 'Mystery',
  10402: 'Music',
  10749: 'Romance',
  10751: 'Family',
  10752: 'War',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  10770: 'TV Movie',
};

/**
 * Retourne une instance MongoDB mise en cache (singleton).
 * Crée la connexion à la première invocation, réutilise ensuite.
 * @returns {Promise<import('mongodb').Db>} Instance de la base de données
 * @throws {Error} Si MONGO_URL n'est pas défini dans les variables d'environnement
 */
async function getDb() {
  if (cachedDb) return cachedDb;
  if (!MONGO_URL) {
    throw new Error('MONGO_URL manquante');
  }
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URL);
    await cachedClient.connect();
  }
  cachedDb = cachedClient.db(DB_NAME);
  return cachedDb;
}

/**
 * Crée une NextResponse JSON avec les headers CORS pré-configurés.
 * @param {Object} data  - Corps de la réponse JSON
 * @param {number} [status=200] - Code HTTP
 * @returns {NextResponse} Réponse prête à être retournée par le handler
 */
function jsonResponse(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * Construit le header X-Emby-Authorization pour les appels Jellyfin.
 * @param {string} [token] - Jeton d'authentification Jellyfin (optionnel)
 * @returns {string} Valeur complète du header MediaBrowser
 */
function jellyfinAuthHeader(token) {
  const base = 'MediaBrowser Client="DagzFlix", Device="Web", DeviceId="dagzflix-web", Version="1.0"';
  return token ? `${base}, Token="${token}"` : base;
}

/**
 * Récupère la configuration principale de DagzFlix depuis MongoDB.
 * Document `config.main` contenant jellyfinUrl, jellyseerrUrl, clés API, etc.
 * @returns {Promise<Object|null>} Document de configuration ou null
 */
async function getConfig() {
  const db = await getDb();
  return db.collection('config').findOne({ _id: 'main' });
}

/**
 * Valide et retourne la session active depuis le cookie `dagzflix_session`.
 * Supprime automatiquement les sessions expirées.
 * @param {Request} req - Requête entrante (avec cookies)
 * @returns {Promise<Object|null>} Session {userId, jellyfinToken, jellyfinUserId, username} ou null
 */
// Cache de validation des tokens Jellyfin (évite de re-valider à chaque requête)
const jellyfinTokenValidationCache = new Map();
const TOKEN_VALIDATION_TTL = 5 * 60 * 1000; // 5 minutes

async function getSession(req) {
  const sessionId = req.cookies.get('dagzflix_session')?.value;
  if (!sessionId) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({ _id: sessionId });
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    await db.collection('sessions').deleteOne({ _id: sessionId });
    return null;
  }

  // V7.8: Valider le token Jellyfin (cache 5 min pour éviter le spam)
  const cacheKey = `${session.jellyfinUserId}_${session.jellyfinToken}`;
  const cached = jellyfinTokenValidationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TOKEN_VALIDATION_TTL) {
    if (!cached.valid) {
      // Token invalidé lors d'une vérification récente → purger la session
      await db.collection('sessions').deleteOne({ _id: sessionId });
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
        await db.collection('sessions').deleteOne({ _id: sessionId });
        return null;
      }
      jellyfinTokenValidationCache.set(cacheKey, { valid: true, ts: Date.now() });
    }
  } catch (err) {
    // Réseau down → on laisse passer (on ne veut pas bloquer si Jellyfin est temporairement indisponible)
    console.warn('[getSession] Token validation failed (network):', err.message);
  }

  return session;
}

/**
 * Résout les genres d'un item, quel que soit le format source.
 * Gère 3 cas : tableau de strings, tableau d'objets {name/Name}, ou tableau d'IDs TMDB numériques.
 * @param {Object} item - Item Jellyfin ou TMDB
 * @returns {string[]} Liste de noms de genres (ex: ['Action', 'Drama'])
 */
function resolveGenres(item) {
  const genres = item.genres || item.Genres || [];
  if (genres.length && typeof genres[0] === 'string') return genres;
  if (genres.length && typeof genres[0] === 'object') {
    return genres.map(g => g.name || g.Name).filter(Boolean);
  }
  const ids = item.genreIds || item.genre_ids || [];
  if (ids.length) {
    return ids.map(id => TMDB_GENRE_ID_TO_NAME[id]).filter(Boolean);
  }
  return [];
}

/**
 * Mappe un item TMDB/Jellyseerr vers le format unifié DagzFlix.
 * Gère les deux conventions de nommage : camelCase (Jellyseerr) et snake_case (TMDB brut).
 * @param {Object} item - Item brut depuis l'API Jellyseerr ou TMDB
 * @param {boolean|null} [forceTv=null] - Forcer le type TV (true) ou Movie (false). Si null, détecté via mediaType.
 * @returns {Object} Item normalisé {id, tmdbId, name, type:'Movie'|'Series', posterUrl, genres, dagzRank...}
 */
function mapTmdbItem(item, forceTv = null) {
  const isTv = forceTv ?? (item.mediaType === 'tv' || item.media_type === 'tv');
  const genreIds = item.genreIds || item.genre_ids || [];
  const posterPath = item.posterPath || item.poster_path || '';
  const backdropPath = item.backdropPath || item.backdrop_path || '';
  const releaseDate = item.releaseDate || item.release_date || '';
  const firstAirDate = item.firstAirDate || item.first_air_date || '';
  const voteAverage = item.voteAverage || item.vote_average || 0;
  return {
    id: item.id,
    tmdbId: item.id,
    name: item.title || item.name || '',
    type: isTv ? 'Series' : 'Movie',
    mediaType: isTv ? 'tv' : 'movie',
    overview: item.overview || '',
    posterUrl: posterPath ? `/api/proxy/tmdb?path=${posterPath}&width=w400` : '',
    backdropUrl: backdropPath ? `/api/proxy/tmdb?path=${backdropPath}&width=w1280` : '',
    year: (releaseDate || firstAirDate).substring(0, 4),
    voteAverage,
    communityRating: voteAverage,
    genreIds,
    genres: genreIds.map(id => TMDB_GENRE_ID_TO_NAME[id]).filter(Boolean),
    // V7.6: Cap at 4 — only cross-reference code (isLocal) may set 5
    mediaStatus: Math.min(item.mediaInfo?.status || 0, 4),
  };
}

/**
 * Mappe un item Jellyfin vers le format unifié DagzFlix.
 * Convertit les champs PascalCase Jellyfin en camelCase, génère les URLs proxy pour les images.
 * @param {Object} item - Item brut depuis l'API Jellyfin (/Users/{id}/Items)
 * @returns {Object} Item normalisé {id, name, type, posterUrl, genres, studios...}
 */
function mapJellyfinItem(item) {
  const tmdbId = extractTmdbId(item.ProviderIds || {});
  return {
    id: item.Id,
    name: item.Name,
    type: item.Type,
    overview: item.Overview || '',
    genres: item.Genres || [],
    communityRating: item.CommunityRating || 0,
    officialRating: item.OfficialRating || '',
    premiereDate: item.PremiereDate || '',
    year: item.ProductionYear || '',
    runtime: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : 0,
    posterUrl: `/api/proxy/image?itemId=${item.Id}&type=Primary&maxWidth=400`,
    backdropUrl: `/api/proxy/image?itemId=${item.Id}&type=Backdrop&maxWidth=1920`,
    thumbUrl: `/api/proxy/image?itemId=${item.Id}&type=Thumb&maxWidth=600`,
    hasSubtitles: item.HasSubtitles || false,
    isPlayed: item.UserData?.Played || false,
    playbackPositionTicks: item.UserData?.PlaybackPositionTicks || 0,
    mediaSources: (item.MediaSources || []).length > 0,
    studios: (item.Studios || []).map(s => s.Name),
    // V7.7: Tout item Jellyfin EST local par définition → mediaStatus 5
    mediaStatus: 5,
    // V7.7: Injecter tmdbId + localId pour cohérence cross-référence
    tmdbId: tmdbId || undefined,
    localId: item.Id,
    providerIds: item.ProviderIds || {},
  };
}

/**
 * Extrait l'ID TMDB depuis les ProviderIds Jellyfin.
 * Gère les 3 variantes de casse : Tmdb, TMDb, tmdb.
 * @param {Object} [providerIds={}] - Objet ProviderIds d'un item Jellyfin
 * @returns {string|null} ID TMDB ou null
 */
function extractTmdbId(providerIds = {}) {
  return providerIds?.Tmdb || providerIds?.TMDb || providerIds?.tmdb || null;
}

/**
 * Récupère un item Jellyfin par son ID avec les champs demandés.
 * @param {Object} config - Configuration DagzFlix (jellyfinUrl)
 * @param {Object} session - Session active (jellyfinUserId, jellyfinToken)
 * @param {string} itemId - ID Jellyfin de l'item
 * @param {string} [fields=''] - Champs Jellyfin supplémentaires (ex: 'ProviderIds,Overview')
 * @returns {Promise<Object|null>} Item Jellyfin brut ou null si non trouvé
 */
async function fetchJellyfinItemById(config, session, itemId, fields = '') {
  if (!itemId) return null;
  const query = fields ? `?Fields=${encodeURIComponent(fields)}` : '';
  const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${itemId}${query}`, {
    headers: { 'X-Emby-Token': session.jellyfinToken },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Résout un ID TMDB à partir d'un tmdbId direct ou en interrogeant Jellyfin pour les ProviderIds.
 * @param {Object} config - Configuration DagzFlix
 * @param {Object} session - Session active
 * @param {Object} params
 * @param {string} [params.tmdbId] - ID TMDB direct (prioritaire)
 * @param {string} [params.itemId] - ID Jellyfin (fallback : extrait le TMDB depuis ProviderIds)
 * @returns {Promise<string|null>} ID TMDB sous forme de string, ou null
 */
async function resolveTmdbId(config, session, { tmdbId, itemId }) {
  if (tmdbId) return `${tmdbId}`;
  if (!itemId) return null;
  try {
    const jellyfinItem = await fetchJellyfinItemById(config, session, itemId, 'ProviderIds');
    const resolved = extractTmdbId(jellyfinItem?.ProviderIds || {});
    return resolved ? `${resolved}` : null;
  } catch (_) {
    return null;
  }
}

/**
 * Normalise un identifiant de contenu : supprime le préfixe 'tmdb-' et les espaces.
 * @param {*} value - Valeur brute (string, number, null)
 * @returns {string|null} ID nettoyé ou null
 */
function normalizeContentId(value) {
  if (!value) return null;
  const str = String(value).trim();
  return str.startsWith('tmdb-') ? str.replace('tmdb-', '') : str;
}

/**
 * Extrait et normalise l'identifiant de contenu d'un item (préfère tmdbId).
 * @param {Object} item - Item DagzFlix, Jellyfin ou TMDB
 * @returns {string|null} ID normalisé
 */
function contentIdFromItem(item) {
  return normalizeContentId(item?.tmdbId || item?.id || item?.Id);
}

/**
 * Récupère tous les IDs TMDB de la bibliothèque locale Jellyfin d'un utilisateur.
 * Retourne un Map<tmdbId, jellyfinId> pour pouvoir résoudre l'ID local.
 * Pour la rétrocompatibilité, le Map possède aussi .has() comme un Set.
 * @param {Object} config - Configuration DagzFlix (jellyfinUrl)
 * @param {Object} session - Session active (jellyfinUserId, jellyfinToken)
 * @returns {Promise<Map<string, string>>} Map(tmdbId → jellyfinId) des items locaux
 */
async function getLocalTmdbIds(config, session) {
  try {
    // V7.7: Limit=10000 pour scanner TOUTE la bibliothèque (Jellyfin default = ~100)
    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds&Limit=10000`, {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error('[getLocalTmdbIds] Jellyfin responded with', res.status);
      return new Map();
    }
    const data = await res.json();
    const map = new Map();
    for (const i of (data.Items || [])) {
      const tmdbId = extractTmdbId(i.ProviderIds || {});
      if (tmdbId) map.set(String(tmdbId), i.Id);
    }
    console.log(`[getLocalTmdbIds] Mapped ${map.size} local items (scanned ${(data.Items || []).length})`);
    return map;
  } catch (err) {
    console.error('[getLocalTmdbIds] failed:', err.message);
    return new Map();
  }
}

/**
 * Injecte le statut favori (`isFavorite: true`) dans un tableau d'items
 * en interrogeant la collection `favorites` MongoDB pour l'utilisateur donné.
 * @param {Object[]} items - Tableau d'items mappés (tmdbId ou id)
 * @param {string} userId - ID utilisateur DagzFlix
 * @returns {Promise<Object[]>} Items enrichis avec `isFavorite`
 */
async function injectFavoriteStatus(items, userId) {
  if (!items?.length || !userId) return items || [];
  try {
    const db = await getDb();
    const favDocs = await db.collection('favorites').find({ userId }).project({ itemId: 1 }).toArray();
    const favSet = new Set(favDocs.map(f => String(f.itemId)));
    return items.map(item => {
      const cid = String(item.tmdbId || item.id || '');
      return { ...item, isFavorite: favSet.has(cid) };
    });
  } catch (_) {
    return items;
  }
}

/**
 * Map inversé TMDB : nom de genre → ID TMDB.
 * Construit automatiquement à partir de TMDB_GENRE_ID_TO_NAME.
 */
const TMDB_GENRE_NAME_TO_ID = Object.fromEntries(
  Object.entries(TMDB_GENRE_ID_TO_NAME).map(([id, name]) => [name.toLowerCase(), parseInt(id)])
);

/**
 * DagzRank V3 — Calcule le score d'un item (0-100) via télémétrie + préférences.
 *
 * Scoring multicouche :
 *  1. Genres favoris vs genres de l'item : jusqu'à 30 pts
 *  2. Affinité historique (genres des items vus) : jusqu'à 15 pts
 *  3. Note communautaire (communityRating/10) : jusqu'à 15 pts
 *  4. Fraîcheur (année de sortie) : jusqu'à 10 pts
 *  5. Bonus télémétrie personnelle (watch/rate du même genre/réalisateur) : jusqu'à 15 pts
 *  6. Bonus collaboratif (moyenne des notes de tous les utilisateurs) : jusqu'à 15 pts
 *  7. Pénalités : déjà vu (-50), rejeté (-60), genres détestés (-25)
 *
 * @param {Object} item - Item à scorer (genres, communityRating, year, isPlayed...)
 * @param {Object|null} preferences - Préférences utilisateur {favoriteGenres, dislikedGenres, rejectedGenres, rejectedContentIds}
 * @param {Array} watchHistory - Historique de visionnage [{id, genres}]
 * @param {Object} [telemetryData=null] - Données télémétrie {userEvents: [{action,itemId,value,genres}], globalRatings: {itemId: avgRating}}
 * @returns {number} Score DagzRank arrondi entre 0 et 100
 */
function calculateDagzRank(item, preferences, watchHistory, telemetryData = null) {
  // V7.6 : Base score de 25 pts pour que tout item neutre démarre à ~50%
  let score = 25;
  const itemGenres = resolveGenres(item);
  const favGenres = preferences?.favoriteGenres || [];
  const dislikedGenres = preferences?.dislikedGenres || [];
  const rejectedGenres = preferences?.rejectedGenres || [];
  const rejectedContentIds = preferences?.rejectedContentIds || [];

  // ── 1) Genre preference match (max 25 pts) ──
  if (itemGenres.length > 0 && favGenres.length > 0) {
    const normalizedFav = favGenres.map(g => g.toLowerCase());
    const normalizedDislike = dislikedGenres.map(g => g.toLowerCase());
    const matchCount = itemGenres.filter(g => normalizedFav.includes(g.toLowerCase())).length;
    const dislikeCount = itemGenres.filter(g => normalizedDislike.includes(g.toLowerCase())).length;
    const genreScore = (matchCount / Math.max(itemGenres.length, 1)) * 25;
    const dislikePenalty = (dislikeCount / Math.max(itemGenres.length, 1)) * 10;
    score += Math.max(0, genreScore - dislikePenalty);
  } else {
    score += 8;
  }

  // ── 2) Watch history affinity (max 10 pts) ──
  if (watchHistory && watchHistory.length > 0) {
    const historyGenres = {};
    watchHistory.forEach(h => {
      (h.genres || []).forEach(g => {
        const key = g.toLowerCase();
        historyGenres[key] = (historyGenres[key] || 0) + 1;
      });
    });
    const maxCount = Math.max(...Object.values(historyGenres), 1);
    let affinityScore = 0;
    itemGenres.forEach(g => {
      const key = g.toLowerCase();
      if (historyGenres[key]) {
        affinityScore += (historyGenres[key] / maxCount) * 10;
      }
    });
    score += Math.min(10, affinityScore / Math.max(itemGenres.length, 1) * itemGenres.length);
  } else {
    score += 5;
  }

  // ── 3) Community rating (max 15 pts) ──
  const rating = item.communityRating || item.CommunityRating || item.voteAverage || 0;
  score += (rating / 10) * 15;

  // ── 4) Freshness / year bonus (max 10 pts) ──
  const year = item.year || item.ProductionYear || 0;
  const currentYear = new Date().getFullYear();
  if (year) {
    const age = currentYear - parseInt(year, 10);
    if (age <= 1) score += 10;
    else if (age <= 3) score += 7;
    else if (age <= 5) score += 4;
    else if (age <= 10) score += 2;
  }

  // ── 5) Personal telemetry bonus (max 10 pts, 5 pts neutral si pas de data) ──
  if (telemetryData?.userEvents?.length > 0) {
    const userEvents = telemetryData.userEvents;
    const telGenres = {};
    for (const ev of userEvents) {
      const evGenres = ev.genres || [];
      if (ev.action === 'watch' && ev.value > 300) {
        evGenres.forEach(g => {
          const key = g.toLowerCase();
          telGenres[key] = (telGenres[key] || 0) + Math.min(ev.value / 3600, 3);
        });
      }
      if (ev.action === 'rate' && ev.value >= 4) {
        evGenres.forEach(g => {
          const key = g.toLowerCase();
          telGenres[key] = (telGenres[key] || 0) + ev.value;
        });
      }
    }
    if (Object.keys(telGenres).length > 0) {
      const maxTelGenre = Math.max(...Object.values(telGenres), 1);
      let telBonus = 0;
      itemGenres.forEach(g => {
        const key = g.toLowerCase();
        if (telGenres[key]) {
          telBonus += (telGenres[key] / maxTelGenre) * 10;
        }
      });
      score += Math.min(10, telBonus / Math.max(itemGenres.length, 1) * itemGenres.length);
    } else {
      score += 5; // V7.6 : pas de pénalité si pas de données pertinentes
    }
  } else {
    score += 5; // V7.6 : neutre si pas de télémétrie
  }

  // ── 6) Collaborative rating bonus (max 10 pts, 5 pts neutral si pas de data) ──
  if (telemetryData?.globalRatings) {
    const itemContentId = contentIdFromItem(item);
    const globalAvg = itemContentId ? telemetryData.globalRatings[itemContentId] : null;
    if (globalAvg && globalAvg > 0) {
      score += Math.min(10, (globalAvg / 5) * 10 * (globalAvg >= 4 ? 1.2 : 1));
    } else {
      score += 5; // V7.6 : neutre si pas de note globale
    }
  } else {
    score += 5; // V7.6 : neutre si pas de télémétrie
  }

  // ── 7) Penalties ──
  // V7.6 : pénalité déjà vu réduite (-30 au lieu de -50)
  if (item.isPlayed) {
    score = Math.max(0, score - 30);
  }

  const itemContentId = contentIdFromItem(item);
  if (itemContentId && rejectedContentIds.includes(itemContentId)) {
    score = Math.max(0, score - 60);
  }

  if (rejectedGenres.length > 0 && itemGenres.length > 0) {
    const normalizedRejected = rejectedGenres.map(g => g.toLowerCase());
    const rejectedOverlap = itemGenres.filter(g => normalizedRejected.includes(g.toLowerCase())).length;
    if (rejectedOverlap > 0) {
      score = Math.max(0, score - Math.min(20, rejectedOverlap * 6));
    }
  }

  return Math.min(100, Math.round(score));
}

/**
 * Charge les données de télémétrie pour le scoring DagzRank V3.
 * Récupère les événements de l'utilisateur (watch, rate) et les notes globales.
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} {userEvents: [...], globalRatings: {contentId: avgRating}}
 */
async function loadTelemetryData(userId) {
  const db = await getDb();
  const telemetry = db.collection('telemetry');

  // User's personal events (watch + rate with genres) — last 200 for performance
  const userEvents = await telemetry
    .find({ userId, action: { $in: ['watch', 'rate'] } })
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray();

  // Global average ratings aggregation — top rated items
  const globalAgg = await telemetry
    .aggregate([
      { $match: { action: 'rate' } },
      { $group: { _id: '$itemId', avgRating: { $avg: '$value' }, count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } }, // Only items with 2+ ratings
      { $sort: { avgRating: -1 } },
      { $limit: 500 },
    ])
    .toArray();

  const globalRatings = {};
  for (const g of globalAgg) {
    globalRatings[g._id] = g.avgRating;
  }

  return { userEvents, globalRatings };
}

/**
 * Liste des genres interdits aux profils "child".
 * Les items contenant l'un de ces genres seront filtrés.
 * @type {string[]}
 */
const CHILD_BLOCKED_GENRES = ['Horror', 'Horreur', 'Erotic', 'Érotique', 'Thriller'];

/**
 * Ratings autorisés pour les profils "child" (PG-13 et en dessous).
 * Si un item a un officialRating non listé ici, il sera masqué pour les enfants.
 * Un item sans rating est autorisé par défaut.
 * @type {Set<string>}
 */
const CHILD_ALLOWED_RATINGS = new Set([
  '', 'G', 'PG', 'PG-13', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG',
  'Tout public', 'U', 'NR', 'Not Rated',
]);

/**
 * Récupère le profil utilisateur depuis la collection `users`.
 * Retourne le rôle (admin, adult, child) et la limite d'âge.
 * @param {string} userId - ID Jellyfin de l'utilisateur
 * @returns {Promise<Object>} {userId, role: 'admin'|'adult'|'child', maxRating: string}
 */
async function getUserProfile(userId) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ userId });
  return user || { userId, role: 'adult', maxRating: '' };
}

/**
 * Filtre parental : exclut les contenus inadaptés aux enfants.
 * Vérifie les genres (Horreur, Érotique), le flag Adult, et l'OfficialRating.
 * @param {Object[]} items - Liste d'items DagzFlix
 * @param {Object} userProfile - Profil utilisateur {role, maxRating}
 * @returns {Object[]} Items filtrés (inchangés si rôle != 'child')
 */
function applyParentalFilter(items, userProfile) {
  try {
    if (!items?.length) return items || [];
    if (!userProfile || userProfile.role !== 'child') return items;
    return items.filter(item => {
      // Exclure les contenus marqués Adult
      if (item.adult === true || item.Adult === true) return false;
      // Exclure les genres interdits
      const itemGenres = resolveGenres(item);
      const blockedLower = CHILD_BLOCKED_GENRES.map(g => g.toLowerCase());
      if (itemGenres.some(g => blockedLower.includes(g.toLowerCase()))) return false;
      // Exclure les ratings au-dessus de PG-13
      const rating = item.officialRating || item.OfficialRating || '';
      if (rating && !CHILD_ALLOWED_RATINGS.has(rating)) return false;
      return true;
    });
  } catch (_) {
    return items || [];
  }
}

/**
 * Vérifie si la durée d'un item correspond au filtre de durée du Wizard.
 * @param {number} runtimeMinutes - Durée en minutes (0 = match toujours)
 * @param {string} duration - Filtre : 'short' (≤120min), 'medium' (45-180min), 'long' (≥70min)
 * @returns {boolean} true si l'item correspond au filtre
 */
function matchesRuntimeLoose(runtimeMinutes, duration) {
  if (!runtimeMinutes || runtimeMinutes <= 0) return true;
  if (duration === 'short') return runtimeMinutes <= 120;
  if (duration === 'medium') return runtimeMinutes >= 45 && runtimeMinutes <= 180;
  if (duration === 'long') return runtimeMinutes >= 70;
  return true;
}

/**
 * GET /api/setup/check
 * Vérifie l'état de la configuration initiale de DagzFlix.
 * @returns {Object} {setupComplete, jellyfinConfigured, jellyseerrConfigured}
 */
async function handleSetupCheck() {
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
async function handleSetupTest(req) {
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
async function handleSetupSave(req) {
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
async function handleAuthLogin(req) {
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
    secure: false,
    sameSite: 'lax',
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
async function handleAuthLogout(req) {
  const sessionId = req.cookies.get('dagzflix_session')?.value;
  if (sessionId) {
    const db = await getDb();
    await db.collection('sessions').deleteOne({ _id: sessionId });
  }
  const response = jsonResponse({ success: true });
  response.cookies.set('dagzflix_session', '', { maxAge: 0, path: '/' });
  return response;
}

/**
 * GET /api/auth/session
 * Retourne l'état de la session courante et si l'onboarding est complété.
 * @param {Request} req
 * @returns {Object} {authenticated, user?, onboardingComplete?}
 */
async function handleAuthSession(req) {
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

/**
 * GET /api/preferences
 * Récupère les préférences utilisateur (genres favoris, rejetés, etc.) depuis MongoDB.
 * @param {Request} req - Session requise
 * @returns {Object} {preferences: {favoriteGenres, dislikedGenres, rejectedGenres, rejectedContentIds...}}
 */
async function handlePreferencesGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId });
  return jsonResponse({ preferences: prefs || {} });
}

/**
 * POST /api/preferences
 * Sauvegarde les préférences utilisateur (genres) et marque l'onboarding comme complété.
 * @param {Request} req - Body JSON {favoriteGenres, dislikedGenres}
 * @returns {Object} {success: true}
 */
async function handlePreferencesSave(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { favoriteGenres, dislikedGenres } = await req.json();
  const db = await getDb();
  await db.collection('preferences').updateOne(
    { userId: session.userId },
    {
      $set: {
        userId: session.userId,
        favoriteGenres: favoriteGenres || [],
        dislikedGenres: dislikedGenres || [],
        onboardingComplete: true,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return jsonResponse({ success: true });
}

/**
 * GET /api/media/library
 * Retourne la bibliothèque Jellyfin avec filtres et tri.
 * Params : type (Movie|Series), limit (défaut 1000), startIndex, sortBy, sortOrder,
 *          genreIds, genres, studios, searchTerm.
 * @param {Request} req - Session requise
 * @returns {Object} {items: MappedItem[], totalCount: number}
 */
async function handleMediaLibrary(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'Movie';
    const limit = url.searchParams.get('limit') || '1000';
    const startIndex = url.searchParams.get('startIndex') || '0';
    const sortBy = url.searchParams.get('sortBy') || 'DateCreated';
    const sortOrder = url.searchParams.get('sortOrder') || 'Descending';
    const genreIds = url.searchParams.get('genreIds') || '';
    const searchTerm = url.searchParams.get('searchTerm') || '';

    const params = new URLSearchParams({
      IncludeItemTypes: type,
      Limit: limit,
      StartIndex: startIndex,
      SortBy: sortBy,
      SortOrder: sortOrder,
      Recursive: 'true',
      Fields: 'Overview,Genres,CommunityRating,OfficialRating,PremiereDate,RunTimeTicks,People,ProviderIds,MediaSources,Studios',
      ImageTypeLimit: '1',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    });

    const genres = url.searchParams.get('genres') || '';
    const studios = url.searchParams.get('studios') || '';
    if (genreIds) params.set('GenreIds', genreIds);
    if (genres) params.set('Genres', genres);
    if (studios) params.set('Studios', studios);
    if (searchTerm) params.set('SearchTerm', searchTerm);

    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?${params.toString()}`, {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      // V7.8: Si Jellyfin 401 → token mort, propager au frontend pour forcer re-login
      if (res.status === 401) return jsonResponse({ error: 'Token Jellyfin expiré' }, 401);
      return jsonResponse({ items: [], totalCount: 0, error: `Jellyfin ${res.status}` });
    }
    const data = await res.json();

    // V7.7: Les items Jellyfin sont acquis — les sous-fonctions ne doivent JAMAIS les vider
    let allItems = (data.Items || []).map(mapJellyfinItem);
    const totalCount = data.TotalRecordCount || 0;

    // V3 : filtre parental (retourne items intact si erreur)
    try {
      const userProfile = await getUserProfile(session.userId).catch(() => null);
      allItems = applyParentalFilter(allItems, userProfile);
    } catch (e) { console.error('[handleMediaLibrary] parental filter failed, returning unfiltered:', e.message); }

    // V7.5 : inject favorite status (retourne items intact si erreur)
    try {
      allItems = await injectFavoriteStatus(allItems, session.userId);
    } catch (e) { console.error('[handleMediaLibrary] favorite inject failed:', e.message); }

    return jsonResponse({ items: allItems, totalCount });
  } catch (err) {
    console.error('[handleMediaLibrary] FATAL (API unreachable):', err.message);
    return jsonResponse({ items: [], totalCount: 0 });
  }
}

/**
 * GET /api/media/genres
 * Retourne la liste des genres disponibles dans la bibliothèque Jellyfin.
 * @param {Request} req - Session requise
 * @returns {Object} {genres: [{id, name}]}
 */
async function handleMediaGenres(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    const res = await fetch(
      `${config.jellyfinUrl}/Genres?UserId=${session.jellyfinUserId}&SortBy=SortName&SortOrder=Ascending`,
      {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) return jsonResponse({ genres: [] });
    const data = await res.json();
    return jsonResponse({ genres: (data.Items || []).map(g => ({ id: g.Id, name: g.Name })) });
  } catch (err) {
    console.error('[handleMediaGenres] graceful degradation:', err.message);
    return jsonResponse({ genres: [] });
  }
}

/**
 * GET /api/person/detail?id={personId}
 * Retourne les détails d'une personne et sa filmographie complète.
 *
 * Deux chemins selon le type d'ID :
 *  - ID numérique (TMDB) → interroge directement Jellyseerr /api/v1/person/{id},
 *    puis vérifie la disponibilité locale via recherche Jellyfin par nom.
 *  - UUID (Jellyfin) → fetche la personne depuis Jellyfin, recherche le TMDB ID
 *    par nom via Jellyseerr, puis fusionne filmographie locale + distante.
 *
 * @param {Request} req - Session requise. Query param: id (Jellyfin UUID ou TMDB numérique)
 * @returns {Object} {person: {id, name, overview, birthDate, photoUrl, tmdbId}, items: MappedItem[]}
 */
async function handlePersonDetail(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const personId = new URL(req.url).searchParams.get('id');
  if (!personId) return jsonResponse({ error: 'ID requis' }, 400);

  // Detect if personId is a numeric TMDB ID (vs Jellyfin UUID)
  const isNumericId = /^\d+$/.test(personId);

  if (isNumericId) {
    // ── TMDB-only path: skip Jellyfin, go direct to Jellyseerr ──
    if (!config.jellyseerrUrl) {
      return jsonResponse({ error: 'Jellyseerr non configuré pour les acteurs TMDB' }, 400);
    }

    let personInfo = { id: personId, name: '', overview: '', birthDate: '', photoUrl: '' };
    let remoteItems = [];

    try {
      const tmdbRes = await fetch(
        `${config.jellyseerrUrl}/api/v1/person/${personId}?language=fr`,
        {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(30000),
        }
      );
      if (tmdbRes.ok) {
        const tmdbData = await tmdbRes.json();
        personInfo = {
          id: personId,
          name: tmdbData.name || '',
          overview: tmdbData.biography || '',
          birthDate: tmdbData.birthday || '',
          photoUrl: tmdbData.profilePath
            ? `/api/proxy/tmdb?path=${tmdbData.profilePath}&width=w400`
            : '',
          tmdbId: personId,
        };

        // Extract full filmography from combinedCredits
        const movieCredits = (tmdbData.combinedCredits?.cast || [])
          .concat(tmdbData.combinedCredits?.crew || []);
        const seen = new Set();
        for (const credit of movieCredits) {
          const tmdbId = String(credit.id);
          const isTv = (credit.mediaType || credit.media_type) === 'tv';
          const key = `${tmdbId}_${isTv ? 'tv' : 'movie'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          remoteItems.push({
            ...mapTmdbItem(credit, isTv),
            role: credit.character || credit.job || '',
          });
        }
      }
    } catch (e) {
      console.error('[DagzFlix] Jellyseerr person fetch (TMDB ID) failed:', e.message);
    }

    // Check which items exist locally in Jellyfin
    if (remoteItems.length > 0) {
      try {
        const localTmdbIds = await getLocalTmdbIds(config, session);
        // Mark local items with mediaStatus 5 and assign localId
        remoteItems = remoteItems.map(item => {
          const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
          const isLocal = tmdbStr && localTmdbIds.has(tmdbStr);
          return {
            ...item,
            mediaStatus: isLocal ? 5 : (item.mediaStatus || 0),
            localId: isLocal ? localTmdbIds.get(tmdbStr) : undefined,
          };
        });
      } catch (_) { /* ignore local lookup failure */ }
    }

    remoteItems.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

    return jsonResponse({ person: personInfo, items: remoteItems });
  }

  // ── Jellyfin UUID path ──
  // V7.5 Mission 1: 100% TMDB via Jellyseerr — Jellyfin only for local availability cross-check

  // 1) Fetch person info from Jellyfin (Name, photo for proxy)
  const personRes = await fetch(
    `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${personId}?Fields=ProviderIds,Overview`,
    {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!personRes.ok) throw new Error(`Jellyfin responded with ${personRes.status}`);
  const person = await personRes.json();

  // 2) SYSTEMATIC: Always search Jellyseerr by Name to find the TMDB Person ID
  let tmdbPersonId = null;
  if (config.jellyseerrUrl) {
    try {
      const nameSearchRes = await fetch(
        `${config.jellyseerrUrl}/api/v1/search?query=${encodeURIComponent(person.Name)}&page=1&language=fr`,
        {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (nameSearchRes.ok) {
        const nameSearchData = await nameSearchRes.json();
        const personResult = (nameSearchData.results || []).find(r => r.mediaType === 'person');
        if (personResult) tmdbPersonId = String(personResult.id);
      }
    } catch (e) {
      console.error('[DagzFlix] Jellyseerr person name search failed:', e.message);
    }
  }

  // Fallback: use Jellyfin ProviderIds if name search didn't find anything
  if (!tmdbPersonId) {
    const fallbackId = extractTmdbId(person.ProviderIds || {});
    if (fallbackId) tmdbPersonId = String(fallbackId);
  }

  // 3) Fetch FULL filmography from TMDB via Jellyseerr (source of truth)
  let allItems = [];
  let personInfo = {
    id: person.Id,
    name: person.Name,
    overview: person.Overview || '',
    birthDate: person.PremiereDate || '',
    photoUrl: `/api/proxy/image?itemId=${person.Id}&type=Primary&maxWidth=400`,
    tmdbId: tmdbPersonId || null,
  };

  if (tmdbPersonId && config.jellyseerrUrl) {
    try {
      const tmdbRes = await fetch(
        `${config.jellyseerrUrl}/api/v1/person/${tmdbPersonId}?language=fr`,
        {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(30000),
        }
      );
      if (tmdbRes.ok) {
        const tmdbData = await tmdbRes.json();

        // Enrich person info with TMDB data
        personInfo = {
          id: person.Id,
          name: tmdbData.name || person.Name,
          overview: tmdbData.biography || person.Overview || '',
          birthDate: tmdbData.birthday || person.PremiereDate || '',
          photoUrl: tmdbData.profilePath
            ? `/api/proxy/tmdb?path=${tmdbData.profilePath}&width=w400`
            : `/api/proxy/image?itemId=${person.Id}&type=Primary&maxWidth=400`,
          tmdbId: tmdbPersonId,
        };

        // Extract full filmography from combinedCredits
        const movieCredits = (tmdbData.combinedCredits?.cast || [])
          .concat(tmdbData.combinedCredits?.crew || []);
        const seen = new Set();
        for (const credit of movieCredits) {
          const tmdbId = String(credit.id);
          const isTv = (credit.mediaType || credit.media_type) === 'tv';
          const key = `${tmdbId}_${isTv ? 'tv' : 'movie'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allItems.push({
            ...mapTmdbItem(credit, isTv),
            role: credit.character || credit.job || '',
          });
        }
      }
    } catch (e) {
      console.error('[DagzFlix] Jellyseerr person filmography fetch failed:', e.message);
    }
  }

  // 4) Cross-reference with local Jellyfin library for availability status
  if (allItems.length > 0) {
    const localTmdbIds = await getLocalTmdbIds(config, session);
    allItems = allItems.map(item => {
      const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
      const isLocal = tmdbStr && localTmdbIds.has(tmdbStr);
      return {
        ...item,
        mediaStatus: isLocal ? 5 : (item.mediaStatus || 0),
        localId: isLocal ? localTmdbIds.get(tmdbStr) : undefined,
      };
    });
  }

  // 5) Sort by year descending
  allItems.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

  return jsonResponse({ person: personInfo, items: allItems });
}

/**
 * GET /api/media/detail?id={itemId}
 * Retourne les détails enrichis d'un média (film ou série).
 *
 * Stratégie :
 *  1. Essaie Jellyfin en premier (item local, avec People, Studios, etc.)
 *  2. Si non trouvé → fallback Jellyseerr : essaie /movie/{id} puis /tv/{id}
 *     avec extraction des credits (cast 15 acteurs + crew réalisateurs/scénaristes).
 *     Les acteurs TMDB reçoivent photoUrl via le proxy TMDB.
 *
 * @param {Request} req - Session requise. Query param: id (Jellyfin UUID ou TMDB numérique)
 * @returns {Object} {item: DetailedItem} avec people[], studios[], mediaStatus, etc.
 */
async function handleMediaDetail(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const itemId = new URL(req.url).searchParams.get('id');
  if (!itemId) return jsonResponse({ error: 'ID requis' }, 400);

  // 1) Try Jellyfin first (local item)
  let jellyfinItem = null;
  try {
    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${itemId}?Fields=Overview,Genres,CommunityRating,OfficialRating,PremiereDate,RunTimeTicks,People,ProviderIds,MediaSources,Studios,Taglines,ExternalUrls,HasSubtitles`, {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) jellyfinItem = await res.json();
  } catch (_) { /* Jellyfin fetch failed, try TMDB fallback */ }

  // 2) If Jellyfin found the item, return enriched local data
  if (jellyfinItem) {
    // V7.5 Mission 2: ALWAYS fetch credits from TMDB/Jellyseerr (source of truth)
    let people = (jellyfinItem.People || []).map(p => ({ Id: p.Id, name: p.Name, role: p.Role, type: p.Type }));
    const jfTmdbId = extractTmdbId(jellyfinItem.ProviderIds || {});
    if (jfTmdbId && config.jellyseerrUrl) {
      try {
        const isTvType = jellyfinItem.Type === 'Series';
        const epType = isTvType ? 'tv' : 'movie';
        const credRes = await fetch(
          `${config.jellyseerrUrl}/api/v1/${epType}/${jfTmdbId}?language=fr`,
          {
            headers: { 'X-Api-Key': config.jellyseerrApiKey },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (credRes.ok) {
          const credData = await credRes.json();
          const rawCredits = credData.credits || {};
          const castList = (rawCredits.cast || []).slice(0, 15).map(actor => ({
            Id: null,
            tmdbId: actor.id,
            name: actor.name || '',
            role: actor.character || '',
            type: 'Actor',
            photoUrl: actor.profilePath
              ? `/api/proxy/tmdb?path=${actor.profilePath}&width=w200`
              : null,
          }));
          const crewList = (rawCredits.crew || [])
            .filter(c => c.job === 'Director' || c.department === 'Writing')
            .slice(0, 6)
            .map(c => ({
              Id: null,
              tmdbId: c.id,
              name: c.name || '',
              role: c.job || '',
              type: c.job === 'Director' ? 'Director' : 'Writer',
              photoUrl: c.profilePath
                ? `/api/proxy/tmdb?path=${c.profilePath}&width=w200`
                : null,
            }));
          if (castList.length > 0 || crewList.length > 0) {
            people = [...castList, ...crewList];
          }
        }
      } catch (_) { /* Keep Jellyfin people as fallback */ }
    }

    // V7.5 Mission 3: inject favorite status
    const db = await getDb();
    const favDoc = await db.collection('favorites').findOne({ userId: session.userId, itemId: String(jellyfinItem.Id) });
    const favDocTmdb = jfTmdbId ? await db.collection('favorites').findOne({ userId: session.userId, itemId: String(jfTmdbId) }) : null;

    return jsonResponse({
      item: {
        id: jellyfinItem.Id,
        name: jellyfinItem.Name,
        originalTitle: jellyfinItem.OriginalTitle || '',
        type: jellyfinItem.Type,
        overview: jellyfinItem.Overview || '',
        genres: jellyfinItem.Genres || [],
        communityRating: jellyfinItem.CommunityRating || 0,
        officialRating: jellyfinItem.OfficialRating || '',
        premiereDate: jellyfinItem.PremiereDate || '',
        year: jellyfinItem.ProductionYear || '',
        runtime: jellyfinItem.RunTimeTicks ? Math.round(jellyfinItem.RunTimeTicks / 600000000) : 0,
        posterUrl: `/api/proxy/image?itemId=${jellyfinItem.Id}&type=Primary&maxWidth=500`,
        backdropUrl: `/api/proxy/image?itemId=${jellyfinItem.Id}&type=Backdrop&maxWidth=1920`,
        people,
        providerIds: jellyfinItem.ProviderIds || {},
        tmdbId: jfTmdbId || undefined,
        studios: (jellyfinItem.Studios || []).map(s => s.Name),
        taglines: jellyfinItem.Taglines || [],
        isPlayed: jellyfinItem.UserData?.Played || false,
        playbackPositionTicks: jellyfinItem.UserData?.PlaybackPositionTicks || 0,
        mediaSources: (jellyfinItem.MediaSources || []).map(ms => ({
          id: ms.Id,
          container: ms.Container,
          videoCodec: ms.VideoStream?.Codec,
          audioCodec: ms.AudioStream?.Codec,
        })),
        hasSubtitles: jellyfinItem.HasSubtitles || false,
        externalUrls: jellyfinItem.ExternalUrls || [],
        mediaStatus: 5,
        isFavorite: !!(favDoc || favDocTmdb),
      },
    });
  }

  // 3) Fallback: item is a TMDB ID → fetch from Jellyseerr with credits
  if (!config.jellyseerrUrl) {
    return jsonResponse({ error: 'Media introuvable' }, 404);
  }

  const localTmdbIds = await getLocalTmdbIds(config, session);

  // V7.6: Strip 'tmdb-' prefix if present (frontend sends tmdb-123456 format)
  const tmdbLookupId = itemId.startsWith('tmdb-') ? itemId.replace('tmdb-', '') : itemId;

  // Try movie first, then TV
  let tmdbData = null;
  let isTv = false;
  for (const endpoint of ['movie', 'tv']) {
    try {
      const res = await fetch(
        `${config.jellyseerrUrl}/api/v1/${endpoint}/${tmdbLookupId}?language=fr`,
        {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(30000),
        }
      );
      if (res.ok) {
        tmdbData = await res.json();
        isTv = endpoint === 'tv';
        break;
      }
    } catch (_) { /* try next */ }
  }

  if (!tmdbData) {
    return jsonResponse({ error: 'Media introuvable' }, 404);
  }

  // Extract credits/cast from Jellyseerr response
  const rawCredits = tmdbData.credits || {};
  const castList = (rawCredits.cast || []).slice(0, 15).map(actor => ({
    Id: null,
    tmdbId: actor.id,
    name: actor.name || '',
    role: actor.character || '',
    type: 'Actor',
    photoUrl: actor.profilePath
      ? `/api/proxy/tmdb?path=${actor.profilePath}&width=w200`
      : null,
  }));
  const crewList = (rawCredits.crew || [])
    .filter(c => c.job === 'Director' || c.department === 'Writing')
    .slice(0, 6)
    .map(c => ({
      Id: null,
      tmdbId: c.id,
      name: c.name || '',
      role: c.job || '',
      type: c.job === 'Director' ? 'Director' : 'Writer',
      photoUrl: c.profilePath
        ? `/api/proxy/tmdb?path=${c.profilePath}&width=w200`
        : null,
    }));

  const genres = resolveGenres(tmdbData);

  // V7.5 Mission 5: strict local cross-reference with localId
  const tmdbStr = String(tmdbData.id);
  const isLocallyAvailable = localTmdbIds.has(tmdbStr);
  const localJellyfinId = isLocallyAvailable ? localTmdbIds.get(tmdbStr) : undefined;

  // V7.5 Mission 3: inject favorite status
  const db = await getDb();
  const favDoc = await db.collection('favorites').findOne({ userId: session.userId, itemId: tmdbStr });

  return jsonResponse({
    item: {
      id: localJellyfinId || tmdbData.id,
      tmdbId: tmdbData.id,
      name: tmdbData.title || tmdbData.name || '',
      originalTitle: tmdbData.originalTitle || tmdbData.originalName || '',
      type: isTv ? 'Series' : 'Movie',
      mediaType: isTv ? 'tv' : 'movie',
      overview: tmdbData.overview || '',
      genres,
      communityRating: tmdbData.voteAverage || 0,
      officialRating: '',
      premiereDate: tmdbData.releaseDate || tmdbData.firstAirDate || '',
      year: (tmdbData.releaseDate || tmdbData.firstAirDate || '').substring(0, 4),
      runtime: tmdbData.runtime || (tmdbData.episodeRunTime?.[0]) || 0,
      posterUrl: tmdbData.posterPath
        ? `/api/proxy/tmdb?path=${tmdbData.posterPath}&width=w500`
        : '',
      backdropUrl: tmdbData.backdropPath
        ? `/api/proxy/tmdb?path=${tmdbData.backdropPath}&width=w1280`
        : '',
      people: [...castList, ...crewList],
      providerIds: { Tmdb: tmdbStr },
      studios: (tmdbData.productionCompanies || []).map(c => c.name).filter(Boolean),
      taglines: tmdbData.tagline ? [tmdbData.tagline] : [],
      isPlayed: false,
      playbackPositionTicks: 0,
      mediaSources: [],
      hasSubtitles: false,
      externalUrls: [],
      // V7.6: Cap non-local at 4 — only confirmed local items get 5
      mediaStatus: isLocallyAvailable ? 5 : Math.min(tmdbData.mediaInfo?.status || 0, 4),
      localId: localJellyfinId,
      isFavorite: !!favDoc,
    },
  });
}

/**
 * GET /api/media/next-episode?seriesId={jellyfinSeriesId}
 * V7.5 Mission 6 — Smart Play pour les séries.
 * Retourne le prochain épisode non-vu d'une série locale Jellyfin.
 * Fallback : S01E01 si aucun épisode en cours.
 * @param {Request} req - Session requise. Query param: seriesId (Jellyfin)
 * @returns {Object} {episodeId, seasonNumber, episodeNumber, name, found}
 */
async function handleNextEpisode(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const url = new URL(req.url);
  const seriesId = url.searchParams.get('seriesId');
  if (!seriesId) return jsonResponse({ error: 'seriesId requis' }, 400);

  // 1) Try to find a resume-in-progress episode first
  try {
    const resumeRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/Resume?ParentId=${seriesId}&Limit=1&Recursive=true&Fields=Overview&MediaTypes=Video`,
      {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (resumeRes.ok) {
      const resumeData = await resumeRes.json();
      if ((resumeData.Items || []).length > 0) {
        const ep = resumeData.Items[0];
        return jsonResponse({
          episodeId: ep.Id,
          seasonNumber: ep.ParentIndexNumber || 1,
          episodeNumber: ep.IndexNumber || 1,
          name: ep.Name || '',
          found: 'resume',
        });
      }
    }
  } catch (_) { /* ignore */ }

  // 2) Then try first unplayed episode (sorted by season/episode order)
  try {
    const nextRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?ParentId=${seriesId}&IncludeItemTypes=Episode&IsPlayed=false&Recursive=true&SortBy=ParentIndexNumber,IndexNumber&SortOrder=Ascending&Limit=1&Fields=Overview`,
      {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (nextRes.ok) {
      const nextData = await nextRes.json();
      if ((nextData.Items || []).length > 0) {
        const ep = nextData.Items[0];
        return jsonResponse({
          episodeId: ep.Id,
          seasonNumber: ep.ParentIndexNumber || 1,
          episodeNumber: ep.IndexNumber || 1,
          name: ep.Name || '',
          found: 'next-unplayed',
        });
      }
    }
  } catch (_) { /* ignore */ }

  // 3) Fallback: S01E01
  try {
    const fallbackRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?ParentId=${seriesId}&IncludeItemTypes=Episode&Recursive=true&SortBy=ParentIndexNumber,IndexNumber&SortOrder=Ascending&Limit=1&Fields=Overview`,
      {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      if ((fallbackData.Items || []).length > 0) {
        const ep = fallbackData.Items[0];
        return jsonResponse({
          episodeId: ep.Id,
          seasonNumber: ep.ParentIndexNumber || 1,
          episodeNumber: ep.IndexNumber || 1,
          name: ep.Name || '',
          found: 'fallback-s01e01',
        });
      }
    }
  } catch (_) { /* ignore */ }

  return jsonResponse({ error: 'Aucun épisode trouvé', found: false }, 404);
}

/**
 * POST /api/media/favorite
 * Ajoute ou retire un média des favoris de l'utilisateur.
 * @param {Request} req - Session requise. Body JSON {itemId, itemData}
 * @returns {Object} {success: true, isFavorite: boolean}
 */
async function handleMediaFavoriteToggle(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { itemId, itemData } = await req.json();
  if (!itemId) return jsonResponse({ error: 'ID requis' }, 400);

  const db = await getDb();
  const filter = { userId: session.userId, itemId: String(itemId) };

  // Check if it already exists
  const existing = await db.collection('favorites').findOne(filter);

  if (existing) {
    // Remove if exists (toggle off)
    await db.collection('favorites').deleteOne(filter);
    return jsonResponse({ success: true, isFavorite: false });
  } else {
    // Add if it doesn't exist (toggle on)
    await db.collection('favorites').insertOne({
      ...filter,
      itemData,
      createdAt: new Date()
    });
    return jsonResponse({ success: true, isFavorite: true });
  }
}

/**
 * GET /api/media/favorites
 * Retourne la liste des médias favoris de l'utilisateur.
 * @param {Request} req - Session requise
 * @returns {Object} {items: MappedItem[]}
 */
async function handleMediaFavoritesGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const db = await getDb();
  const favorites = await db.collection('favorites')
    .find({ userId: session.userId })
    .sort({ createdAt: -1 })
    .toArray();

  const items = favorites.map(f => f.itemData).filter(Boolean);
  return jsonResponse({ items });
}

/**
 * GET /api/media/resume
 * Retourne les médias en cours de visionnage (reprise) depuis Jellyfin.
 * @param {Request} req - Session requise
 * @returns {Object} {items: [{...MappedItem, seriesName, playbackPercentage}]}
 */
async function handleMediaResume(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    const res = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/Resume?Limit=20&Recursive=true&Fields=Overview,Genres,CommunityRating,PremiereDate,RunTimeTicks,MediaSources&MediaTypes=Video&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Thumb`,
      {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(45000),
      }
    );

    if (!res.ok) {
      if (res.status === 401) return jsonResponse({ error: 'Token Jellyfin expiré' }, 401);
      return jsonResponse({ items: [] });
    }
    const data = await res.json();

    const items = (data.Items || []).map(item => ({
      ...mapJellyfinItem(item),
      seriesName: item.SeriesName || '',
      playbackPercentage: item.UserData?.PlayedPercentage || 0,
    }));

    return jsonResponse({ items });
  } catch (err) {
    console.error('[handleMediaResume] graceful degradation:', err.message);
    return jsonResponse({ items: [] });
  }
}

/**
 * GET /api/media/seasons?seriesId={id}
 * Retourne la liste des saisons d'une série Jellyfin.
 * @param {Request} req - Session requise. Query param: seriesId
 * @returns {Object} {seasons: [{id, name, seasonNumber, episodeCount, posterUrl}]}
 */
async function handleMediaSeasons(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const seriesId = new URL(req.url).searchParams.get('seriesId');
  if (!seriesId) return jsonResponse({ error: 'seriesId requis' }, 400);

  const res = await fetch(
    `${config.jellyfinUrl}/Shows/${seriesId}/Seasons?UserId=${session.jellyfinUserId}&Fields=Overview,PremiereDate,ProviderIds,ChildCount`,
    {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) throw new Error(`Jellyfin responded with ${res.status}`);
  const data = await res.json();

  const seasons = (data.Items || []).map(season => ({
    id: season.Id,
    name: season.Name,
    seasonNumber: season.IndexNumber || 0,
    episodeCount: season.ChildCount || 0,
    posterUrl: `/api/proxy/image?itemId=${season.Id}&type=Primary&maxWidth=500`,
  }));

  return jsonResponse({ seasons });
}

/**
 * GET /api/media/episodes?seriesId={id}&seasonId={id}
 * Retourne les épisodes d'une saison depuis Jellyfin.
 * @param {Request} req - Session requise. Query params: seriesId, seasonId (optionnel)
 * @returns {Object} {episodes: [{id, name, overview, episodeNumber, seasonNumber, runtime, isPlayed...}]}
 */
async function handleMediaEpisodes(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const url = new URL(req.url);
  const seriesId = url.searchParams.get('seriesId');
  const seasonId = url.searchParams.get('seasonId');
  if (!seriesId) return jsonResponse({ error: 'seriesId requis' }, 400);

  const params = new URLSearchParams({
    UserId: session.jellyfinUserId,
    Fields: 'Overview,RunTimeTicks,UserData,MediaSources,ParentIndexNumber,IndexNumber,PremiereDate',
    Limit: '200',
  });
  if (seasonId) params.set('SeasonId', seasonId);

  const res = await fetch(`${config.jellyfinUrl}/Shows/${seriesId}/Episodes?${params.toString()}`, {
    headers: { 'X-Emby-Token': session.jellyfinToken },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Jellyfin responded with ${res.status}`);
  const data = await res.json();

  const episodes = (data.Items || []).map(ep => ({
    id: ep.Id,
    name: ep.Name,
    overview: ep.Overview || '',
    episodeNumber: ep.IndexNumber || 0,
    seasonNumber: ep.ParentIndexNumber || 0,
    runtime: ep.RunTimeTicks ? Math.round(ep.RunTimeTicks / 600000000) : 0,
    thumbUrl: `/api/proxy/image?itemId=${ep.Id}&type=Primary&maxWidth=800`,
    backdropUrl: `/api/proxy/image?itemId=${ep.Id}&type=Backdrop&maxWidth=1280`,
    isPlayed: ep.UserData?.Played || false,
  }));

  return jsonResponse({ episodes });
}

/**
 * GET /api/media/trailer?id={itemId}&title={title}&mediaType={movie|tv}
 * Recherche les bandes-annonces d'un média.
 * Priorité : RemoteTrailers Jellyfin → videos Jellyseerr/TMDB → recherche YouTube.
 * @param {Request} req - Session requise
 * @returns {Object} {trailers: [{name, url, type, key, site}]}
 */
async function handleMediaTrailer(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('id');
  const title = url.searchParams.get('title') || '';
  const mediaType = url.searchParams.get('mediaType') || 'movie';
  const tmdbId = await resolveTmdbId(config, session, {
    tmdbId: url.searchParams.get('tmdbId'),
    itemId,
  });

  const trailers = [];

  if (itemId) {
    try {
      const jellyfinItem = await fetchJellyfinItemById(config, session, itemId, 'RemoteTrailers');
      (jellyfinItem?.RemoteTrailers || []).forEach(tr => {
        if (tr?.Url) {
          trailers.push({
            name: tr.Name || 'Trailer',
            url: tr.Url,
            type: tr.Type || 'Trailer',
            key: null,
            site: 'External',
          });
        }
      });
    } catch (_) {
      // ignore jellyfin trailer errors
    }
  }

  if (trailers.length === 0 && tmdbId && config.jellyseerrUrl) {
    try {
      const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
      const res = await fetch(`${config.jellyseerrUrl}/api/v1/${endpoint}/${tmdbId}`, {
        headers: { 'X-Api-Key': config.jellyseerrApiKey },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const candidates = [
          ...(data?.videos?.results || []),
          ...(data?.mediaInfo?.videos?.results || []),
          ...(data?.trailers || []),
        ];

        candidates.forEach(video => {
          const key = video?.key || video?.Key || null;
          const site = video?.site || video?.Site || 'YouTube';
          const type = video?.type || video?.Type || 'Trailer';
          const name = video?.name || video?.Name || 'Bande-annonce';
          let link = video?.url || video?.Url || '';
          if (!link && key && `${site}`.toLowerCase().includes('youtube')) {
            link = `https://www.youtube.com/watch?v=${key}`;
          }
          if (link) {
            trailers.push({ name, type, key, site, url: link });
          }
        });
      }
    } catch (_) {
      // ignore jellyseerr trailer errors
    }
  }

  const cleaned = trailers.filter(t => t.url).slice(0, 10);

  if (cleaned.length === 0 && title) {
    const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} trailer`)}`;
    cleaned.push({
      name: `Rechercher la bande-annonce de ${title}`,
      type: 'Search',
      key: null,
      site: 'YouTube',
      url: ytSearch,
    });
  }

  return jsonResponse({ trailers: cleaned });
}

/**
 * GET /api/media/collection?id={itemId}&tmdbId={tmdbId}
 * Retourne la saga/collection d'un film (ex: Star Wars, Marvel).
 * Interroge Jellyseerr pour belongsToCollection, puis les détails de la collection.
 * @param {Request} req - Session requise
 * @returns {Object} {collection: {id, name, overview}|null, items: [{...MappedItem, isCurrent}]}
 */
async function handleMediaCollection(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('id');
  const mediaType = url.searchParams.get('mediaType') || 'movie';
  const tmdbId = await resolveTmdbId(config, session, {
    tmdbId: url.searchParams.get('tmdbId'),
    itemId,
  });

  if (!tmdbId || !config.jellyseerrUrl || mediaType === 'tv') {
    return jsonResponse({ collection: null, items: [] });
  }

  let collection = null;
  let detailParts = [];
  try {
    const detailRes = await fetch(`${config.jellyseerrUrl}/api/v1/movie/${tmdbId}`, {
      headers: { 'X-Api-Key': config.jellyseerrApiKey },
      signal: AbortSignal.timeout(30000),
    });
    if (detailRes.ok) {
      const detail = await detailRes.json();
      const c = detail.belongsToCollection || detail.collection || null;
      if (c?.id) {
        detailParts = c.parts || detail?.collection?.parts || [];
        collection = {
          id: c.id,
          name: c.name || c.title || 'Saga',
          overview: c.overview || '',
        };
      }
    }
  } catch (_) {
    // ignore detail errors
  }

  if (!collection?.id) {
    return jsonResponse({ collection: null, items: [] });
  }

  let items = detailParts.map(part => ({
    ...mapTmdbItem(part, false),
    id: part.id,
    tmdbId: part.id,
    isCurrent: `${part.id}` === `${tmdbId}`,
  }));
  try {
    const endpoints = [
      `${config.jellyseerrUrl}/api/v1/collection/${collection.id}`,
      `${config.jellyseerrUrl}/api/v1/collections/${collection.id}`,
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        headers: { 'X-Api-Key': config.jellyseerrApiKey },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const parts = data.parts || data.results || [];
      if (parts.length > 0) {
        items = parts.map(part => ({
          ...mapTmdbItem(part, false),
          id: part.id,
          tmdbId: part.id,
          isCurrent: `${part.id}` === `${tmdbId}`,
        }));
        break;
      }
    }
  } catch (_) {
    // ignore collection fetch errors
  }

  return jsonResponse({ collection, items });
}

/**
 * GET /api/media/status?id={itemId}&tmdbId={tmdbId}&mediaType={movie|tv}
 * Vérifie la disponibilité d'un média : local Jellyfin + statut Jellyseerr.
 * @param {Request} req - Session requise
 * @returns {Object} {status: 'available'|'pending'|'partial'|'not_available', jellyfinAvailable, jellyseerrStatus}
 */
async function handleMediaStatus(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const url = new URL(req.url);
  const itemId = url.searchParams.get('id');
  const tmdbId = await resolveTmdbId(config, session, {
    tmdbId: url.searchParams.get('tmdbId'),
    itemId,
  });
  const mediaType = url.searchParams.get('mediaType') || 'movie';

  let status = 'unknown';
  let jellyfinAvailable = false;
  let jellyseerrStatus = null;
  let resolvedLocalId = null;

  if (itemId) {
    try {
      const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${itemId}?Fields=ChildCount,RecursiveItemCount,MediaSources`, {
        headers: { 'X-Emby-Token': session.jellyfinToken },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const item = await res.json();
        if (mediaType === 'tv' || item.Type === 'Series') {
          jellyfinAvailable =
            (item.ChildCount || 0) > 0 ||
            (item.RecursiveItemCount || 0) > 0 ||
            (item.UserData?.PlaybackPositionTicks || 0) > 0;
        } else {
          jellyfinAvailable = (item.MediaSources || []).length > 0;
        }
        if (jellyfinAvailable) resolvedLocalId = itemId;
      }
    } catch (_) {
      // ignore
    }
  }

  // V7.5 Mission 5: If Jellyfin didn't find by ID, cross-reference TMDB ID with local library
  if (!jellyfinAvailable && tmdbId) {
    try {
      const localTmdbIds = await getLocalTmdbIds(config, session);
      if (localTmdbIds.has(String(tmdbId))) {
        jellyfinAvailable = true;
        resolvedLocalId = localTmdbIds.get(String(tmdbId));
      }
    } catch (_) { /* ignore */ }
  }

  if (tmdbId && config.jellyseerrUrl) {
    try {
      const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
      const res = await fetch(`${config.jellyseerrUrl}/api/v1/${endpoint}/${tmdbId}`, {
        headers: { 'X-Api-Key': config.jellyseerrApiKey },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        jellyseerrStatus = data.mediaInfo?.status || null;
      }
    } catch (_) {
      // ignore
    }
  }

  if (jellyfinAvailable) {
    status = 'available';
  } else if (jellyseerrStatus === 2 || jellyseerrStatus === 3 || jellyseerrStatus === 5) {
    status = 'pending';
  } else if (jellyseerrStatus === 4) {
    status = 'partial';
  } else {
    status = 'not_available';
  }

  return jsonResponse({ status, jellyfinAvailable, jellyseerrStatus, localId: resolvedLocalId });
}

/**
 * POST /api/media/request
 * Envoie une demande de téléchargement à Jellyseerr pour un média TMDB.
 * @param {Request} req - Body JSON {mediaType, tmdbId|itemId, seasons?}
 * @returns {Object} {success: true, request?, alreadyRequested?}
 */
async function handleMediaRequest(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  if (!config.jellyseerrUrl) return jsonResponse({ error: 'Jellyseerr non configure' }, 400);

  const body = await req.json();
  const { mediaType, seasons } = body;
  const tmdbId = await resolveTmdbId(config, session, {
    tmdbId: body.tmdbId,
    itemId: body.itemId,
  });
  if (!tmdbId) return jsonResponse({ error: 'TMDB ID requis' }, 400);

  const requestBody = {
    mediaType: mediaType || 'movie',
    mediaId: parseInt(tmdbId, 10),
  };
  if (mediaType === 'tv' && seasons) requestBody.seasons = seasons;

  const res = await fetch(`${config.jellyseerrUrl}/api/v1/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': config.jellyseerrApiKey,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (res.status === 409) {
      return jsonResponse({ success: true, alreadyRequested: true, request: errData || {} });
    }
    throw new Error(errData.message || `Jellyseerr responded with ${res.status}`);
  }

  return jsonResponse({ success: true, request: await res.json() });
}

/**
 * POST /api/media/progress
 * Rapporte la progression de lecture à Jellyfin (Playing, Progress, Stopped).
 * @param {Request} req - Body JSON {itemId, positionTicks, isPaused, isStopped, playSessionId, mediaSourceId}
 * @returns {Object} {success: true}
 */
async function handleMediaProgress(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const db = await getDb();
  const { itemId, positionTicks, isPaused, isStopped, playSessionId, mediaSourceId } = await req.json();
  if (!itemId) return jsonResponse({ error: 'itemId requis' }, 400);

  let endpoint = `${config.jellyfinUrl}/Sessions/Playing/Progress`;
  if (isStopped) endpoint = `${config.jellyfinUrl}/Sessions/Playing/Stopped`;
  else if (positionTicks === 0 || positionTicks === undefined) endpoint = `${config.jellyfinUrl}/Sessions/Playing`;

  const reportBody = {
    ItemId: itemId,
    PositionTicks: positionTicks || 0,
    IsPaused: !!isPaused,
    PlaySessionId: playSessionId || '',
    MediaSourceId: mediaSourceId || itemId,
    CanSeek: true,
    PlayMethod: 'Transcode',
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Token': session.jellyfinToken,
    },
    body: JSON.stringify(reportBody),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok && res.status !== 204) {
    return jsonResponse({ success: false, error: `Jellyfin responded with ${res.status}` }, 500);
  }

  // ── Télémétrie watch : cumul du temps regardé ──
  if (positionTicks && positionTicks > 0) {
    const watchSeconds = Math.round(positionTicks / 10_000_000);
    try {
      await db.collection('telemetry').updateOne(
        { userId: session.userId, itemId, action: 'watch' },
        { $set: { timestamp: new Date() }, $inc: { value: watchSeconds } },
        { upsert: true }
      );
    } catch (_) { /* non-blocking */ }
  }

  return jsonResponse({ success: true });
}

/**
 * GET /api/media/stream?id={itemId}
 * Génère les URLs de streaming HLS et Direct depuis Jellyfin.
 * Retourne aussi les sous-titres et pistes audio disponibles.
 * @param {Request} req - Session requise. Query param: id (Jellyfin item ID)
 * @returns {Object} {streamUrl, fallbackStreamUrl, subtitles[], audioTracks[], duration, playSessionId}
 */
async function handleStream(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
  const config = await getConfig();
  let itemId = new URL(req.url).searchParams.get('id');
  if (!itemId) return jsonResponse({ error: 'ID requis' }, 400);

  // V7.6: Strip 'tmdb-' prefix if present
  if (itemId.startsWith('tmdb-')) itemId = itemId.replace('tmdb-', '');

  // V7.6: If the ID looks like a TMDB numeric ID (not a Jellyfin UUID),
  // try to resolve it to a local Jellyfin ID first
  const isLikelyTmdbId = /^\d+$/.test(itemId);
  if (isLikelyTmdbId) {
    const localTmdbIds = await getLocalTmdbIds(config, session);
    const resolvedId = localTmdbIds.get(String(itemId));
    if (resolvedId) {
      itemId = resolvedId;
    } else {
      return jsonResponse({ error: 'Media non disponible localement — demandez-le via Jellyseerr', notLocal: true }, 404);
    }
  }

  const res = await fetch(
    `${config.jellyfinUrl}/Items/${itemId}/PlaybackInfo?UserId=${session.jellyfinUserId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Token': session.jellyfinToken,
      },
      body: JSON.stringify({
        DeviceProfile: {
          MaxStreamingBitrate: 120000000,
          DirectPlayProfiles: [{ Container: 'mp4,m4v,mkv,webm,avi,mov', Type: 'Video' }],
          TranscodingProfiles: [
            {
              Container: 'ts',
              Type: 'Video',
              VideoCodec: 'h264,hevc',
              AudioCodec: 'aac,mp3',
              Context: 'Streaming',
              Protocol: 'hls',
              MaxAudioChannels: '2',
              BreakOnNonKeyFrames: true,
            },
          ],
          SubtitleProfiles: [
            { Format: 'vtt', Method: 'External' },
            { Format: 'srt', Method: 'External' },
            { Format: 'ass', Method: 'External' },
          ],
        },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) return jsonResponse({ error: 'Playback info failed — item may not be available locally' }, 404);
  const pb = await res.json();
  const mediaSource = (pb.MediaSources || [])[0];
  const playSessionId = pb.PlaySessionId || uuidv4();
  const streams = mediaSource?.MediaStreams || [];

  const hlsCompatUrl = `${config.jellyfinUrl}/Videos/${itemId}/master.m3u8?api_key=${session.jellyfinToken}&MediaSourceId=${mediaSource?.Id || ''}&PlaySessionId=${playSessionId}&VideoCodec=h264&AudioCodec=aac&TranscodingMaxAudioChannels=2&SegmentContainer=ts`;
  const directUrl = `${config.jellyfinUrl}/Videos/${itemId}/stream?Static=true&MediaSourceId=${mediaSource?.Id || ''}&PlaySessionId=${playSessionId}&api_key=${session.jellyfinToken}`;
  const streamUrl = hlsCompatUrl;

  const subtitles = streams
    .filter(s => s.Type === 'Subtitle')
    .map((s, index) => ({
      index: s.Index,
      language: s.Language || 'und',
      displayTitle: s.DisplayTitle || s.Title || s.Language || `Sous-titre ${index + 1}`,
      codec: s.Codec,
      url: s.DeliveryUrl
        ? `${config.jellyfinUrl}${s.DeliveryUrl}`
        : `${config.jellyfinUrl}/Videos/${itemId}/${mediaSource?.Id || ''}/Subtitles/${s.Index}/Stream.${s.Codec || 'srt'}?api_key=${session.jellyfinToken}`,
    }));

  const audioTracks = streams
    .filter(s => s.Type === 'Audio')
    .map((s, index) => ({
      index: s.Index,
      language: s.Language || 'und',
      displayTitle: s.DisplayTitle || s.Title || s.Language || `Audio ${index + 1}`,
      codec: s.Codec,
      channels: s.Channels || 2,
      isDefault: !!s.IsDefault,
    }));

  return jsonResponse({
    streamUrl,
    fallbackStreamUrl: directUrl,
    subtitles,
    audioTracks,
    duration: mediaSource?.RunTimeTicks ? mediaSource.RunTimeTicks / 10000000 : 0,
    playSessionId,
    mediaSourceId: mediaSource?.Id || itemId,
  });
  } catch (err) {
    console.error('[handleStream] graceful degradation:', err.message);
    return jsonResponse({ error: 'Stream unavailable' }, 404);
  }
}

/**
 * GET /api/search?q={query}&page={1}&mediaType={movie|tv}
 * Recherche globale via Jellyseerr (prioritaire) avec fallback Jellyfin.
 * Applique le DagzRank sur tous les résultats en chargeant les préférences et l'historique.
 * @param {Request} req - Session requise
 * @returns {Object} {results: [{...MappedItem, dagzRank}], totalPages?, totalResults}
 */
async function handleSearch(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
  const config = await getConfig();
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';
  const page = url.searchParams.get('page') || '1';
  const mediaType = url.searchParams.get('mediaType') || '';

  if (!query.trim()) return jsonResponse({ results: [] });

  // Load user preferences + watch history for DagzRank scoring
  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId }).catch(() => null);
  let watchHistory = [];
  try {
    const histRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?IsPlayed=true&Recursive=true&Limit=100&Fields=Genres&SortBy=DatePlayed&SortOrder=Descending`,
      { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(30000) }
    );
    if (histRes.ok) {
      const histData = await histRes.json();
      watchHistory = (histData.Items || []).map(i => ({ id: i.Id, genres: i.Genres || [] }));
    }
  } catch (_) { /* ignore */ }

  // V7.7: charger télémétrie + profil parental + TMDB IDs locaux (chacun protégé)
  const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));
  const userProfile = await getUserProfile(session.userId).catch(() => null);
  const localTmdbIds = await getLocalTmdbIds(config, session);

  // V7.7: scoreResults ne doit JAMAIS vider les items reçus
  function scoreResults(items) {
    let filtered = items;
    try { filtered = applyParentalFilter(items, userProfile); } catch (e) { console.error('[handleSearch] parental filter failed:', e.message); }
    return filtered.map(item => {
      const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
      const isLocal = item.mediaStatus === 5 || (tmdbStr && localTmdbIds.has(tmdbStr));
      return {
        ...item,
        mediaStatus: isLocal ? 5 : (item.mediaStatus || 0),
        localId: (isLocal && tmdbStr && localTmdbIds.get(tmdbStr)) || item.localId || undefined,
        dagzRank: calculateDagzRank(item, prefs, watchHistory, telemetryData),
      };
    });
  }

  if (config.jellyseerrUrl) {
    try {
      const res = await fetch(`${config.jellyseerrUrl}/api/v1/search?query=${encodeURIComponent(query)}&page=${page}`, {
        headers: { 'X-Api-Key': config.jellyseerrApiKey },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        let mapped = (data.results || []).map(item => mapTmdbItem(item));
        if (mediaType === 'movie') mapped = mapped.filter(i => i.type === 'Movie');
        else if (mediaType === 'tv') mapped = mapped.filter(i => i.type === 'Series');
        let scored = scoreResults(mapped);
        // V7.5 : inject favorite status
        scored = await injectFavoriteStatus(scored, session.userId);
        return jsonResponse({
          results: scored,
          totalPages: data.totalPages || 1,
          totalResults: mapped.length,
        });
      }
    } catch (e) {
      console.error('[DagzFlix] Jellyseerr search failed, falling back to Jellyfin:', e.message);
    }
  }

  const jfParams = new URLSearchParams({
    SearchTerm: query,
    Recursive: 'true',
    Limit: '20',
    Fields: 'Overview,Genres,CommunityRating,ProviderIds,Studios',
  });
  if (mediaType === 'movie') jfParams.set('IncludeItemTypes', 'Movie');
  else if (mediaType === 'tv') jfParams.set('IncludeItemTypes', 'Series');

  const res = await fetch(
    `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?${jfParams.toString()}`,
    {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) return jsonResponse({ results: [], totalResults: 0 });
  const data = await res.json();

  let jfScored = scoreResults((data.Items || []).map(item => ({
    ...mapJellyfinItem(item),
    mediaStatus: 5,
  })));
  // V7.5 : inject favorite status
  jfScored = await injectFavoriteStatus(jfScored, session.userId);

  return jsonResponse({
    results: jfScored,
    totalResults: data.TotalRecordCount || 0,
  });
  } catch (err) {
    console.error('[handleSearch] FATAL:', err.message);
    return jsonResponse({ results: [], totalResults: 0 });
  }
}

/**
 * GET /api/discover?type={movies|tv}&page={1}&genre={genreName}&studio={studioName}
 * Découverte de contenus populaires via Jellyseerr.
 * V7.5 : supporte le filtrage par genre TMDB (nom → ID automatique).
 * @param {Request} req - Session requise
 * @returns {Object} {results: MappedItem[], totalPages}
 */
async function handleDiscover(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    if (!config.jellyseerrUrl) return jsonResponse({ results: [], error: 'Jellyseerr non configure' });

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'movies';
    const page = url.searchParams.get('page') || '1';
    const genre = url.searchParams.get('genre') || '';
    const studio = url.searchParams.get('studio') || '';
    const endpoint = type === 'tv' ? 'tv' : 'movies';

    // Request high quality trending content available in France (Netflix/Amazon)
    const queryParams = new URLSearchParams({
      page: page,
      sortBy: 'popularity.desc',
      watch_region: 'FR',
      with_watch_providers: '8|119' // Netflix & Amazon Prime
    });

    // V7.5 Mission 4: genre filtering via TMDB genre ID
    if (genre) {
      const genreLower = genre.toLowerCase();
      const genreId = TMDB_GENRE_NAME_TO_ID[genreLower];
      if (genreId) {
        queryParams.set('with_genres', String(genreId));
      } else {
        const match = Object.entries(TMDB_GENRE_NAME_TO_ID).find(([name]) => name.includes(genreLower) || genreLower.includes(name));
        if (match) queryParams.set('with_genres', String(match[1]));
      }
    }

    if (studio) {
      queryParams.set('with_companies', studio);
    }

    const res = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${endpoint}?${queryParams.toString()}`, {
      headers: { 'X-Api-Key': config.jellyseerrApiKey },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return jsonResponse({ results: [], totalPages: 0 });
    const data = await res.json();

    // V7.7: Les résultats Jellyseerr sont acquis — mapper puis enrichir sans jamais vider
    let allItems = (data.results || []).map(item => mapTmdbItem(item, type === 'tv'));
    const totalPages = data.totalPages || 1;

    // Cross-référence locale (non-destructrice)
    try {
      const localTmdbIds = await getLocalTmdbIds(config, session);
      allItems = allItems.map(mapped => {
        if (mapped.tmdbId && localTmdbIds.has(String(mapped.tmdbId))) {
          mapped.mediaStatus = 5;
          mapped.localId = localTmdbIds.get(String(mapped.tmdbId));
        }
        return mapped;
      });
    } catch (e) { console.error('[handleDiscover] localTmdbIds failed, skipping cross-ref:', e.message); }

    // Filtre parental (non-destructeur)
    try {
      const userProfile = await getUserProfile(session.userId).catch(() => null);
      allItems = applyParentalFilter(allItems, userProfile);
    } catch (e) { console.error('[handleDiscover] parental filter failed:', e.message); }

    // Injection favoris (non-destructrice)
    try {
      allItems = await injectFavoriteStatus(allItems, session.userId);
    } catch (e) { console.error('[handleDiscover] favorite inject failed:', e.message); }

    return jsonResponse({ results: allItems, totalPages });
  } catch (err) {
    console.error('[handleDiscover] FATAL (API unreachable):', err.message);
    return jsonResponse({ results: [], totalPages: 0 });
  }
}

/**
 * GET /api/recommendations
 * Génère des recommandations personnalisées basées sur le DagzRank.
 * Mélange items Jellyfin (random) + Jellyseerr (discover), déduplique par nom,
 * score et trie par DagzRank décroissant. Garde les items > 20 pts (max 30).
 * @param {Request} req - Session requise
 * @returns {Object} {recommendations: [{...MappedItem, dagzRank}], totalScored, sources: {jellyfin, jellyseerr}}
 */
async function handleRecommendations(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
  const config = await getConfig();
  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId }).catch(() => null);

  let watchHistory = [];
  try {
    const histRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?IsPlayed=true&Recursive=true&Limit=100&Fields=Genres&SortBy=DatePlayed&SortOrder=Descending`,
      { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(45000) }
    );
    if (histRes.ok) {
      const histData = await histRes.json();
      watchHistory = (histData.Items || []).map(i => ({ id: i.Id, genres: i.Genres || [] }));
    }
  } catch (_) {
    // ignore
  }

  let jellyfinItems = [];
  try {
    const mediaRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?Recursive=true&Limit=100&IncludeItemTypes=Movie,Series&Fields=Overview,Genres,CommunityRating,PremiereDate&SortBy=Random`,
      { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(45000) }
    );
    if (mediaRes.ok) {
      const mediaData = await mediaRes.json();
      jellyfinItems = (mediaData.Items || []).map(item => ({
        ...mapJellyfinItem(item),
        source: 'jellyfin',
      }));
    }
  } catch (_) {
    // ignore
  }

  let jellyseerrItems = [];
  if (config.jellyseerrUrl) {
    for (const discoverType of ['movies', 'tv']) {
      try {
        const discRes = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${discoverType}?page=1`, {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(30000),
        });
        if (discRes.ok) {
          const discData = await discRes.json();
          jellyseerrItems.push(
            ...(discData.results || []).map(item => ({
              ...mapTmdbItem(item, discoverType === 'tv'),
              id: `tmdb-${item.id}`,
              isPlayed: false,
              source: 'jellyseerr',
            }))
          );
        }
      } catch (_) {
        // ignore
      }
    }
  }

  const seen = new Set();
  const merged = [];
  for (const item of [...jellyfinItems, ...jellyseerrItems]) {
    const key = `${item.name || ''}`.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  // V7.7: merged est acquis — enrichir sans jamais vider
  const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));
  const userProfile = await getUserProfile(session.userId).catch(() => null);

  // Filtre parental (non-destructeur)
  let filtered = merged;
  try { filtered = applyParentalFilter(merged, userProfile); } catch (e) { console.error('[handleRecommendations] parental filter failed:', e.message); }

  const scored = filtered
    .map(item => ({ ...item, dagzRank: calculateDagzRank(item, prefs, watchHistory, telemetryData) }))
    .sort((a, b) => b.dagzRank - a.dagzRank);

  // V7.6 : plus de seuil minimum — toujours retourner le top 25
  let topRecs = scored.slice(0, 25);
  try { topRecs = await injectFavoriteStatus(topRecs, session.userId); } catch (e) { console.error('[handleRecommendations] favorite inject failed:', e.message); }

  return jsonResponse({
    recommendations: topRecs,
    totalScored: scored.length,
    sources: {
      jellyfin: jellyfinItems.length,
      jellyseerr: jellyseerrItems.length,
    },
  });
  } catch (err) {
    console.error('[handleRecommendations] FATAL:', err.message);
    return jsonResponse({ recommendations: [], totalScored: 0, sources: { jellyfin: 0, jellyseerr: 0 } });
  }
}

/**
 * POST /api/wizard/discover
 * Moteur de découverte du Wizard : filtre par mood, époque, durée, type.
 * Applique DagzRank + bonus mood, exclut les contenus rejetés,
 * puis sélectionne aléatoirement parmi le top 8.
 * @param {Request} req - Body JSON {mood, era, duration, mediaType, excludeIds?}
 * @returns {Object} {perfectMatch: MappedItem|null, alternatives: MappedItem[], count}
 */
async function handleWizardDiscover(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  if (!config?.jellyseerrUrl) return jsonResponse({ perfectMatch: null, alternatives: [] });

  const { mood, era, duration, mediaType, excludeIds = [] } = await req.json();
  const db = await getDb();
  const prefs = await db.collection('preferences').findOne({ userId: session.userId });
  const isTv = mediaType === 'tv';
  const endpoint = isTv ? 'tv' : 'movies';

  const res = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${endpoint}?page=1`, {
    headers: { 'X-Api-Key': config.jellyseerrApiKey },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return jsonResponse({ perfectMatch: null, alternatives: [] });
  const data = await res.json();

  const mapped = (data.results || []).map(item => {
    const runtime = isTv
      ? (item.episodeRunTime && item.episodeRunTime[0]) || 0
      : item.runtime || 0;

    return {
      ...mapTmdbItem(item, isTv),
      runtime,
      mood,
      era,
    };
  });

  const moodGenreMap = {
    fun: ['Comedy', 'Family', 'Animation'],
    love: ['Romance', 'Drama'],
    adrenaline: ['Action', 'Thriller', 'Adventure', 'Crime'],
    dark: ['Thriller', 'Horror', 'Mystery', 'Crime'],
    cinema: ['Adventure', 'Science Fiction', 'Drama', 'Action'],
  };

  const eraPredicate = (yearStr) => {
    const year = parseInt(yearStr || '0', 10);
    if (!year) return true;
    if (era === 'modern') return year >= 2015;
    if (era === 'classic2000') return year >= 2000 && year <= 2014;
    if (era === 'retro') return year < 2000;
    return true;
  };

  const filteredRuntime = mapped.filter(item => matchesRuntimeLoose(item.runtime, duration));
  const runtimePool = filteredRuntime.length > 0 ? filteredRuntime : mapped;
  const filteredEra = runtimePool.filter(item => eraPredicate(item.year));
  const pool = filteredEra.length > 0 ? filteredEra : runtimePool;

  const explicitExcludes = (excludeIds || []).map(normalizeContentId).filter(Boolean);
  const rejectionExcludes = (prefs?.rejectedContentIds || []).map(normalizeContentId).filter(Boolean);
  const globalExcludes = new Set([...explicitExcludes, ...rejectionExcludes]);

  const filteredPool = pool.filter(item => !globalExcludes.has(contentIdFromItem(item)));
  const effectivePool = filteredPool.length > 0 ? filteredPool : pool;

  const ranked = effectivePool
    .map(item => {
      const base = calculateDagzRank(item, prefs || null, []);
      const moodGenres = moodGenreMap[mood] || [];
      const itemGenres = resolveGenres(item);
      const overlap = itemGenres.filter(g => moodGenres.includes(g)).length;
      const moodBonus = overlap > 0 ? Math.min(15, overlap * 6) : 0;
      return { ...item, dagzRank: Math.min(100, base + moodBonus) };
    })
    .sort((a, b) => b.dagzRank - a.dagzRank);

  const topWindow = ranked.slice(0, Math.min(8, ranked.length));
  const picked = topWindow.length > 0
    ? topWindow[Math.floor(Math.random() * topWindow.length)]
    : null;

  const alternatives = ranked
    .filter(item => !picked || item.id !== picked.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 12);

  return jsonResponse({
    perfectMatch: picked,
    alternatives,
    count: ranked.length,
  });
}

/**
 * GET /api/proxy/image?itemId={id}&type={Primary|Backdrop|Thumb}&maxWidth={400}
 * Proxy transparent vers les images Jellyfin. Évite d'exposer l'URL Jellyfin au client.
 * Cache: 24h (Cache-Control: public, max-age=86400).
 * @param {Request} req
 * @returns {Response} Image binaire avec Content-Type d'origine
 */
async function handleProxyImage(req) {
  const config = await getConfig();
  if (!config?.jellyfinUrl) return new Response('Not configured', { status: 503 });

  const url = new URL(req.url);
  const itemId = url.searchParams.get('itemId');
  const type = url.searchParams.get('type') || 'Primary';
  const maxWidth = url.searchParams.get('maxWidth') || '400';
  if (!itemId) return new Response('Missing itemId', { status: 400 });

  const res = await fetch(`${config.jellyfinUrl}/Items/${itemId}/Images/${type}?maxWidth=${maxWidth}`, {
    headers: config.jellyfinApiKey ? { 'X-Emby-Token': config.jellyfinApiKey } : {},
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) return new Response('Image not found', { status: 404 });
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * POST /api/wizard/feedback
 * Enregistre un rejet de contenu depuis le Wizard.
 * Ajoute l'ID dans rejectedContentIds et les genres dans rejectedGenres.
 * @param {Request} req - Body JSON {action: 'reject', itemId|tmdbId, genres?}
 * @returns {Object} {success: true}
 */
async function handleWizardFeedback(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { action, itemId, tmdbId, genres = [] } = await req.json();
  if (!action || action !== 'reject') return jsonResponse({ success: true });

  const contentId = normalizeContentId(tmdbId || itemId);
  if (!contentId) return jsonResponse({ success: false, error: 'ID contenu requis' }, 400);

  const cleanGenres = (genres || []).filter(Boolean).slice(0, 10);
  const db = await getDb();
  await db.collection('preferences').updateOne(
    { userId: session.userId },
    {
      $setOnInsert: { userId: session.userId, onboardingComplete: false },
      $addToSet: {
        rejectedContentIds: contentId,
        rejectedGenres: { $each: cleanGenres },
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true }
  );

  return jsonResponse({ success: true });
}

/**
 * GET /api/proxy/tmdb?path={/posterPath}&width={w400}
 * Proxy transparent vers les images TMDB (image.tmdb.org).
 * Cache: 24h. Permet d'éviter les problèmes CORS et de masquer les URLs TMDB.
 * @param {Request} req
 * @returns {Response} Image binaire
 */
async function handleProxyTmdb(req) {
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  const width = url.searchParams.get('width') || 'w400';
  if (!path) return new Response('Missing path', { status: 400 });

  const res = await fetch(`https://image.tmdb.org/t/p/${width}${path}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return new Response('Image not found', { status: 404 });

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ██  TÉLÉMÉTRIE & ADMIN — V0,006
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/telemetry/click
 * Enregistre un événement de clic sur un média (fire & forget côté client).
 * @param {Request} req - Body JSON {itemId, genres?: string[]}
 * @returns {Object} {success: true}
 */
async function handleTelemetryClick(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { itemId, genres } = await req.json();
  if (!itemId) return jsonResponse({ error: 'itemId requis' }, 400);

  const db = await getDb();
  await db.collection('telemetry').insertOne({
    userId: session.userId,
    itemId: String(itemId),
    action: 'click',
    value: 1,
    genres: genres || [],
    timestamp: new Date(),
  });

  return jsonResponse({ success: true });
}

/**
 * POST /api/media/rate
 * Enregistre ou met à jour la note d'un utilisateur pour un média (1-5 étoiles).
 * Upsert : une seule note par utilisateur/item.
 * @param {Request} req - Body JSON {itemId, value: 1-5, genres?: string[]}
 * @returns {Object} {success: true, value}
 */
async function handleMediaRate(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const { itemId, value, genres } = await req.json();
  if (!itemId) return jsonResponse({ error: 'itemId requis' }, 400);
  const rating = Math.max(1, Math.min(5, parseInt(value, 10) || 0));
  if (!rating) return jsonResponse({ error: 'Note entre 1 et 5 requise' }, 400);

  const db = await getDb();
  await db.collection('telemetry').updateOne(
    { userId: session.userId, itemId: String(itemId), action: 'rate' },
    { $set: { value: rating, genres: genres || [], timestamp: new Date() } },
    { upsert: true }
  );

  return jsonResponse({ success: true, value: rating });
}

/**
 * GET /api/media/rating?id={itemId}
 * Récupère la note de l'utilisateur courant pour un média donné.
 * @param {Request} req - Session requise. Query param: id (content ID)
 * @returns {Object} {rating: number|null, globalAverage: number|null, totalRatings: number}
 */
async function handleMediaRatingGet(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const itemId = new URL(req.url).searchParams.get('id');
  if (!itemId) return jsonResponse({ error: 'id requis' }, 400);

  const db = await getDb();
  const userRating = await db.collection('telemetry').findOne({
    userId: session.userId,
    itemId: String(itemId),
    action: 'rate',
  });

  const globalAgg = await db.collection('telemetry').aggregate([
    { $match: { itemId: String(itemId), action: 'rate' } },
    { $group: { _id: null, avg: { $avg: '$value' }, count: { $sum: 1 } } },
  ]).toArray();

  return jsonResponse({
    rating: userRating?.value || null,
    globalAverage: globalAgg[0]?.avg ? Math.round(globalAgg[0].avg * 10) / 10 : null,
    totalRatings: globalAgg[0]?.count || 0,
  });
}

/**
 * GET /api/admin/users
 * Retourne la liste de tous les utilisateurs (admin uniquement).
 * Inclut le rôle, le nom, la dernière connexion.
 * @param {Request} req - Session requise, rôle admin requis
 * @returns {Object} {users: [{userId, username, role, maxRating, lastLogin, createdAt}]}
 */
async function handleAdminUsers(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const adminProfile = await getUserProfile(session.userId);
  if (adminProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const db = await getDb();
  const users = await db.collection('users').find({}).sort({ lastLogin: -1 }).toArray();

  return jsonResponse({
    users: users.map(u => ({
      userId: u.userId,
      username: u.username || 'Inconnu',
      role: u.role || 'adult',
      maxRating: u.maxRating || '',
      lastLogin: u.lastLogin || u.createdAt,
      createdAt: u.createdAt,
    })),
  });
}

/**
 * POST /api/admin/users/update
 * Met à jour le rôle d'un utilisateur (admin uniquement).
 * @param {Request} req - Body JSON {userId, role: 'admin'|'adult'|'child', maxRating?: string}
 * @returns {Object} {success: true, updated: {userId, role}}
 */
async function handleAdminUsersUpdate(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const adminProfile = await getUserProfile(session.userId);
  if (adminProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Accès réservé aux administrateurs' }, 403);
  }

  const { userId, role, maxRating } = await req.json();
  if (!userId || !role) return jsonResponse({ error: 'userId et role requis' }, 400);

  const validRoles = ['admin', 'adult', 'child'];
  if (!validRoles.includes(role)) {
    return jsonResponse({ error: `Rôle invalide. Valeurs autorisées : ${validRoles.join(', ')}` }, 400);
  }

  const db = await getDb();
  const result = await db.collection('users').updateOne(
    { userId },
    { $set: { role, maxRating: maxRating || '', updatedAt: new Date() } }
  );

  if (result.matchedCount === 0) {
    return jsonResponse({ error: 'Utilisateur non trouvé' }, 404);
  }

  return jsonResponse({ success: true, updated: { userId, role } });
}

/**
 * Extrait les segments de chemin depuis l'URL de la requête.
 * Ex: /api/media/detail → ['media', 'detail']
 * @param {Request} req
 * @returns {string[]} Segments de chemin sans le préfixe /api/
 */
function getPathParts(req) {
  return new URL(req.url).pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

/**
 * Routeur principal GET — dispatche vers le bon handler selon le chemin.
 * Routes supportées : setup/check, auth/session, preferences, media/*, person/detail,
 * search, discover, recommendations, admin/users, media/rating, proxy/image, proxy/tmdb.
 * @param {string[]} parts - Segments de chemin (ex: ['media', 'detail'])
 * @param {Request} req
 * @returns {Promise<NextResponse>}
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

  if (route === 'proxy/image') return handleProxyImage(req);
  if (route === 'proxy/tmdb') return handleProxyTmdb(req);

  return jsonResponse({ error: `Route GET inconnue: /api/${route}` }, 404);
}

/**
 * Routeur principal POST — dispatche vers le bon handler selon le chemin.
 * Routes supportées : setup/test, setup/save, auth/login, auth/logout,
 * preferences, media/request, media/progress, media/rate, telemetry/click,
 * admin/users/update, wizard/discover, wizard/feedback.
 * @param {string[]} parts - Segments de chemin
 * @param {Request} req
 * @returns {Promise<NextResponse>}
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

/**
 * Handler Next.js App Router pour les requêtes GET.
 * Catch-all route [[...path]] — toutes les requêtes GET sous /api/ passent ici.
 * @param {Request} req
 * @returns {Promise<NextResponse>}
 */
export async function GET(req) {
  try {
    return await routeGet(getPathParts(req), req);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * Handler Next.js App Router pour les requêtes POST.
 * Catch-all route [[...path]] — toutes les requêtes POST sous /api/ passent ici.
 * @param {Request} req
 * @returns {Promise<NextResponse>}
 */
export async function POST(req) {
  try {
    return await routePost(getPathParts(req), req);
  } catch (err) {
    console.error('[POST FATAL]', getPathParts(req), err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
    return jsonResponse({ error: err.message }, 500);
  }
}

/**
 * Handler CORS preflight (OPTIONS).
 * Retourne 204 No Content avec les headers CORS permissifs.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

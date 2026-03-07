/**
 * lib/media-mappers.js — Mapping & Résolution de médias
 *
 * Fonctions de transformation et de résolution d'identifiants :
 * mapTmdbItem, mapJellyfinItem, resolveGenres, extractTmdbId,
 * normalizeContentId, contentIdFromItem, TMDB_GENRE_ID_TO_NAME,
 * TMDB_GENRE_NAME_TO_ID, fetchJellyfinItemById, resolveTmdbId,
 * getLocalTmdbIds, getUserProfile, injectFavoriteStatus, matchesRuntimeLoose.
 */
import { getDb } from './db';

/**
 * Table de correspondance ID TMDB → Nom du genre.
 * Couvre les genres films et TV de l'API TMDB.
 */
export const TMDB_GENRE_ID_TO_NAME = {
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
 * Map inversé TMDB : nom de genre → ID TMDB.
 * Construit automatiquement à partir de TMDB_GENRE_ID_TO_NAME.
 */
export const TMDB_GENRE_NAME_TO_ID = Object.fromEntries(
  Object.entries(TMDB_GENRE_ID_TO_NAME).map(([id, name]) => [name.toLowerCase(), parseInt(id)])
);

/**
 * Résout les genres d'un item, quel que soit le format source.
 * Gère 3 cas : tableau de strings, tableau d'objets {name/Name}, ou tableau d'IDs TMDB numériques.
 * @param {Object} item - Item Jellyfin ou TMDB
 * @returns {string[]} Liste de noms de genres (ex: ['Action', 'Drama'])
 */
export function resolveGenres(item) {
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
export function mapTmdbItem(item, forceTv = null) {
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
export function mapJellyfinItem(item) {
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
export function extractTmdbId(providerIds = {}) {
  return providerIds?.Tmdb || providerIds?.TMDb || providerIds?.tmdb || null;
}

/**
 * Normalise un identifiant de contenu : supprime le préfixe 'tmdb-' et les espaces.
 * @param {*} value - Valeur brute (string, number, null)
 * @returns {string|null} ID nettoyé ou null
 */
export function normalizeContentId(value) {
  if (!value) return null;
  const str = String(value).trim();
  return str.startsWith('tmdb-') ? str.replace('tmdb-', '') : str;
}

/**
 * Extrait et normalise l'identifiant de contenu d'un item (préfère tmdbId).
 * @param {Object} item - Item DagzFlix, Jellyfin ou TMDB
 * @returns {string|null} ID normalisé
 */
export function contentIdFromItem(item) {
  return normalizeContentId(item?.tmdbId || item?.id || item?.Id);
}

/**
 * Récupère un item Jellyfin par son ID avec les champs demandés.
 * @param {Object} config - Configuration DagzFlix (jellyfinUrl)
 * @param {Object} session - Session active (jellyfinUserId, jellyfinToken)
 * @param {string} itemId - ID Jellyfin de l'item
 * @param {string} [fields=''] - Champs Jellyfin supplémentaires (ex: 'ProviderIds,Overview')
 * @returns {Promise<Object|null>} Item Jellyfin brut ou null si non trouvé
 */
export async function fetchJellyfinItemById(config, session, itemId, fields = '') {
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
export async function resolveTmdbId(config, session, { tmdbId, itemId }) {
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

// ═══ Cache en mémoire pour getLocalTmdbIds (V0.008.1 Mission 2) ═══
// Évite de demander Limit=10000 à Jellyfin sur chaque requête discover/search
let _localTmdbIdsCache = null;
let _localTmdbIdsCacheTime = 0;
const LOCAL_TMDB_IDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Récupère tous les IDs TMDB de la bibliothèque locale Jellyfin d'un utilisateur.
 * Retourne un Map<tmdbId, jellyfinId> pour pouvoir résoudre l'ID local.
 * Pour la rétrocompatibilité, le Map possède aussi .has() comme un Set.
 * @param {Object} config - Configuration DagzFlix (jellyfinUrl)
 * @param {Object} session - Session active (jellyfinUserId, jellyfinToken)
 * @returns {Promise<Map<string, string>>} Map(tmdbId → jellyfinId) des items locaux
 */
export async function getLocalTmdbIds(config, session) {
  try {
    // V0.008.1 : Retourner le cache si frais (< 5 min)
    if (_localTmdbIdsCache && (Date.now() - _localTmdbIdsCacheTime < LOCAL_TMDB_IDS_CACHE_TTL)) {
      return _localTmdbIdsCache;
    }

    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds&Limit=10000`, {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error('[getLocalTmdbIds] Jellyfin responded with', res.status);
      // Si on a un ancien cache, le réutiliser plutôt que de retourner vide
      return _localTmdbIdsCache || new Map();
    }
    const data = await res.json();
    const map = new Map();
    for (const i of (data.Items || [])) {
      const tmdbId = extractTmdbId(i.ProviderIds || {});
      if (tmdbId) map.set(String(tmdbId), i.Id);
    }
    console.log(`[getLocalTmdbIds] Mapped ${map.size} local items (scanned ${(data.Items || []).length}) — cached for 5 min`);

    // Peupler le cache
    _localTmdbIdsCache = map;
    _localTmdbIdsCacheTime = Date.now();

    return map;
  } catch (err) {
    console.error('[getLocalTmdbIds] failed:', err.message);
    // Fallback : retourner l'ancien cache s'il existe, sinon Map vide
    return _localTmdbIdsCache || new Map();
  }
}

/**
 * Récupère le profil utilisateur depuis la collection `users`.
 * Retourne le rôle (admin, adult, child) et la limite d'âge.
 * @param {string} userId - ID Jellyfin de l'utilisateur
 * @returns {Promise<Object>} {userId, role: 'admin'|'adult'|'child', maxRating: string}
 */
export async function getUserProfile(userId) {
  const db = await getDb();
  const user = await db.collection('users').findOne({ userId });
  return user || { userId, role: 'adult', maxRating: '' };
}

/**
 * Injecte le statut favori (`isFavorite: true`) dans un tableau d'items
 * en interrogeant la collection `favorites` MongoDB pour l'utilisateur donné.
 * @param {Object[]} items - Tableau d'items mappés (tmdbId ou id)
 * @param {string} userId - ID utilisateur DagzFlix
 * @returns {Promise<Object[]>} Items enrichis avec `isFavorite`
 */
export async function injectFavoriteStatus(items, userId) {
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
 * Vérifie si la durée d'un item correspond au filtre de durée du Wizard.
 * @param {number} runtimeMinutes - Durée en minutes (0 = match toujours)
 * @param {string} duration - Filtre : 'short' (≤120min), 'medium' (45-180min), 'long' (≥70min)
 * @returns {boolean} true si l'item correspond au filtre
 */
export function matchesRuntimeLoose(runtimeMinutes, duration) {
  if (!runtimeMinutes || runtimeMinutes <= 0) return true;
  if (duration === 'short') return runtimeMinutes <= 120;
  if (duration === 'medium') return runtimeMinutes >= 45 && runtimeMinutes <= 180;
  if (duration === 'long') return runtimeMinutes >= 70;
  return true;
}

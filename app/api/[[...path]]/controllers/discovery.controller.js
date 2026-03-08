/**
 * controllers/discovery.controller.js — Recherche, discover, recommandations, wizard.
 *
 * handleSearch, handleDiscover, handleRecommendations, handleWizardDiscover.
 */
import { getDb } from '@/lib/db';
import { jsonResponse, getConfig } from '@/lib/api-utils';
import { getSession } from '@/lib/auth-helpers';
import {
  mapTmdbItem, mapJellyfinItem, resolveGenres,
  getLocalTmdbIds, getUserProfile, injectFavoriteStatus,
  normalizeContentId, contentIdFromItem, matchesRuntimeLoose,
  TMDB_GENRE_NAME_TO_ID,
} from '@/lib/media-mappers';
import {
  applyParentalFilter, calculateDagzRank, loadTelemetryData,
} from '@/lib/dagzrank';

/**
 * GET /api/search?q={query}&page={1}&mediaType={movie|tv}
 */
export async function handleSearch(req) {
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
 */
export async function handleDiscover(req) {
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

    const queryParams = new URLSearchParams({
      page: page,
      sortBy: 'popularity.desc',
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

    let allItems = (data.results || []).map(item => mapTmdbItem(item, type === 'tv'));
    const totalPages = data.totalPages || 1;

    // Cross-référence locale (non-destructrice)
    try {
      const localTmdbIds = await getLocalTmdbIds(config, session);
      if (localTmdbIds && localTmdbIds.size > 0) {
        allItems = allItems.map(mapped => {
          const tmdbStr = mapped.tmdbId ? String(mapped.tmdbId) : null;
          if (tmdbStr && localTmdbIds.has(tmdbStr)) {
            mapped.mediaStatus = 5;
            mapped.localId = localTmdbIds.get(tmdbStr) || undefined;
          }
          return mapped;
        });
      }
    } catch (e) { console.error('[handleDiscover] localTmdbIds failed, skipping cross-ref:', e.message); }

    // Filtre parental (non-destructeur)
    try {
      const userProfile = await getUserProfile(session.userId).catch(() => null);
      const filtered = applyParentalFilter(allItems, userProfile);
      if (filtered && filtered.length > 0) {
        allItems = filtered;
      }
    } catch (e) { console.error('[handleDiscover] parental filter failed, returning unfiltered:', e.message); }

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
 */
export async function handleRecommendations(req) {
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
 *
 * Algorithme du Magicien V2 — Recommandations personnalisées MongoDB-first.
 *
 * Étapes :
 *  1. Profilage : récupère favoris, notes (ratings), télémétrie, préférences
 *     depuis MongoDB pour dresser un profil de genres pondéré.
 *  2. Corrélation mood : croise les genres du profil avec le mood sélectionné.
 *  3. Requête TMDB ciblée : utilise with_genres du profil pour obtenir des items
 *     réellement alignés sur les goûts, au lieu de tendances génériques.
 *  4. Cross-ref Jellyfin : priorise les items PAS encore dans la bibliothèque
 *     locale (pour inciter à les "Demander").
 *  5. Scoring DagzRank + mood bonus + profil bonus.
 *  6. Retourne perfectMatch + alternatives triés par pertinence.
 */
export async function handleWizardDiscover(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  if (!config?.jellyseerrUrl) return jsonResponse({ perfectMatch: null, alternatives: [] });

  const { mood, era, duration, mediaType, excludeIds = [] } = await req.json();
  const db = await getDb();
  const isTv = mediaType === 'tv';
  const endpoint = isTv ? 'tv' : 'movies';

  // ═══ 1. PROFILAGE MONGODB ═══
  // Préférences utilisateur (favoriteGenres, dislikedGenres...)
  const prefs = await db.collection('preferences').findOne({ userId: session.userId }).catch(() => null);

  // Favoris : récupère les items mis en favoris pour extraire leurs genres
  const favorites = await db.collection('favorites')
    .find({ userId: session.userId })
    .sort({ addedAt: -1 })
    .limit(50)
    .toArray()
    .catch(() => []);

  // Notes : récupère les items notés 4+ pour extraire les genres appréciés
  const topRatings = await db.collection('ratings')
    .find({ userId: session.userId, value: { $gte: 4 } })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray()
    .catch(() => []);

  // Télémétrie : clics récents pour détecter les centres d'intérêt
  const recentClicks = await db.collection('telemetry')
    .find({ userId: session.userId, action: 'click' })
    .sort({ timestamp: -1 })
    .limit(30)
    .toArray()
    .catch(() => []);

  // ═══ 2. CONSTRUCTION DU PROFIL DE GENRES PONDÉRÉ ═══
  const genreWeights = {};

  const addGenres = (genres, weight) => {
    for (const g of (genres || [])) {
      const key = g.toLowerCase().trim();
      if (!key) continue;
      genreWeights[key] = (genreWeights[key] || 0) + weight;
    }
  };

  // Genres des préférences explicites (poids élevé)
  addGenres(prefs?.favoriteGenres || [], 5);

  // Genres des favoris (poids fort)
  for (const fav of favorites) {
    const itemData = fav.itemData || {};
    addGenres(itemData.genres || resolveGenres(itemData), 3);
  }

  // Genres des items bien notés (poids moyen-fort)
  for (const rat of topRatings) {
    addGenres(rat.genres || [], rat.value >= 5 ? 4 : 2);
  }

  // Genres des clics récents (poids faible, signal d'intérêt)
  for (const click of recentClicks) {
    addGenres(click.genres || [], 1);
  }

  // Pénaliser les genres détestés
  for (const g of (prefs?.dislikedGenres || [])) {
    const key = g.toLowerCase().trim();
    if (key) genreWeights[key] = (genreWeights[key] || 0) - 10;
  }

  // ═══ 3. CORRÉLATION MOOD → GENRES ═══
  const moodGenreMap = {
    fun: ['comedy', 'family', 'animation'],
    love: ['romance', 'drama'],
    adrenaline: ['action', 'thriller', 'adventure', 'crime'],
    dark: ['thriller', 'horror', 'mystery', 'crime'],
    cinema: ['adventure', 'science fiction', 'drama', 'action'],
  };
  const moodGenres = moodGenreMap[mood] || [];

  // Boost les genres liés au mood dans le profil
  for (const g of moodGenres) {
    genreWeights[g] = (genreWeights[g] || 0) + 3;
  }

  // Trier les genres par poids pour obtenir les top genres du profil
  const sortedGenres = Object.entries(genreWeights)
    .filter(([, w]) => w > 0)
    .sort(([, a], [, b]) => b - a);

  // Prendre les 3 genres les plus forts pour la requête TMDB
  const topProfileGenres = sortedGenres.slice(0, 3).map(([g]) => g);

  // Résoudre les IDs TMDB pour les genres du profil
  const tmdbGenreIds = topProfileGenres
    .map(g => TMDB_GENRE_NAME_TO_ID[g])
    .filter(Boolean);

  // ═══ 4. REQUÊTE TMDB CIBLÉE (multi-pages si besoin) ═══
  let allMapped = [];
  const pagesToFetch = tmdbGenreIds.length > 0 ? 3 : 2;

  for (let page = 1; page <= pagesToFetch; page++) {
    try {
      const params = new URLSearchParams({
        page: String(page),
        sortBy: 'vote_count.desc',
      });
      // Injecter les genres du profil dans la requête TMDB
      if (tmdbGenreIds.length > 0) {
        params.set('with_genres', tmdbGenreIds.join(','));
      }

      const res = await fetch(
        `${config.jellyseerrUrl}/api/v1/discover/${endpoint}?${params.toString()}`,
        {
          headers: { 'X-Api-Key': config.jellyseerrApiKey },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();

      const mapped = (data.results || []).map(item => {
        const runtime = isTv
          ? (item.episodeRunTime && item.episodeRunTime[0]) || 0
          : item.runtime || 0;
        return { ...mapTmdbItem(item, isTv), runtime };
      });
      allMapped.push(...mapped);
    } catch { /* continue */ }
  }

  // Dédupliquage par tmdbId
  const seenIds = new Set();
  allMapped = allMapped.filter(item => {
    const key = String(item.tmdbId || item.id);
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });

  // ═══ 5. CROSS-REF JELLYFIN (priorise les non-locaux) ═══
  let localTmdbIds = null;
  try {
    localTmdbIds = await getLocalTmdbIds(config, session);
  } catch { /* ignore */ }

  // Annoter chaque item avec son statut local
  allMapped = allMapped.map(item => {
    const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
    const isLocal = tmdbStr && localTmdbIds?.has(tmdbStr);
    return {
      ...item,
      mediaStatus: isLocal ? 5 : (item.mediaStatus || 0),
      localId: isLocal ? (localTmdbIds.get(tmdbStr) || undefined) : undefined,
      _isLocal: !!isLocal, // flag interne pour le scoring
    };
  });

  // ═══ 6. FILTRES ERA & DURATION ═══
  const eraPredicate = (yearStr) => {
    const year = parseInt(yearStr || '0', 10);
    if (!year) return true;
    if (era === 'modern') return year >= 2015;
    if (era === 'classic2000') return year >= 2000 && year <= 2014;
    if (era === 'retro') return year < 2000;
    return true;
  };

  const filteredRuntime = allMapped.filter(item => matchesRuntimeLoose(item.runtime, duration));
  const runtimePool = filteredRuntime.length > 0 ? filteredRuntime : allMapped;
  const filteredEra = runtimePool.filter(item => eraPredicate(item.year));
  const pool = filteredEra.length > 0 ? filteredEra : runtimePool;

  // Exclure les IDs rejetés (explicites + prefs)
  const explicitExcludes = (excludeIds || []).map(normalizeContentId).filter(Boolean);
  const rejectionExcludes = (prefs?.rejectedContentIds || []).map(normalizeContentId).filter(Boolean);
  const globalExcludes = new Set([...explicitExcludes, ...rejectionExcludes]);

  const filteredPool = pool.filter(item => !globalExcludes.has(contentIdFromItem(item)));
  const effectivePool = filteredPool.length > 0 ? filteredPool : pool;

  // ═══ 7. SCORING DAGZRANK + BONUS PROFIL + BONUS NON-LOCAL ═══
  const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));

  const ranked = effectivePool
    .map(item => {
      const base = calculateDagzRank(item, prefs || null, [], telemetryData);

      // Bonus mood (genres qui matchent le mood sélectionné)
      const itemGenres = resolveGenres(item).map(g => g.toLowerCase());
      const moodOverlap = itemGenres.filter(g => moodGenres.includes(g)).length;
      const moodBonus = moodOverlap > 0 ? Math.min(15, moodOverlap * 6) : 0;

      // Bonus profil (genres qui matchent le profil pondéré MongoDB)
      let profileBonus = 0;
      for (const g of itemGenres) {
        if (genreWeights[g] > 0) {
          profileBonus += Math.min(5, genreWeights[g]);
        }
      }
      profileBonus = Math.min(15, profileBonus);

      // Bonus non-local : +8 pts pour les items à "Demander" (pas encore sur Jellyfin)
      const notLocalBonus = item._isLocal ? 0 : 8;

      const finalScore = Math.min(100, base + moodBonus + profileBonus + notLocalBonus);

      // Nettoyer le flag interne
      const { _isLocal, ...cleanItem } = item;
      return { ...cleanItem, dagzRank: finalScore };
    })
    .sort((a, b) => b.dagzRank - a.dagzRank);

  // ═══ 8. SÉLECTION FINALE ═══
  const topWindow = ranked.slice(0, Math.min(8, ranked.length));
  const picked = topWindow.length > 0
    ? topWindow[Math.floor(Math.random() * topWindow.length)]
    : null;

  const alternatives = ranked
    .filter(item => !picked || (item.id !== picked.id && item.tmdbId !== picked.tmdbId))
    .slice(0, 12);

  return jsonResponse({
    perfectMatch: picked,
    alternatives,
    count: ranked.length,
    _debug: {
      profileGenres: topProfileGenres,
      totalCandidates: allMapped.length,
      afterFilters: effectivePool.length,
    },
  });
}

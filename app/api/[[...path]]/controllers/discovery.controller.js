/**
 * controllers/discovery.controller.js
 * Gère les recherches, la découverte et l'algorithme du Magicien.
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

    const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));
    const userProfile = await getUserProfile(session.userId).catch(() => null);
    const localTmdbIds = await getLocalTmdbIds(config, session);

    function scoreResults(items) {
      let filtered = items;
      try { filtered = applyParentalFilter(items, userProfile); } catch (e) {}
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
        const res = await fetch(`${config.jellyseerrUrl}/api/v1/search?query=${encodeURIComponent(query)}&page=${page}`, { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const data = await res.json();
          let mapped = (data.results || []).map(item => mapTmdbItem(item));
          
          if (mediaType === 'movie') mapped = mapped.filter(i => i.type === 'Movie');
          else if (mediaType === 'tv') mapped = mapped.filter(i => i.type === 'Series');
          else mapped = mapped.filter(i => i.type === 'Movie' || i.type === 'Series'); 

          let scored = scoreResults(mapped);
          scored = await injectFavoriteStatus(scored, session.userId);
          return jsonResponse({ results: scored, totalPages: data.totalPages || 1, totalResults: mapped.length });
        }
      } catch (e) {}
    }

    const jfParams = new URLSearchParams({ SearchTerm: query, Recursive: 'true', Limit: '20', Fields: 'Overview,Genres,CommunityRating,ProviderIds,Studios' });
    if (mediaType === 'movie') jfParams.set('IncludeItemTypes', 'Movie');
    else if (mediaType === 'tv') jfParams.set('IncludeItemTypes', 'Series');

    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?${jfParams.toString()}`, { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return jsonResponse({ results: [], totalResults: 0 });
    
    const data = await res.json();
    let jfScored = scoreResults((data.Items || []).map(item => ({ ...mapJellyfinItem(item), mediaStatus: 5 })));
    jfScored = await injectFavoriteStatus(jfScored, session.userId);

    return jsonResponse({ results: jfScored, totalResults: data.TotalRecordCount || 0 });
  } catch (err) {
    return jsonResponse({ results: [], totalResults: 0 });
  }
}

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

    const queryParams = new URLSearchParams({ page: page, sortBy: 'popularity.desc' });

    if (genre) {
      const genreLower = genre.toLowerCase();
      const genreId = TMDB_GENRE_NAME_TO_ID[genreLower];
      if (genreId) queryParams.set('with_genres', String(genreId));
      else {
        const match = Object.entries(TMDB_GENRE_NAME_TO_ID).find(([name]) => name.includes(genreLower) || genreLower.includes(name));
        if (match) queryParams.set('with_genres', String(match[1]));
      }
    }
    if (studio) queryParams.set('with_companies', studio);

    const res = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${endpoint}?${queryParams.toString()}`, { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return jsonResponse({ results: [], totalPages: 0 });
    
    const data = await res.json();
    let allItems = (data.results || []).map(item => mapTmdbItem(item, type === 'tv'));
    const totalPages = data.totalPages || 1;

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
    } catch (e) {}

    try {
      const userProfile = await getUserProfile(session.userId).catch(() => null);
      const filtered = applyParentalFilter(allItems, userProfile);
      if (filtered && filtered.length > 0) allItems = filtered;
    } catch (e) {}

    try { allItems = await injectFavoriteStatus(allItems, session.userId); } catch (e) {}

    return jsonResponse({ results: allItems, totalPages });
  } catch (err) {
    return jsonResponse({ results: [], totalPages: 0 });
  }
}

export async function handleRecommendations(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    const db = await getDb();
    const prefs = await db.collection('preferences').findOne({ userId: session.userId }).catch(() => null);

    let watchHistory = [];
    try {
      const histRes = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?IsPlayed=true&Recursive=true&Limit=100&Fields=Genres&SortBy=DatePlayed&SortOrder=Descending`, { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(45000) });
      if (histRes.ok) {
        const histData = await histRes.json();
        watchHistory = (histData.Items || []).map(i => ({ id: i.Id, genres: i.Genres || [] }));
      }
    } catch (_) {}

    let jellyfinItems = [];
    try {
      const mediaRes = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?Recursive=true&Limit=100&IncludeItemTypes=Movie,Series&Fields=Overview,Genres,CommunityRating,PremiereDate&SortBy=Random`, { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(45000) });
      if (mediaRes.ok) {
        const mediaData = await mediaRes.json();
        jellyfinItems = (mediaData.Items || []).map(item => ({ ...mapJellyfinItem(item), source: 'jellyfin' }));
      }
    } catch (_) {}

    let jellyseerrItems = [];
    if (config.jellyseerrUrl) {
      for (const discoverType of ['movies', 'tv']) {
        try {
          const discRes = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${discoverType}?page=1`, { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(30000) });
          if (discRes.ok) {
            const discData = await discRes.json();
            jellyseerrItems.push(...(discData.results || []).map(item => ({ ...mapTmdbItem(item, discoverType === 'tv'), id: `tmdb-${item.id}`, isPlayed: false, source: 'jellyseerr' })));
          }
        } catch (_) {}
      }
    }

    const seen = new Set();
    const merged = [];
    for (const item of [...jellyfinItems, ...jellyseerrItems]) {
      const key = `${item.name || ''}`.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key); merged.push(item);
    }

    const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));
    const userProfile = await getUserProfile(session.userId).catch(() => null);

    let filtered = merged;
    try { filtered = applyParentalFilter(merged, userProfile); } catch (e) {}

    const scored = filtered.map(item => ({ ...item, dagzRank: calculateDagzRank(item, prefs, watchHistory, telemetryData) })).sort((a, b) => b.dagzRank - a.dagzRank);

    let topRecs = scored.slice(0, 25);
    try { topRecs = await injectFavoriteStatus(topRecs, session.userId); } catch (e) {}

    return jsonResponse({ recommendations: topRecs, totalScored: scored.length, sources: { jellyfin: jellyfinItems.length, jellyseerr: jellyseerrItems.length } });
  } catch (err) {
    return jsonResponse({ recommendations: [], totalScored: 0, sources: { jellyfin: 0, jellyseerr: 0 } });
  }
}

// 🧙‍♂️ MAGICIEN CORRIGÉ AVEC FILETS DE SÉCURITÉ
export async function handleWizardDiscover(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  if (!config?.jellyseerrUrl) return jsonResponse({ perfectMatch: null, alternatives: [] });

  const { mood, era, duration, mediaType, excludeIds = [] } = await req.json();
  const db = await getDb();
  const isTv = mediaType === 'tv';
  const endpoint = isTv ? 'tv' : 'movies';

  const prefs = await db.collection('preferences').findOne({ userId: session.userId }).catch(() => null);
  const favorites = await db.collection('favorites').find({ userId: session.userId }).sort({ addedAt: -1 }).limit(50).toArray().catch(() => []);
  const topRatings = await db.collection('ratings').find({ userId: session.userId, value: { $gte: 4 } }).sort({ timestamp: -1 }).limit(50).toArray().catch(() => []);
  const recentClicks = await db.collection('telemetry').find({ userId: session.userId, action: 'click' }).sort({ timestamp: -1 }).limit(30).toArray().catch(() => []);

  const genreWeights = {};
  const addGenres = (genres, weight) => {
    for (const g of (genres || [])) {
      const key = g.toLowerCase().trim();
      if (!key) continue;
      genreWeights[key] = (genreWeights[key] || 0) + weight;
    }
  };

  addGenres(prefs?.favoriteGenres || [], 5);
  for (const fav of favorites) { addGenres(fav.itemData?.genres || resolveGenres(fav.itemData || {}), 3); }
  for (const rat of topRatings) { addGenres(rat.genres || [], rat.value >= 5 ? 4 : 2); }
  for (const click of recentClicks) { addGenres(click.genres || [], 1); }
  for (const g of (prefs?.dislikedGenres || [])) {
    const key = g.toLowerCase().trim();
    if (key) genreWeights[key] = (genreWeights[key] || 0) - 10;
  }

  const moodGenreMap = {
    fun: ['comedy', 'family', 'animation'],
    love: ['romance', 'drama'],
    adrenaline: ['action', 'thriller', 'adventure', 'crime'],
    dark: ['thriller', 'horror', 'mystery', 'crime'],
    cinema: ['adventure', 'science fiction', 'drama', 'action'],
  };
  const moodGenres = moodGenreMap[mood] || [];
  for (const g of moodGenres) { genreWeights[g] = (genreWeights[g] || 0) + 3; }

  const sortedGenres = Object.entries(genreWeights).filter(([, w]) => w > 0).sort(([, a], [, b]) => b - a);
  const topProfileGenres = sortedGenres.slice(0, 3).map(([g]) => g);
  const tmdbGenreIds = topProfileGenres.map(g => TMDB_GENRE_NAME_TO_ID?.[g]).filter(Boolean);

  let allMapped = [];
  const pagesToFetch = tmdbGenreIds.length > 0 ? 3 : 2;

  // 1ère tentative : Recherche hyper-ciblée avec Seerr
  for (let page = 1; page <= pagesToFetch; page++) {
    try {
      const params = new URLSearchParams({ page: String(page), sortBy: 'vote_count.desc' });
      if (tmdbGenreIds.length > 0) params.set('with_genres', tmdbGenreIds.join(','));

      const res = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${endpoint}?${params.toString()}`, { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();

      const mapped = (data.results || []).map(item => {
        const runtime = isTv ? (item.episodeRunTime && item.episodeRunTime[0]) || 0 : item.runtime || 0;
        return { ...mapTmdbItem(item, isTv), runtime };
      });
      allMapped.push(...mapped);
    } catch {}
  }

  // 🚨 FILET DE SÉCURITÉ 1 : Si la recherche de genre foire, on prend du populaire
  if (allMapped.length === 0) {
    try {
      const backupRes = await fetch(`${config.jellyseerrUrl}/api/v1/discover/${endpoint}?page=1&sortBy=popularity.desc`, { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(10000) });
      if (backupRes.ok) {
        const backupData = await backupRes.json();
        allMapped = (backupData.results || []).map(item => ({ ...mapTmdbItem(item, isTv), runtime: isTv ? (item.episodeRunTime?.[0]||0) : (item.runtime||0) }));
      }
    } catch {}
  }

  // 🚨 FILET DE SÉCURITÉ 2 : Si Seerr est KO, on interroge ton Jellyfin local directement
  if (allMapped.length === 0) {
    try {
      const jfParams = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: isTv ? 'Series' : 'Movie', SortBy: 'Random', Limit: '30', Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProviderIds' });
      const jfRes = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?${jfParams.toString()}`, { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(10000) });
      if (jfRes.ok) {
        const jfData = await jfRes.json();
        allMapped = (jfData.Items || []).map(item => ({ ...mapJellyfinItem(item), _isLocal: true, mediaStatus: 5 }));
      }
    } catch {}
  }

  const seenIds = new Set();
  allMapped = allMapped.filter(item => {
    const key = String(item.tmdbId || item.id);
    if (seenIds.has(key)) return false;
    seenIds.add(key); return true;
  });

  let localTmdbIds = null;
  try { localTmdbIds = await getLocalTmdbIds(config, session); } catch {}

  allMapped = allMapped.map(item => {
    const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
    const isLocal = item._isLocal || (tmdbStr && localTmdbIds?.has(tmdbStr));
    return { ...item, mediaStatus: isLocal ? 5 : (item.mediaStatus || 0), localId: isLocal ? (localTmdbIds?.get(tmdbStr) || item.localId || undefined) : undefined, _isLocal: !!isLocal };
  });

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

  const explicitExcludes = (excludeIds || []).map(normalizeContentId).filter(Boolean);
  const rejectionExcludes = (prefs?.rejectedContentIds || []).map(normalizeContentId).filter(Boolean);
  const globalExcludes = new Set([...explicitExcludes, ...rejectionExcludes]);

  const filteredPool = pool.filter(item => !globalExcludes.has(contentIdFromItem(item)));
  const effectivePool = filteredPool.length > 0 ? filteredPool : pool;

  const telemetryData = await loadTelemetryData(session.userId).catch(() => ({ userEvents: [], globalRatings: {} }));

  const ranked = effectivePool.map(item => {
    const base = calculateDagzRank(item, prefs || null, [], telemetryData);
    const itemGenres = resolveGenres(item).map(g => g.toLowerCase());
    const moodOverlap = itemGenres.filter(g => moodGenres.includes(g)).length;
    const moodBonus = moodOverlap > 0 ? Math.min(15, moodOverlap * 6) : 0;

    let profileBonus = 0;
    for (const g of itemGenres) { if (genreWeights[g] > 0) profileBonus += Math.min(5, genreWeights[g]); }
    profileBonus = Math.min(15, profileBonus);

    const notLocalBonus = item._isLocal ? 0 : 8;
    const finalScore = Math.min(100, base + moodBonus + profileBonus + notLocalBonus);
    const { _isLocal, ...cleanItem } = item;
    return { ...cleanItem, dagzRank: finalScore };
  }).sort((a, b) => b.dagzRank - a.dagzRank);

  const topWindow = ranked.slice(0, Math.min(8, ranked.length));
  const picked = topWindow.length > 0 ? topWindow[Math.floor(Math.random() * topWindow.length)] : null;
  const alternatives = ranked.filter(item => !picked || (item.id !== picked.id && item.tmdbId !== picked.tmdbId)).slice(0, 12);

  return jsonResponse({ perfectMatch: picked, alternatives, count: ranked.length });
}
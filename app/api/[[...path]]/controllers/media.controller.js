/**
 * controllers/media.controller.js — Média : détail, stream, status, épisodes, etc.
 *
 * handleMediaDetail, handleStream, handleMediaStatus, handleNextEpisode,
 * handlePersonDetail, handleMediaLibrary, handleMediaGenres, handleMediaResume,
 * handleMediaSeasons, handleMediaEpisodes, handleMediaTrailer, handleMediaCollection,
 * handleMediaRequest, handleMediaProgress, handleProxyImage, handleProxyTmdb.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db';
import { jsonResponse, getConfig, ALLOWED_ORIGIN } from '@/lib/api-utils';
import { getSession } from '@/lib/auth-helpers';
import {
  mapTmdbItem, mapJellyfinItem, resolveGenres, extractTmdbId,
  fetchJellyfinItemById, resolveTmdbId, getLocalTmdbIds,
  getUserProfile, injectFavoriteStatus,
} from '@/lib/media-mappers';
import { applyParentalFilter } from '@/lib/dagzrank';

/**
 * GET /api/media/library
 */
export async function handleMediaLibrary(req) {
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
      if (res.status === 401) return jsonResponse({ error: 'Token Jellyfin expiré' }, 401);
      return jsonResponse({ items: [], totalCount: 0, error: `Jellyfin ${res.status}` });
    }
    const data = await res.json();

    let allItems = (data.Items || []).map(mapJellyfinItem);
    const totalCount = data.TotalRecordCount || 0;

    try {
      const userProfile = await getUserProfile(session.userId).catch(() => null);
      allItems = applyParentalFilter(allItems, userProfile);
    } catch (e) { console.error('[handleMediaLibrary] parental filter failed, returning unfiltered:', e.message); }

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
 */
export async function handleMediaGenres(req) {
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
 */
export async function handlePersonDetail(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const personId = new URL(req.url).searchParams.get('id');
  if (!personId) return jsonResponse({ error: 'ID requis' }, 400);

  const isNumericId = /^\d+$/.test(personId);

  // ── 1. AGGRÉGATEUR SEERR (Résiste aux changements de l'API) ──
  const fetchSeerrPerson = async (id) => {
    let mergedData = {};
    if (!config.jellyseerrUrl) return mergedData;

    try {
      const headers = { 'X-Api-Key': config.jellyseerrApiKey };
      const urls = [
        `${config.jellyseerrUrl}/api/v1/person/${id}?language=fr`,
        `${config.jellyseerrUrl}/api/v1/person/${id}/combined_credits?language=fr`,
        `${config.jellyseerrUrl}/api/v1/person/${id}/movie_credits?language=fr`,
        `${config.jellyseerrUrl}/api/v1/person/${id}/tv_credits?language=fr`
      ];

      const results = await Promise.allSettled(
        urls.map(u => fetch(u, { headers, signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : {}))
      );

      for (const [index, res] of results.entries()) {
        if (res.status === 'fulfilled' && res.value) {
          if (index === 0) mergedData = { ...mergedData, ...res.value }; // Infos de base de l'acteur
          if (index === 1 && res.value.cast) mergedData.combinedCredits = res.value; 
          if (index === 2 && res.value.cast) mergedData.movieCredits = res.value;
          if (index === 3 && res.value.cast) mergedData.tvCredits = res.value;
        }
      }
    } catch (e) {
      console.error('[DagzFlix] Erreur de communication avec Seerr:', e.message);
    }
    return mergedData;
  };

  // ── 2. EXTRACTEUR UNIVERSEL DE CREDITS ──
  const extractCredits = (data) => {
    const remoteItems = [];
    const seen = new Set();

    const processList = (list, forceTv) => {
      for (const credit of (list || [])) {
        if (!credit.id) continue;
        const tmdbId = String(credit.id);
        const isTv = forceTv ?? ((credit.mediaType || credit.media_type) === 'tv');
        const key = `${tmdbId}_${isTv ? 'tv' : 'movie'}`;
        
        if (seen.has(key)) continue;
        seen.add(key);
        
        remoteItems.push({
          ...mapTmdbItem(credit, isTv),
          role: credit.character || credit.job || '',
        });
      }
    };

    if (data.combinedCredits?.cast?.length > 0 || data.combinedCredits?.crew?.length > 0) {
      processList(data.combinedCredits.cast, null);
      processList(data.combinedCredits.crew, null);
    } else {
      if (data.movieCredits) {
        processList(data.movieCredits.cast, false);
        processList(data.movieCredits.crew, false);
      }
      if (data.tvCredits) {
        processList(data.tvCredits.cast, true);
        processList(data.tvCredits.crew, true);
      }
      if (data.credits) {
        processList(data.credits.cast, null);
        processList(data.credits.crew, null);
      }
    }
    return remoteItems;
  };

  // ── CHEMIN 1 : ID TMDB (Numérique) ──
  if (isNumericId) {
    if (!config.jellyseerrUrl) return jsonResponse({ error: 'Seerr non configuré' }, 400);

    const seerrData = await fetchSeerrPerson(personId);
    let personInfo = {
      id: personId,
      name: seerrData.name || '',
      overview: seerrData.biography || '',
      birthDate: seerrData.birthday || '',
      photoUrl: seerrData.profilePath ? `/api/proxy/tmdb?path=${seerrData.profilePath}&width=w400` : '',
      tmdbId: personId,
    };
    let remoteItems = extractCredits(seerrData);

    if (remoteItems.length > 0) {
      try {
        const localTmdbIds = await getLocalTmdbIds(config, session);
        remoteItems = remoteItems.map(item => {
          const tmdbStr = item.tmdbId ? String(item.tmdbId) : null;
          const isLocal = tmdbStr && localTmdbIds.has(tmdbStr);
          return { ...item, mediaStatus: isLocal ? 5 : (item.mediaStatus || 0), localId: isLocal ? localTmdbIds.get(tmdbStr) : undefined };
        });
      } catch (_) { }
    }

    remoteItems.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
    return jsonResponse({ person: personInfo, items: remoteItems });
  }

  // ── CHEMIN 2 : ID UUID (Venant de Jellyfin) ──
  let person = null;
  try {
    const personRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${personId}?Fields=ProviderIds,Overview,PremiereDate`,
      { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(30000) }
    );
    if (personRes.ok) person = await personRes.json();
  } catch (e) {
    console.error('[DagzFlix] Jellyfin person details failed:', e.message);
  }

  if (!person) return jsonResponse({ error: 'Personne introuvable sur Jellyfin' }, 404);

  let localItemsMap = new Map();
  try {
    const localItemsRes = await fetch(
      `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items?PersonIds=${personId}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=Overview,ProviderIds,CommunityRating,OfficialRating,PremiereDate,RunTimeTicks,MediaSources`,
      { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(15000) }
    );
    if (localItemsRes.ok) {
      const localData = await localItemsRes.json();
      (localData.Items || []).forEach(item => {
        const mapped = mapJellyfinItem(item);
        if (mapped.tmdbId) localItemsMap.set(String(mapped.tmdbId), mapped);
        else localItemsMap.set(String(mapped.id), mapped);
      });
    }
  } catch (e) { }

  let tmdbPersonId = extractTmdbId(person.ProviderIds || {});
  
  if (!tmdbPersonId && config.jellyseerrUrl) {
    try {
      const nameSearchRes = await fetch(
        `${config.jellyseerrUrl}/api/v1/search?query=${encodeURIComponent(person.Name)}&page=1&language=fr`,
        { headers: { 'X-Api-Key': config.jellyseerrApiKey }, signal: AbortSignal.timeout(15000) }
      );
      if (nameSearchRes.ok) {
        const nameSearchData = await nameSearchRes.json();
        const personResult = (nameSearchData.results || []).find(r => r.mediaType === 'person');
        if (personResult) tmdbPersonId = String(personResult.id);
      }
    } catch (e) { }
  }

  let personInfo = {
    id: person.Id,
    name: person.Name,
    overview: person.Overview || '',
    birthDate: person.PremiereDate || '',
    photoUrl: `/api/proxy/image?itemId=${person.Id}&type=Primary&maxWidth=400`,
    tmdbId: tmdbPersonId || null,
  };

  let allItems = Array.from(localItemsMap.values());

  if (tmdbPersonId && config.jellyseerrUrl) {
    const seerrData = await fetchSeerrPerson(tmdbPersonId);
    
    personInfo.name = seerrData.name || personInfo.name;
    personInfo.overview = seerrData.biography || personInfo.overview;
    personInfo.birthDate = seerrData.birthday || personInfo.birthDate;
    if (seerrData.profilePath) personInfo.photoUrl = `/api/proxy/tmdb?path=${seerrData.profilePath}&width=w400`;

    const remoteCredits = extractCredits(seerrData);
    const localTmdbIds = await getLocalTmdbIds(config, session).catch(() => new Map());
    
    for (const remoteItem of remoteCredits) {
      const tmdbStr = remoteItem.tmdbId ? String(remoteItem.tmdbId) : null;
      if (tmdbStr && localItemsMap.has(tmdbStr)) continue;
      
      const isLocal = tmdbStr && localTmdbIds.has(tmdbStr);
      allItems.push({
        ...remoteItem,
        mediaStatus: isLocal ? 5 : (remoteItem.mediaStatus || 0),
        localId: isLocal ? localTmdbIds.get(tmdbStr) : undefined,
      });
    }
  }

  allItems.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));

  return jsonResponse({ person: personInfo, items: allItems });
}

/**
 * GET /api/media/detail?id={itemId}
 */
export async function handleMediaDetail(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  const config = await getConfig();
  const itemId = new URL(req.url).searchParams.get('id');
  if (!itemId) return jsonResponse({ error: 'ID requis' }, 400);

  // 1) Try Jellyfin first (local item)
  let jellyfinItem = null;
  try {
    const res = await fetch(`${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${itemId}?Fields=Overview,Genres,CommunityRating,OfficialRating,PremiereDate,RunTimeTicks,People,ProviderIds,MediaSources,Studios,Taglines,ExternalUrls,HasSubtitles,ChildCount`, {
      headers: { 'X-Emby-Token': session.jellyfinToken },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) jellyfinItem = await res.json();
  } catch (_) { /* Jellyfin fetch failed, try TMDB fallback */ }

  // 2) If Jellyfin found the item, return enriched local data
  if (jellyfinItem) {
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
          // Correction de l'extraction de casting pour éviter les erreurs Seerr
          const rawCredits = credData.credits || credData.mediaInfo?.credits || {};
          const castListRaw = rawCredits.cast || credData.cast || [];
          const crewListRaw = rawCredits.crew || credData.crew || [];

          const castList = castListRaw.slice(0, 15).map(actor => ({
            Id: null,
            tmdbId: actor.id,
            name: actor.name || '',
            role: actor.character || '',
            type: 'Actor',
            photoUrl: actor.profilePath ? `/api/proxy/tmdb?path=${actor.profilePath}&width=w200` : null,
          }));
          
          const crewList = (Array.isArray(crewListRaw) ? crewListRaw : [])
            .filter(c => c.job === 'Director' || c.department === 'Writing')
            .slice(0, 6)
            .map(c => ({
              Id: null,
              tmdbId: c.id,
              name: c.name || '',
              role: c.job || '',
              type: c.job === 'Director' ? 'Director' : 'Writer',
              photoUrl: c.profilePath ? `/api/proxy/tmdb?path=${c.profilePath}&width=w200` : null,
            }));

          if (castList.length > 0 || crewList.length > 0) {
            people = [...castList, ...crewList];
          }
        }
      } catch (_) { /* Keep Jellyfin people as fallback */ }
    }

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
        // Infos séries : ChildCount = nombre de saisons sur Jellyfin
        ...(jellyfinItem.Type === 'Series' && {
          numberOfSeasons: jellyfinItem.ChildCount || 0,
          seasonCount: jellyfinItem.ChildCount || 0,
        }),
      },
    });
  }

  // 3) Fallback: item is a TMDB ID → fetch from Jellyseerr with credits
  if (!config.jellyseerrUrl) {
    return jsonResponse({ error: 'Media introuvable' }, 404);
  }

  const localTmdbIds = await getLocalTmdbIds(config, session);

  const tmdbLookupId = itemId.startsWith('tmdb-') ? itemId.replace('tmdb-', '') : itemId;

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

  // Correction casting pour Seerr Fallback
  const rawCredits = tmdbData.credits || tmdbData.mediaInfo?.credits || {};
  const castListRaw = rawCredits.cast || tmdbData.cast || [];
  const crewListRaw = rawCredits.crew || tmdbData.crew || [];

  const castList = castListRaw.slice(0, 15).map(actor => ({
    Id: null,
    tmdbId: actor.id,
    name: actor.name || '',
    role: actor.character || '',
    type: 'Actor',
    photoUrl: actor.profilePath ? `/api/proxy/tmdb?path=${actor.profilePath}&width=w200` : null,
  }));
  
  const crewList = (Array.isArray(crewListRaw) ? crewListRaw : [])
    .filter(c => c.job === 'Director' || c.department === 'Writing')
    .slice(0, 6)
    .map(c => ({
      Id: null,
      tmdbId: c.id,
      name: c.name || '',
      role: c.job || '',
      type: c.job === 'Director' ? 'Director' : 'Writer',
      photoUrl: c.profilePath ? `/api/proxy/tmdb?path=${c.profilePath}&width=w200` : null,
    }));

  const genres = resolveGenres(tmdbData);

  const tmdbStr = String(tmdbData.id);
  const isLocallyAvailable = localTmdbIds && localTmdbIds.has(tmdbStr);
  const localJellyfinId = isLocallyAvailable ? (localTmdbIds.get(tmdbStr) || undefined) : undefined;

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
      mediaStatus: isLocallyAvailable ? 5 : Math.min(tmdbData.mediaInfo?.status || 0, 4),
      localId: localJellyfinId,
      isFavorite: !!favDoc,
      ...(isTv && {
        numberOfSeasons: tmdbData.numberOfSeasons || tmdbData.number_of_seasons || 0,
        seasonCount: tmdbData.numberOfSeasons || tmdbData.number_of_seasons || 0,
      }),
    },
  });
}

/**
 * GET /api/media/next-episode?seriesId={jellyfinSeriesId}
 */
export async function handleNextEpisode(req) {
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
 * GET /api/media/resume
 */
export async function handleMediaResume(req) {
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
 */
export async function handleMediaSeasons(req) {
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
 */
export async function handleMediaEpisodes(req) {
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
 */
export async function handleMediaTrailer(req) {
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
 */
export async function handleMediaCollection(req) {
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
 */
export async function handleMediaStatus(req) {
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
 */
export async function handleMediaRequest(req) {
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
 */
export async function handleMediaProgress(req) {
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
 */
export async function handleStream(req) {
  const session = await getSession(req);
  if (!session) return jsonResponse({ error: 'Non authentifie' }, 401);

  try {
    const config = await getConfig();
    let itemId = new URL(req.url).searchParams.get('id');
    if (!itemId) return jsonResponse({ error: 'ID requis' }, 400);

    // V7.6: Strip 'tmdb-' prefix if present
    if (itemId.startsWith('tmdb-')) itemId = itemId.replace('tmdb-', '');

    // Resolve TMDB to local ID
    const isLikelyTmdbId = /^\d+$/.test(itemId);
    if (isLikelyTmdbId) {
      try {
        const localTmdbIds = await getLocalTmdbIds(config, session);
        const resolvedId = localTmdbIds ? localTmdbIds.get(String(itemId)) : undefined;
        if (resolvedId) {
          itemId = resolvedId;
        } else {
          return jsonResponse({ error: 'Media non disponible localement', notLocal: true }, 404);
        }
      } catch (resolveErr) {
        return jsonResponse({ error: 'Impossible de résoudre l\'ID local', notLocal: true }, 503);
      }
    }

    // Auto-resolve Series to Next Episode
    try {
      const itemCheck = await fetch(
        `${config.jellyfinUrl}/Users/${session.jellyfinUserId}/Items/${itemId}`,
        { headers: { 'X-Emby-Token': session.jellyfinToken }, signal: AbortSignal.timeout(10000) }
      );
      if (itemCheck.ok) {
        const itemData = await itemCheck.json();
        if (itemData.Type === 'Series') {
          const nextUrl = new URL(req.url);
          nextUrl.searchParams.set('seriesId', itemId);
          const fakeReq = new Request(nextUrl, { headers: req.headers });
          const nextRes = await handleNextEpisode(fakeReq);
          const nextData = await nextRes.json();
          if (nextData.episodeId) {
            itemId = nextData.episodeId;
          } else {
            return jsonResponse({ error: 'Aucun épisode disponible pour cette série' }, 404);
          }
        }
      }
    } catch (checkErr) {
      console.warn('[handleStream] Series check failed:', checkErr.message);
    }

    // Appel PlaybackInfo (OPTIMISÉ SANS MKV EN DIRECT PLAY)
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
            DirectPlayProfiles: [{ Container: 'mp4,m4v,webm,mov', Type: 'Video' }],
            TranscodingProfiles: [
              {
                Container: 'ts',
                Type: 'Video',
                VideoCodec: 'h264,hevc,av1,vp9',
                AudioCodec: 'aac,mp3,ac3,eac3,flac,opus',
                Context: 'Streaming',
                Protocol: 'hls',
                BreakOnNonKeyFrames: true,
                EnableSubtitlesInManifest: true,
              },
            ],
            SubtitleProfiles: [
              { Format: 'vtt', Method: 'External' },
              { Format: 'srt', Method: 'External' },
              { Format: 'ass', Method: 'External' },
              { Format: 'ssa', Method: 'External' },
            ],
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!res.ok) return jsonResponse({ error: 'Playback info failed' }, 404);
    const pb = await res.json();
    const mediaSource = (pb.MediaSources || [])[0];
    const playSessionId = pb.PlaySessionId || uuidv4();
    const streams = mediaSource?.MediaStreams || [];

    // Support multi-audio et sous-titres
    const audioStreamIndexes = streams.filter(s => s.Type === 'Audio').map(s => s.Index).join(',');
    const subtitleStreamIndexes = streams.filter(s => s.Type === 'Subtitle').map(s => s.Index).join(',');
    
    const hlsParams = new URLSearchParams({
      api_key: session.jellyfinToken,
      MediaSourceId: mediaSource?.Id || '',
      PlaySessionId: playSessionId,
      VideoCodec: 'h264,hevc,av1,vp9',
      AudioCodec: 'aac,mp3,ac3,eac3,flac,opus',
      SegmentContainer: 'ts',
      EnableAdaptiveBitrateStreaming: 'true',
      SubtitleMethod: 'Hls',
      EnableAudioTracksInManifest: 'true',
    });
    
    // ON NE LIMITE PLUS L'AUDIOSTREAMINDEX ICI POUR PERMETTRE LE CHANGEMENT DE LANGUE
    if (subtitleStreamIndexes) hlsParams.set('SubtitleStreamIndex', subtitleStreamIndexes.split(',')[0]);
    
    const streamUrl = `${config.jellyfinUrl}/Videos/${itemId}/master.m3u8?${hlsParams.toString()}`;
    const directUrl = `${config.jellyfinUrl}/Videos/${itemId}/stream?Static=true&MediaSourceId=${mediaSource?.Id || ''}&PlaySessionId=${playSessionId}&api_key=${session.jellyfinToken}`;

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
    console.error('[handleStream] Error:', err);
    return jsonResponse({ error: 'Stream unavailable' }, 404);
  }
}

/**
 * GET /api/proxy/image?itemId={id}&type={Primary|Backdrop|Thumb}&maxWidth={400}
 */
export async function handleProxyImage(req) {
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

  const contentType = res.headers.get('content-type') || 'image/jpeg';

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      ...(ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } : {}),
    },
  });
}

/**
 * GET /api/proxy/tmdb?path={/posterPath}&width={w400}
 */
export async function handleProxyTmdb(req) {
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  const width = url.searchParams.get('width') || 'w400';
  if (!path) return new Response('Missing path', { status: 400 });

  const res = await fetch(`https://image.tmdb.org/t/p/${width}${path}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return new Response('Image not found', { status: 404 });

  const contentType = res.headers.get('content-type') || 'image/jpeg';

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      ...(ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } : {}),
    },
  });
}
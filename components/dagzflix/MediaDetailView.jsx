'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft, Clock, Star, Film, Tv, Layers, Sparkles, Clapperboard,
  Subtitles, AudioLines, Play, PlayCircle, Check, User, Building2, Heart
} from 'lucide-react';
import { cachedApi, api, invalidateCache } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pageVariants, GENRE_ICONS } from '@/lib/constants';
import { SmartButton, TrailerButton } from './SmartButton';
import { VideoPlayer } from './VideoPlayer';
import { MediaCard, MediaRow } from './MediaCard';
import { MediaModal } from './MediaModal';

// ─── Star Rating Component ─────────────────────────────────────
function StarRating({ item }) {
  const [userRating, setUserRating] = useState(null);
  const [globalAvg, setGlobalAvg] = useState(null);
  const [totalRatings, setTotalRatings] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [saving, setSaving] = useState(false);

  const contentId = item?.id || item?.tmdbId;

  useEffect(() => {
    if (!contentId) return;
    cachedApi(`media/rating?id=${contentId}`).then(data => {
      if (data.rating) setUserRating(data.rating);
      if (data.globalAverage) setGlobalAvg(data.globalAverage);
      if (data.totalRatings) setTotalRatings(data.totalRatings);
    }).catch(() => { });
  }, [contentId]);

  const submitRating = useCallback(async (value) => {
    if (!contentId || saving) return;
    setSaving(true);
    setUserRating(value);
    try {
      await api('media/rate', {
        method: 'POST',
        body: JSON.stringify({
          itemId: String(contentId),
          value,
          genres: item.genres || [],
        }),
      });
      invalidateCache('media/rating');
      const data = await api(`media/rating?id=${contentId}`);
      if (data.globalAverage) setGlobalAvg(data.globalAverage);
      if (data.totalRatings) setTotalRatings(data.totalRatings);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }, [contentId, item, saving]);

  if (!contentId) return null;

  const activeIdx = hoverIdx >= 0 ? hoverIdx : (userRating ? userRating - 1 : -1);

  return (
    <div className="mb-5 inline-flex items-center gap-3 glass rounded-2xl px-5 py-3">
      <Star className="w-5 h-5 text-amber-400" />
      <div className="flex items-center gap-1" onMouseLeave={() => setHoverIdx(-1)}>
        {[1, 2, 3, 4, 5].map((val, idx) => (
          <motion.button
            key={val}
            onMouseEnter={() => setHoverIdx(idx)}
            onClick={() => submitRating(val)}
            whileHover={{ scale: 1.2 }}
            whileTap={{ scale: 0.85 }}
            className="p-0.5 transition-colors"
            aria-label={`Note ${val}/5`}
          >
            <Star
              className={`w-5 h-5 transition-colors ${idx <= activeIdx
                ? 'text-amber-400 fill-amber-400'
                : 'text-white/15'
                }`}
            />
          </motion.button>
        ))}
      </div>
      {userRating && <span className="text-amber-300 text-sm font-bold">{userRating}/5</span>}
      {globalAvg && (
        <span className="text-white/30 text-xs ml-1">
          (moy. {globalAvg}{totalRatings > 0 ? ` · ${totalRatings} vote${totalRatings > 1 ? 's' : ''}` : ''})
        </span>
      )}
    </div>
  );
}

/* ─── Favorite Button ─────────────────────────────────────────── */
function FavoriteButton({ item }) {
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(false);
  const { status } = useAuth();
  const contentId = item?.id || item?.tmdbId;

  useEffect(() => {
    if (item?.isFavorite !== undefined) {
      setIsFavorite(item.isFavorite);
    }
  }, [item]);

  const toggleFavorite = async () => {
    if (status !== 'ready' || !contentId || loading) return;
    setLoading(true);
    setIsFavorite(!isFavorite);
    try {
      const res = await fetch('/api/media/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: String(contentId), itemData: item }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
    } catch (e) {
      console.error(e);
      setIsFavorite(isFavorite);
    } finally {
      setLoading(false);
    }
  };

  if (!contentId) return null;

  return (
    <Button
      variant="outline"
      size="lg"
      onClick={toggleFavorite}
      disabled={loading}
      className={`rounded-2xl border-white/10 hover:border-red-500/50 transition-colors ${isFavorite ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-white/5 text-white hover:bg-white/10'
        }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isFavorite ? 'filled' : 'outline'}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="mr-2"
        >
          <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
        </motion.div>
      </AnimatePresence>
      {isFavorite ? 'Favori' : 'Ajouter'}
    </Button>
  );
}

/* ─── Person Card (casting) ──────────────────────────────────────── */
function PersonCard({ person }) {
  const [imgErr, setImgErr] = useState(false);
  const photoUrl = person.Id
    ? `/api/proxy/image?itemId=${person.Id}&type=Primary&maxWidth=200`
    : person.photoUrl || null;

  const content = (
    <>
      <div className="w-[120px] h-[120px] rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/5 mb-2 group-hover:ring-red-500/40 transition-all">
        {photoUrl && !imgErr ? (
          <img src={photoUrl} alt={person.name} className="w-full h-full object-cover" loading="lazy" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
            <User className="w-8 h-8 text-gray-600" />
          </div>
        )}
      </div>
      <p className="text-xs text-white font-medium truncate">{person.name}</p>
      {person.role && <p className="text-[11px] text-gray-500 truncate">{person.role}</p>}
    </>
  );

  const cls = "flex-shrink-0 min-w-[120px] w-[120px] cursor-pointer group block";
  const title = `${person.name}${person.role ? ' — ' + person.role : ''}`;
  const linkId = person.Id || person.tmdbId;

  return linkId ? (
    <Link href={`/person/${linkId}`} className={cls} title={title}>{content}</Link>
  ) : (
    <div className={cls} title={title}>{content}</div>
  );
}

function EpisodeCard({ ep, onPlay }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <motion.div whileHover={{ scale: 1.01 }} data-testid={`episode-${ep.id}`} className="glass-card rounded-2xl overflow-hidden cursor-pointer group" onClick={() => onPlay(ep.id)}>
      <div className="flex gap-4 p-4">
        <div className="relative w-40 aspect-video rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
          {!imgErr && (ep.thumbUrl || ep.backdropUrl) ? (
            <img src={ep.thumbUrl || ep.backdropUrl} alt={ep.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><PlayCircle className="w-8 h-8 text-gray-600" /></div>
          )}
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"><Play className="w-5 h-5 fill-current" /></div>
          </div>
          {ep.isPlayed && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-lg bg-green-500/80 flex items-center justify-center"><Check className="w-3 h-3" /></div>}
        </div>
        <div className="flex-1 min-w-0 py-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-gray-500 font-mono">E{String(ep.episodeNumber).padStart(2, '0')}</span>
            {ep.runtime > 0 && <span className="text-xs text-gray-600">{ep.runtime} min</span>}
          </div>
          <h4 className="font-semibold text-white text-sm mb-1.5 truncate">{ep.name}</h4>
          <p className="text-gray-500 text-xs line-clamp-2">{ep.overview}</p>
        </div>
      </div>
    </motion.div>
  );
}

export function MediaDetailView({ item, onBack, onPlay, onItemClick }) {
  const [detail, setDetail] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [collection, setCollection] = useState(null);
  const [collectionItems, setCollectionItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingEps, setLoadingEps] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [playEpId, setPlayEpId] = useState(null);
  const [subs, setSubs] = useState([]);
  const [audio, setAudio] = useState([]);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const itemKey = item?.id || item?.tmdbId || '';

  // 📡 LE NOUVEAU RADAR ELECTRON EST ICI 📡
  const handlePlay = useCallback((playItem, epId = null) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log("🎬 [DagzFlix PC] Clic intercepté dans DetailView ! Envoi au lecteur natif...");
      window.electronAPI.launchMpv({ item: playItem, episodeId: epId });
      return; 
    }
    
    if (epId) setPlayEpId(epId);
    setShowPlayer(true);
  }, []);

  useEffect(() => {
    setDetail(null); setSimilar([]); setSeasons([]); setSelectedSeason(null); setEpisodes([]);
    setCollection(null); setCollectionItems([]); setSubs([]); setAudio([]); setImgError(false); setShowRequestModal(false); setLoading(true);
    fetchAll();
  }, [itemKey]);

  const fetchAll = async () => {
    let fi = item;
    const detailId = item.id || item.tmdbId;
    if (detailId) {
      try {
        const r = await cachedApi(`media/detail?id=${detailId}`);
        if (r.item) { setDetail(r.item); fi = r.item; setSimilar(r.similar || []); }
      } catch {
        setDetail(item);
        fi = item;
      }
    } else {
      setDetail(item);
      fi = item;
    }

    const isSeries = fi?.type === 'Series';
    const fId = fi?.id;
    const tmdbId = fi?.tmdbId || fi?.providerIds?.Tmdb;
    const isLocallyAvailable = fi?.mediaStatus === 5 || fi?.localId;
    const streamId = fi?.localId || fId;
    const canStreamFromJellyfin = !!streamId && isLocallyAvailable;

    if (isSeries && canStreamFromJellyfin) {
      try { const r = await cachedApi(`media/seasons?seriesId=${streamId}`); const s = r.seasons || []; setSeasons(s); if (s.length > 0) { setSelectedSeason(s[0]); fetchEps(streamId, s[0].id); } } catch { /* ignore */ }
    }

    if (!isSeries) {
      try {
        const p = new URLSearchParams();
        if (fId) p.set('id', fId);
        if (tmdbId) p.set('tmdbId', tmdbId);
        const r = await cachedApi(`media/collection?${p.toString()}`);
        if (r.collection) {
          setCollection(r.collection);
          setCollectionItems(r.items || []);
        }
      } catch { /* ignore */ }
    }

    if (canStreamFromJellyfin) {
      try { const r = await cachedApi(`media/stream?id=${streamId}`); setSubs(r.subtitles || []); setAudio(r.audioTracks || []); } catch { /* ignore */ }
    }
    setLoading(false);
  };

  const fetchEps = async (sid, seId) => {
    setLoadingEps(true);
    try { const r = await cachedApi(`media/episodes?seriesId=${sid}&seasonId=${seId}`); setEpisodes(r.episodes || []); } catch { /* ignore */ }
    setLoadingEps(false);
  };

  const d = detail || item;
  const isSeries = d?.type === 'Series';

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" data-testid="media-detail-view" className="min-h-screen bg-[#050505]">
      <AnimatePresence>{showPlayer && <VideoPlayer item={d} episodeId={playEpId} onClose={() => { setShowPlayer(false); setPlayEpId(null); }} />}</AnimatePresence>
      <MediaModal item={d} isOpen={showRequestModal} onClose={() => setShowRequestModal(false)} onRequested={() => { /* refresh status if needed */ }} />

      {/* Backdrop */}
      <div className="relative h-[55vh] min-h-[400px]">
        {!imgError && d?.backdropUrl ? (
          <img src={d.backdropUrl} alt={d.name} className="absolute inset-0 w-full h-full object-cover" onError={() => setImgError(true)} />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-red-950/20 via-gray-900 to-[#050505]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/50 to-[#050505]/10" />
        <button data-testid="detail-back" onClick={onBack} className="absolute top-20 left-6 z-20 w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20">
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="relative -mt-56 z-10 px-6 md:px-16 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row gap-10">
          <div className="flex-shrink-0 w-48 md:w-56">
            <div className="aspect-[2/3] rounded-3xl overflow-hidden shadow-2xl bg-white/5 ring-1 ring-white/10">
              {d?.posterUrl ? <img src={d.posterUrl} alt={d.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Clapperboard className="w-16 h-16 text-gray-700" /></div>}
            </div>
          </div>
          <div className="flex-1 pt-4 min-w-0">
            <h1 data-testid="detail-title" className="text-3xl md:text-5xl font-black mb-3 leading-tight">{d?.name}</h1>
            {(d?.studios || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Building2 className="w-3.5 h-3.5 text-gray-500" />
                {d.studios.map((s, i) => (
                  <span key={i}>
                    <Link href={`/search?studio=${encodeURIComponent(s)}`} className="text-sm text-gray-400 hover:text-white transition-colors">{s}</Link>
                    {i < d.studios.length - 1 ? <span className="text-gray-600"> · </span> : ''}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2.5 mb-5">
              {d?.year && <span className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 text-sm">{d.year}</span>}
              {d?.runtime > 0 && <span className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 text-sm flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{d.runtime} min</span>}
              {(d?.communityRating || d?.voteAverage) > 0 && <span className="px-3 py-1.5 rounded-xl bg-yellow-500/10 text-yellow-400 text-sm flex items-center gap-1.5"><Star className="w-3.5 h-3.5 fill-current" />{(d.communityRating || d.voteAverage).toFixed(1)}</span>}
              <span className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 text-sm flex items-center gap-1.5">{isSeries ? <><Tv className="w-3.5 h-3.5" />Série</> : <><Film className="w-3.5 h-3.5" />Film</>}</span>
              {isSeries && seasons.length > 0 && <span className="px-3 py-1.5 rounded-xl bg-purple-500/10 text-purple-300 text-sm flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" />{seasons.length} saison{seasons.length > 1 ? 's' : ''}</span>}
            </div>
            {(d?.genres || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">{d.genres.map(g => (
                <Link key={g} href={`/search?genre=${encodeURIComponent(g)}`}
                  className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red-300 text-sm border border-red-500/10 hover:bg-red-500/20 hover:border-red-500/30 transition-colors flex items-center gap-1.5">
                  {GENRE_ICONS[g]} {g}
                </Link>
              ))}</div>
            )}
            {d?.dagzRank > 0 && (
              <div className="mb-5 inline-flex items-center gap-3 glass rounded-2xl px-5 py-3"><Sparkles className="w-5 h-5 text-red-400" /><span className="text-red-300 font-bold">DagzRank</span><div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full" style={{ width: `${d.dagzRank}%` }} /></div><span className="text-red-400 font-bold">{d.dagzRank}%</span></div>
            )}
            {/* ── User Star Rating ── */}
            <StarRating item={d} />
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <SmartButton item={d} onPlay={handlePlay} onRequestModal={() => setShowRequestModal(true)} />
              <TrailerButton item={d} />
              <FavoriteButton item={d} />
            </div>
            <p className="text-gray-400 leading-relaxed mb-6 max-w-2xl font-light">{d?.overview}</p>
            {(subs.length > 0 || audio.length > 0) && (
              <div className="flex flex-wrap gap-4 mb-6">
                {subs.length > 0 && <div className="flex items-center gap-2 text-sm text-gray-500"><Subtitles className="w-4 h-4" />{subs.length} sous-titre{subs.length > 1 ? 's' : ''}</div>}
                {audio.length > 0 && <div className="flex items-center gap-2 text-sm text-gray-500"><AudioLines className="w-4 h-4" />{audio.length} piste{audio.length > 1 ? 's' : ''} audio</div>}
              </div>
            )}
            {/* ── Casting Section ── */}
            {(d?.people || []).length > 0 && d.people.some(p => p.type === 'Actor') && (
              <div className="mb-8">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <User className="w-4 h-4" />Casting
                </h3>
                <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-2">
                  {d.people.filter(p => p.type === 'Actor').slice(0, 20).map((p, i) => (
                    <motion.div
                      key={p.Id || i}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                    >
                      <PersonCard person={p} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
            {/* ── Crew (Director / Writer) ── */}
            {(d?.people || []).length > 0 && d.people.some(p => p.type === 'Director' || p.type === 'Writer') && (
              <div className="mb-6 flex flex-wrap gap-4">
                {d.people.filter(p => p.type === 'Director').slice(0, 3).map((p, i) => (
                  <span key={`dir-${i}`} className="px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-300 text-sm border border-blue-500/10">
                    🎬 {p.name}
                  </span>
                ))}
                {d.people.filter(p => p.type === 'Writer').slice(0, 3).map((p, i) => (
                  <span key={`wrt-${i}`} className="px-3 py-1.5 rounded-xl bg-green-500/10 text-green-300 text-sm border border-green-500/10">
                    ✍️ {p.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Seasons & Episodes */}
        {isSeries && seasons.length > 0 && (
          <div className="mt-14">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Layers className="w-5 h-5 text-purple-400" />Saisons et Épisodes</h2>
            <div className="flex gap-2 mb-6 overflow-x-auto hide-scrollbar pb-2">
              {seasons.map(s => (
                <button key={s.id} data-testid={`season-${s.seasonNumber}`} onClick={() => { setSelectedSeason(s); fetchEps(d.id, s.id); }}
                  className={`px-5 py-2.5 rounded-2xl text-sm font-medium transition-all whitespace-nowrap ${selectedSeason?.id === s.id ? 'bg-white text-black shadow-lg' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                  {s.name}<span className="ml-1.5 text-xs opacity-60">({s.episodeCount})</span>
                </button>
              ))}
            </div>
            {loadingEps ? (
              <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 skeleton" />)}</div>
            ) : (
              <div className="grid gap-3">
                {episodes.map(ep => <EpisodeCard key={ep.id} ep={ep} onPlay={(id) => handlePlay(d, id)} />)}
                {episodes.length === 0 && <div className="text-center py-12 text-gray-600"><p>Aucun épisode disponible</p></div>}
              </div>
            )}
          </div>
        )}

        {/* Collection/Saga */}
        {collection && collectionItems.length > 0 && (
          <div data-testid="saga-section" className="mt-14">
            <h2 className="text-xl font-bold mb-2 flex items-center gap-2"><Layers className="w-5 h-5 text-amber-400" />{collection.name}</h2>
            {collection.overview && <p className="text-gray-500 text-sm mb-6 max-w-2xl">{collection.overview}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {collectionItems.map((ci, idx) => (
                <motion.div key={ci.id || idx} whileHover={{ scale: 1.05, y: -4 }} className={`cursor-pointer ${ci.isCurrent ? 'ring-2 ring-red-500 rounded-2xl' : ''}`} onClick={() => { if (!ci.isCurrent) onItemClick(ci); }}>
                  <div className="aspect-[2/3] rounded-2xl overflow-hidden bg-white/3 relative shadow-lg">
                    {ci.posterUrl ? <img src={ci.posterUrl} alt={ci.name} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center"><Clapperboard className="w-8 h-8 text-gray-700" /></div>}
                    {ci.isCurrent && <div className="absolute inset-0 bg-red-600/10 flex items-center justify-center"><Badge className="bg-red-600 text-white">Actuel</Badge></div>}
                  </div>
                  <p className="text-sm text-gray-400 mt-2 truncate font-medium">{ci.name}</p>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Similar */}
        {similar.length > 0 && (
          <div className="mt-14"><MediaRow title="Similaire" items={similar} icon={<Film className="w-5 h-5 text-gray-500" />} onItemClick={onItemClick} /></div>
        )}
      </div>
      <div className="h-24" />
    </motion.div>
  );
}
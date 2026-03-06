'use client';
import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Play, Download, Clock, Check, Loader2, Youtube, X } from 'lucide-react';
import { api, cachedApi } from '@/lib/api';

const resolveTmdbId = (item) => item?.tmdbId || item?.providerIds?.Tmdb || item?.providerIds?.TMDb || item?.providerIds?.tmdb || null;

export function SmartButton({ item, onPlay }) {
  const [status, setStatus] = useState('loading');
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [nextEp, setNextEp] = useState(null);

  useEffect(() => { if (item) check(); }, [item?.id]);

  const check = async () => {
    setStatus('loading');
    setNextEp(null);
    try {
      const p = new URLSearchParams();
      if (item.id) p.set('id', item.id);
      const tmdbId = resolveTmdbId(item);
      if (tmdbId) p.set('tmdbId', tmdbId);
      p.set('mediaType', item.type === 'Series' ? 'tv' : 'movie');
      const r = await cachedApi(`media/status?${p.toString()}`);
      setStatus(r.status || 'unknown');

      // V7.5 Mission 6: For series, pre-fetch next episode
      if ((item.type === 'Series') && (r.status === 'available') && item.id && !`${item.id}`.startsWith('tmdb-')) {
        try {
          const epRes = await api(`media/next-episode?seriesId=${item.id}`);
          if (epRes.episodeId) setNextEp(epRes);
        } catch (_) { /* ignore */ }
      }
    } catch { setStatus('unknown'); }
  };

  const handlePlay = () => {
    if (item.type === 'Series' && nextEp?.episodeId) {
      // Smart Play: launch next episode directly
      onPlay(item, nextEp.episodeId);
    } else {
      onPlay(item);
    }
  };

  const req = async () => {
    setRequesting(true);
    try {
      const tmdbId = resolveTmdbId(item);
      const r = await api('media/request', {
        method: 'POST',
        body: JSON.stringify({ tmdbId, itemId: item.id, mediaType: item.type === 'Series' ? 'tv' : 'movie' }),
      });
      if (r.success) { setRequested(true); setStatus('pending'); }
    } catch (e) { /* ignore */ }
    setRequesting(false);
  };

  const cls = 'h-13 px-8 text-base font-bold rounded-xl transition-all';

  if (status === 'loading') return <Button data-testid="smart-btn-loading" className={`${cls} bg-white/5 text-gray-500`} disabled><Loader2 className="w-5 h-5 animate-spin mr-2" />Vérification...</Button>;
  if (status === 'available') {
    const label = (item.type === 'Series' && nextEp)
      ? `S${String(nextEp.seasonNumber).padStart(2,'0')}E${String(nextEp.episodeNumber).padStart(2,'0')}`
      : 'LECTURE';
    return <Button data-testid="smart-btn-play" onClick={handlePlay} className={`${cls} bg-white hover:bg-gray-100 text-black shadow-xl shadow-white/10`}><Play className="w-5 h-5 mr-2 fill-current" />{label}</Button>;
  }
  if (status === 'pending') return <Button data-testid="smart-btn-pending" className={`${cls} bg-yellow-500/10 text-yellow-400 border border-yellow-500/30`} disabled><Clock className="w-5 h-5 mr-2" />EN COURS</Button>;
  return (
    <Button data-testid="smart-btn-request" onClick={req} disabled={requesting || requested} className={`${cls} bg-red-600 hover:bg-red-700 text-white shadow-xl shadow-red-600/20`}>
      {requesting ? <><Loader2 className="w-5 h-5 animate-spin mr-2" />Envoi...</> : requested ? <><Check className="w-5 h-5 mr-2" />Envoyée</> : <><Download className="w-5 h-5 mr-2" />DEMANDER</>}
    </Button>
  );
}

export function TrailerButton({ item }) {
  const [trailers, setTrailers] = useState([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchTrailers = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (item.id) p.set('id', item.id);
      const tmdbId = resolveTmdbId(item);
      if (tmdbId) p.set('tmdbId', tmdbId);
      p.set('mediaType', item.type === 'Series' ? 'tv' : 'movie');
      if (item?.name) p.set('title', item.name);
      const r = await cachedApi(`media/trailer?${p.toString()}`);
      const nextTrailers = r.trailers || [];
      setTrailers(nextTrailers);
      if (nextTrailers.length === 0) {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item?.name || ''} trailer`)}`;
        window.open(searchUrl, '_blank', 'noopener,noreferrer');
      } else {
        const firstTrailer = nextTrailers[0];
        const firstTrailerId = ytId(firstTrailer?.url) || firstTrailer?.key;
        if (!firstTrailerId && firstTrailer?.url) {
          window.open(firstTrailer.url, '_blank', 'noopener,noreferrer');
        } else {
          setShow(true);
        }
      }
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const ytId = (u) => { const m = (u || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/); return m ? m[1] : null; };

  return (
    <>
      <Button data-testid="trailer-btn" onClick={fetchTrailers} disabled={loading} variant="outline" className="h-13 px-6 rounded-xl border-white/15 text-white hover:bg-white/5">
        {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Youtube className="w-5 h-5 mr-2 text-red-500" />}Bande-annonce
      </Button>
      <AnimatePresence>
        {show && trailers.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl" onClick={() => setShow(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="w-full max-w-4xl glass-strong rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5">
                <h3 className="text-lg font-bold">Bande-annonce</h3>
                <button onClick={() => setShow(false)} className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10"><X className="w-5 h-5" /></button>
              </div>
              <div className="aspect-video bg-black">
                {(() => {
                  const id = ytId(trailers[0]?.url) || trailers[0]?.key;
                  return id ? (
                    <iframe src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <a href={trailers[0]?.url} target="_blank" rel="noopener noreferrer" className="text-red-400"><Youtube className="w-8 h-8" /></a>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

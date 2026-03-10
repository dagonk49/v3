'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Star, Clapperboard, ChevronLeft, ChevronRight, Loader2, Heart, Building2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

/**
 * Envoie un événement de clic télémétrie.
 */
function sendClickTelemetry(item) {
  const itemId = item.id || item.tmdbId;
  if (!itemId) return;
  fetch('/api/telemetry/click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemId: String(itemId),
      title: item.name || item.title || '',
      posterUrl: item.posterUrl || item.poster || '',
      type: item.type || '',
      genres: item.genres || [],
    }),
  }).catch(() => { });
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.04, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

export function MediaCard({ item, onClick, size = 'normal', index = 0, gridMode = false }) {
  const [imgErr, setImgErr] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const { status } = useAuth();

  const w = gridMode
    ? 'w-full'
    : size === 'large' ? 'w-[220px] md:w-[260px]' : 'w-[160px] md:w-[185px]';

  useEffect(() => {
    if (item.isFavorite !== undefined) {
      setIsFavorite(item.isFavorite);
    }
  }, [item]);

  // 🚨 LE CORRECTIF DU CLIC EST ICI 🚨
  const handleClick = useCallback(() => {
    // On crée une copie de l'item pour y injecter le bon ID sans modifier les props
    const safeItem = { ...item };
    let rawId = String(item.id || item.tmdbId);
    
    // Si l'ID est un nombre ou un ancien 'tmdb-123' sans type précisé
    if (/^\d+$/.test(rawId) || (rawId.startsWith('tmdb-') && !rawId.includes('-tv-') && !rawId.includes('-movie-'))) {
      const cleanId = rawId.replace(/^tmdb-(tv-|movie-)?/, '');
      const isTv = item.mediaType === 'tv' || item.type === 'Series';
      safeItem.id = `tmdb-${isTv ? 'tv' : 'movie'}-${cleanId}`;
    }
    
    sendClickTelemetry(safeItem);
    onClick(safeItem); // On envoie l'ID blindé au routeur !
  }, [item, onClick]);

  const toggleFavorite = async (e) => {
    e.stopPropagation();
    if (status !== 'ready') return;
    const itemId = item.id || item.tmdbId;
    if (!itemId) return;

    setIsFavorite(!isFavorite);
    try {
      const res = await fetch('/api/media/favorite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, itemData: item })
      });
      if (!res.ok) throw new Error('Failed');
    } catch (e) {
      setIsFavorite(isFavorite);
    }
  };

  return (
    <motion.div
      data-testid={`media-card-${item.id || item.tmdbId}`}
      className={`${gridMode ? '' : 'flex-shrink-0'} ${w} cursor-pointer group`}
      onClick={handleClick}
      variants={cardVariants}
      initial="hidden" animate="visible" custom={index}
      whileHover={{ scale: 1.06, y: -8 }} whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="aspect-[2/3] rounded-2xl overflow-hidden bg-white/3 relative card-reflection shadow-lg shadow-black/30">
        {!imgErr && item.posterUrl ? (
          <img src={item.posterUrl} alt={item.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-950"><Clapperboard className="w-10 h-10 text-gray-700" /></div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-4">
          <p className="text-white font-semibold text-sm line-clamp-2">{item.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {item.year && <span className="text-gray-400 text-xs">{item.year}</span>}
            {(item.communityRating || item.voteAverage) > 0 && (
              <span className="flex items-center gap-1 text-yellow-400 text-xs"><Star className="w-3 h-3 fill-current" />{(item.communityRating || item.voteAverage).toFixed(1)}</span>
            )}
          </div>
          {item.dagzRank > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full" style={{ width: `${item.dagzRank}%` }} /></div>
              <span className="text-red-400 text-[10px] font-bold">{item.dagzRank}%</span>
            </div>
          )}
        </div>

        {item.mediaStatus === 5 && (
          <div className="absolute top-2.5 left-2.5 z-10">
            <div className="bg-green-500/90 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded-lg font-medium shadow-md">Disponible</div>
          </div>
        )}

        <div className={`absolute top-2.5 right-2.5 z-20 ${isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          <motion.button whileTap={{ scale: 0.8 }} onClick={toggleFavorite} className={`w-8 h-8 rounded-full backdrop-blur-md flex items-center justify-center transition-colors shadow-lg ${isFavorite ? 'bg-red-500/20 hover:bg-red-500/30' : 'bg-black/40 hover:bg-black/60'}`}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={isFavorite ? 'filled' : 'outline'} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                <Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} />
              </motion.div>
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
      <p className="text-gray-400 text-sm mt-2.5 truncate font-medium">{item.name}</p>
    </motion.div>
  );
}

export function MediaRow({ title, items, icon, onItemClick, loading, size }) {
  const ref = useRef(null);
  const scroll = (d) => ref.current?.scrollBy({ left: d === 'left' ? -600 : 600, behavior: 'smooth' });

  if (!loading && (!items || items.length === 0)) return null;

  return (
    <div className="mb-12 group/row">
      <h3 className="text-lg font-bold text-white mb-5 px-6 md:px-10 flex items-center gap-2.5">
        {icon}{title}{loading && <Loader2 className="w-4 h-4 animate-spin text-gray-600" />}
      </h3>
      <div className="relative">
        <button onClick={() => scroll('left')} className="absolute left-0 top-0 bottom-8 z-10 w-14 bg-gradient-to-r from-[#050505] to-transparent hidden group-hover/row:flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></div>
        </button>
        <button onClick={() => scroll('right')} className="absolute right-0 top-0 bottom-8 z-10 w-14 bg-gradient-to-l from-[#050505] to-transparent hidden group-hover/row:flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><ChevronRight className="w-5 h-5" /></div>
        </button>
        <div ref={ref} className="flex gap-4 overflow-x-auto hide-scrollbar px-6 md:px-10 pb-4">
          {loading ? Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex-shrink-0 ${size === 'large' ? 'w-[220px] md:w-[260px]' : 'w-[160px] md:w-[185px]'}`}><div className="aspect-[2/3] skeleton" /></div>
          )) : (items || []).map((item, idx) => <MediaCard key={item.id || idx} item={item} onClick={onItemClick} size={size} index={idx} />)}
        </div>
      </div>
    </div>
  );
}
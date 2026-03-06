'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, User, Calendar, Film, Tv, Loader2, PlayCircle, Library } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { setItemCache } from '@/lib/item-store';
import { cachedApi } from '@/lib/api';
import { MediaCard } from '@/components/dagzflix/MediaCard';
import { pageVariants } from '@/lib/constants';

/**
 * PersonPage — Page détail d'une personne (acteur, réalisateur).
 *
 * Fonctionnalités :
 *  - Photo, nom, date de naissance, biographie
 *  - Onglets "Disponibles" / "Filmographie Complète"
 *  - Grilles séparées Films et Séries avec MediaCard
 */
export default function PersonPage() {
  const { status } = useAuth();
  const router = useRouter();
  const params = useParams();
  const personId = params.id;

  const [person, setPerson] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imgErr, setImgErr] = useState(false);
  const [activeTab, setActiveTab] = useState('available'); // 'available' | 'all'

  useEffect(() => {
    if (status !== 'ready' || !personId) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await cachedApi(`person/detail?id=${personId}`);
        if (cancelled) return;
        setPerson(data.person);
        setItems(data.items || []);
      } catch (e) {
        console.error('Person detail error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [status, personId]);

  if (status !== 'ready') return null;

  const handleItemClick = (item) => {
    const id = item.id || item.tmdbId;
    if (id) setItemCache(id, item);
    router.push(`/media/${id}`);
  };

  // Filter by availability via Tabs
  const filteredItems = useMemo(() => {
    if (activeTab === 'available') return items.filter(i => i.mediaStatus === 5);
    return items;
  }, [items, activeTab]);

  const movies = filteredItems.filter(i => i.type === 'Movie');
  const series = filteredItems.filter(i => i.type === 'Series');

  const localCount = items.filter(i => i.mediaStatus === 5).length;
  // If no local items exist, default to 'all' right away
  useEffect(() => {
    if (!loading && localCount === 0 && items.length > 0) {
      setActiveTab('all');
    }
  }, [loading, localCount, items.length]);

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="min-h-screen bg-[#050505] text-white pb-20"
    >
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="fixed top-6 left-6 z-50 w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {loading ? (
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-red-500" />
        </div>
      ) : person ? (
        <>
          {/* Hero */}
          <div className="relative pt-24 px-6 md:px-10 pb-8 bg-gradient-to-b from-white/5 to-transparent">
            <div className="flex flex-col md:flex-row gap-8 items-start max-w-6xl mx-auto">
              {/* Photo */}
              <div className="w-[180px] h-[180px] md:w-[220px] md:h-[220px] rounded-full overflow-hidden bg-white/5 ring-4 ring-white/10 flex-shrink-0 shadow-2xl">
                {person.photoUrl && !imgErr ? (
                  <img
                    src={person.photoUrl}
                    alt={person.name}
                    className="w-full h-full object-cover"
                    onError={() => setImgErr(true)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                    <User className="w-16 h-16 text-gray-600" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 pt-4">
                <h1 className="text-4xl md:text-5xl font-black mb-3">{person.name}</h1>
                {person.birthDate && (
                  <p className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-gray-300 text-sm mb-4">
                    <Calendar className="w-4 h-4" />
                    {new Date(person.birthDate).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                )}
                {person.overview && (
                  <p className="text-gray-400 text-sm leading-relaxed max-w-3xl line-clamp-4">{person.overview}</p>
                )}
              </div>
            </div>
          </div>

          {/* Tabs UI */}
          <div className="px-6 md:px-10 max-w-6xl mx-auto mb-10">
            <div className="inline-flex rounded-2xl bg-white/5 p-1.5 shadow-lg shadow-black flex-wrap">
              <button
                onClick={() => setActiveTab('available')}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'available' ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
              >
                {activeTab === 'available' && (
                  <motion.div layoutId="person-tab" className="absolute inset-0 bg-red-600 rounded-xl" />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <PlayCircle className="w-4 h-4" /> Disponibles ({localCount})
                </span>
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeTab === 'all' ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
              >
                {activeTab === 'all' && (
                  <motion.div layoutId="person-tab" className="absolute inset-0 bg-red-600 rounded-xl" />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Library className="w-4 h-4" /> Filmographie Complète ({items.length})
                </span>
              </button>
            </div>
          </div>

          {/* Grids with AnimatePresence for smooth transitions */}
          <div className="px-6 md:px-10 max-w-6xl mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {movies.length > 0 && (
                  <div className="mb-10">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                      <Film className="w-5 h-5 text-red-500" /> Films
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-8 gap-x-4">
                      {movies.map((item, idx) => (
                        <MediaCard key={`m-${item.id || item.tmdbId}`} item={item} onClick={handleItemClick} index={idx} />
                      ))}
                    </div>
                  </div>
                )}

                {series.length > 0 && (
                  <div className="mb-10">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                      <Tv className="w-5 h-5 text-blue-500" /> Séries
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-8 gap-x-4">
                      {series.map((item, idx) => (
                        <MediaCard key={`s-${item.id || item.tmdbId}`} item={item} onClick={handleItemClick} index={idx} />
                      ))}
                    </div>
                  </div>
                )}

                {filteredItems.length === 0 && (
                  <div className="text-center py-24 bg-white/5 rounded-3xl border border-white/10">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <Film className="w-8 h-8 text-gray-500" />
                    </div>
                    <p className="text-gray-400 font-medium">Aucun contenu disponible pour cette sélection.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-[60vh]">
          <p className="text-gray-500 font-medium">Personne introuvable.</p>
        </div>
      )}
    </motion.div>
  );
}

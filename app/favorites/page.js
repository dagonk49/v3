'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Film, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cachedApi, invalidateCache } from '@/lib/api';
import { MediaCard } from '@/components/dagzflix/MediaCard';
import { setItemCache } from '@/lib/item-store';
import { pageVariants } from '@/lib/constants';

/**
 * FavoritesPage — Page listant les médias favoris de l'utilisateur.
 * Affiche une grille de cartes médias.
 */
export default function FavoritesPage() {
    const { status } = useAuth();
    const router = useRouter();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status !== 'ready') return;
        let cancelled = false;

        (async () => {
            try {
                const data = await cachedApi('media/favorites');
                if (!cancelled && data.items) {
                    // Force isFavorite to true for all items coming from this endpoint
                    const favItems = data.items.map(i => ({ ...i, isFavorite: true }));
                    setItems(favItems);
                }
            } catch (e) {
                console.error('Favorites fetch error:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        // Optionnel : Invalider le cache lors du montage pour toujours avoir la dernière liste
        invalidateCache('media/favorites');

        return () => { cancelled = true; };
    }, [status]);

    if (status !== 'ready') return null;

    const handleItemClick = (item) => {
        const id = item.id || item.tmdbId;
        if (id) {
            setItemCache(id, item);
            router.push(`/media/${id}`);
        }
    };

    return (
        <motion.div
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="min-h-screen bg-[#050505] text-white pt-28 pb-20"
        >
            <div className="px-6 md:px-10 max-w-7xl mx-auto">
                <div className="flex items-center gap-4 mb-10">
                    <div className="w-16 h-16 rounded-2xl bg-red-600/20 flex items-center justify-center">
                        <Heart className="w-8 h-8 text-red-500 fill-red-500" />
                    </div>
                    <div>
                        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-2">Mes Favoris</h1>
                        <p className="text-gray-400 font-medium">{items.length} titre{items.length !== 1 ? 's' : ''} enregistré{items.length !== 1 ? 's' : ''}</p>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-[50vh]">
                        <Loader2 className="w-10 h-10 animate-spin text-red-500" />
                    </div>
                ) : (
                    <AnimatePresence mode="wait">
                        {items.length > 0 ? (
                            <motion.div
                                key="grid"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.3 }}
                                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-y-8 gap-x-4 pb-20"
                            >
                                {items.map((item, idx) => (
                                    <MediaCard
                                        key={`fav-${item.id || item.tmdbId}`}
                                        item={item}
                                        onClick={handleItemClick}
                                        index={idx}
                                    />
                                ))}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="empty"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.4 }}
                                className="flex flex-col items-center justify-center py-32 text-center bg-white/5 rounded-3xl border border-white/10 shadow-2xl"
                            >
                                <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 ring-4 ring-white/5 shadow-[0_0_50px_rgba(255,255,255,0.05)]">
                                    <Heart className="w-10 h-10 text-gray-500" />
                                </div>
                                <h2 className="text-2xl font-bold mb-3 text-white">Aucun favori pour le moment</h2>
                                <p className="text-gray-400 max-w-sm mb-8 leading-relaxed">
                                    Explorez le catalogue et cliquez sur le cœur des médias que vous aimez pour les retrouver ici.
                                </p>
                                <button
                                    onClick={() => router.push('/')}
                                    className="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl transition-all shadow-lg hover:shadow-red-600/30 hover:-translate-y-1"
                                >
                                    Découvrir le catalogue
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
}

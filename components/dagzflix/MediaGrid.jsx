'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Search, Loader2, X } from 'lucide-react';
import { cachedApi } from '@/lib/api';
import { setItemCache } from '@/lib/item-store';
import { MediaCard } from './MediaCard';

/**
 * MediaGrid — Grille de médias responsive avec recherche dynamique intégrée.
 *
 * Corrections V0,012 :
 *  - handleMediaClick utilise exclusivement item.id || item.tmdbId (jamais d'index local)
 *  - Recherche dynamique debounced via /api/search (titre + titre original)
 *  - Grille mobile-first : grid-cols-2 → sm:3 → md:4 → lg:5 → xl:6
 *
 * @param {Object} props
 * @param {Array} props.items - Les items à afficher dans la grille
 * @param {Function} props.onItemClick - Callback navigation (reçoit l'item complet)
 * @param {boolean} [props.loading=false] - Affiche les skeletons
 * @param {boolean} [props.searchable=false] - Active la barre de recherche intégrée
 * @param {string} [props.searchMediaType] - 'movie' | 'tv' | undefined (filtre de recherche)
 * @param {string} [props.searchPlaceholder] - Placeholder du champ recherche
 * @param {string} [props.emptyMessage] - Message quand la grille est vide
 * @param {string} [props.emptyIcon] - Icône lucide quand vide
 * @param {'normal'|'large'} [props.cardSize='normal'] - Taille des cartes
 * @param {string} [props.className] - Classes CSS additionnelles
 */
export function MediaGrid({
  items = [],
  onItemClick,
  loading = false,
  searchable = false,
  searchMediaType,
  searchPlaceholder = 'Rechercher...',
  emptyMessage = 'Aucun résultat',
  cardSize = 'normal',
  className = '',
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef(null);

  // ── Debounced search (500ms) via /api/search ──
  useEffect(() => {
    if (!searchable) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQ.trim()) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('q', searchQ.trim());
        if (searchMediaType) params.set('mediaType', searchMediaType);
        const r = await cachedApi(`search?${params.toString()}`);
        const results = r.results || [];
        // Filtre côté client sur le type si besoin
        const filtered = searchMediaType
          ? results.filter(i => {
              if (searchMediaType === 'movie') return i.type === 'Movie' || i.mediaType === 'movie';
              if (searchMediaType === 'tv') return i.type === 'Series' || i.mediaType === 'tv';
              return true;
            })
          : results;

        // Si l'API retourne des résultats, les utiliser ; sinon fallback filtrage local
        if (filtered.length > 0) {
          setSearchResults(filtered);
        } else {
          // Fallback: filtrage local sur le tableau items source (nom insensible à la casse)
          const q = searchQ.trim().toLowerCase();
          const localFiltered = items.filter(it => {
            const name = (it.name || it.title || '').toLowerCase();
            const orig = (it.originalTitle || it.originalName || '').toLowerCase();
            return name.includes(q) || orig.includes(q);
          });
          setSearchResults(localFiltered);
        }
      } catch {
        // En cas d'erreur API, fallback filtrage local
        const q = searchQ.trim().toLowerCase();
        const localFiltered = items.filter(it => {
          const name = (it.name || it.title || '').toLowerCase();
          const orig = (it.originalTitle || it.originalName || '').toLowerCase();
          return name.includes(q) || orig.includes(q);
        });
        setSearchResults(localFiltered);
      }
      setSearchLoading(false);
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQ, searchable, searchMediaType]);

  /**
   * handleMediaClick — Utilise EXCLUSIVEMENT item.id ou item.tmdbId pour la navigation.
   * Garantit que cliquer sur Naruto ouvre Naruto et non Laurel & Hardy.
   */
  const handleMediaClick = useCallback((item) => {
    const itemId = item.id || item.tmdbId;
    if (!itemId) {
      console.warn('[MediaGrid] Item sans ID détecté:', item.name);
      return;
    }
    // Cache l'item pour la transition de navigation
    setItemCache(String(itemId), item);
    onItemClick(item);
  }, [onItemClick]);

  // Items à afficher : résultats de recherche si actif, sinon items source
  const displayItems = searchResults !== null ? searchResults : items;
  const isLoading = searchResults !== null ? searchLoading : loading;

  const gridClasses = 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
  const skeletonCount = 12;

  return (
    <div className={className}>
      {/* ── Barre de recherche intégrée ── */}
      {searchable && (
        <div className="mb-6 max-w-2xl">
          <div className="relative">
            <Input
              data-testid="mediagrid-search-input"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="bg-white/5 border-white/10 text-white h-12 sm:h-14 pl-12 sm:pl-14 text-base sm:text-lg rounded-2xl"
            />
            <Search className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            {searchQ && (
              <button
                onClick={() => setSearchQ('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {searchLoading && searchQ && (
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Recherche en cours...
            </div>
          )}
        </div>
      )}

      {/* ── Grille responsive ── */}
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={gridClasses}>
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <div key={i}>
                <div className="aspect-[2/3] skeleton rounded-2xl" />
                <div className="h-4 skeleton rounded mt-2 w-3/4" />
              </div>
            ))}
          </motion.div>
        ) : displayItems.length > 0 ? (
          <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={gridClasses}>
            {displayItems.map((item, idx) => (
              <MediaCard
                key={`${item.id || item.tmdbId || idx}`}
                item={item}
                onClick={handleMediaClick}
                size={cardSize}
                index={idx}
                gridMode
              />
            ))}
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-16">
            <Search className="w-12 h-12 text-gray-800 mx-auto mb-3" />
            <p className="text-gray-500">{emptyMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

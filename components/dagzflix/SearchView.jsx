'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Search, Film, Tv, LayoutGrid, SlidersHorizontal, X, Building2 } from 'lucide-react';
import { cachedApi } from '@/lib/api';
import { setItemCache } from '@/lib/item-store';
import { MediaCard } from './MediaCard';
import { GENRE_ICONS } from '@/lib/constants';

const TYPE_FILTERS = [
  { id: 'all', label: 'Tous', icon: LayoutGrid },
  { id: 'movie', label: 'Films', icon: Film },
  { id: 'tv', label: 'Séries', icon: Tv },
];

export function SearchView() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ── URL is the SINGLE source of truth for all filters ──
  const q = searchParams.get('q') || '';
  const typeFilter = searchParams.get('type') || 'all';
  const genreFilter = searchParams.get('genre') || '';
  const studioFilter = searchParams.get('studio') || '';

  // Only inputValue needs local state (for debounce typing UX)
  const [inputValue, setInputValue] = useState(q);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Dynamic genre list fetched from Jellyfin at mount ──
  const [genreOptions, setGenreOptions] = useState([]);
  useEffect(() => {
    cachedApi('media/genres')
      .then(data => setGenreOptions((data.genres || []).map(g => g.name)))
      .catch(() => {});
  }, []);

  // Ref to always read latest URL params without adding deps
  const paramsRef = useRef({ q, typeFilter, genreFilter, studioFilter });
  paramsRef.current = { q, typeFilter, genreFilter, studioFilter };

  // ── Helper: build URL from current params + overrides ──
  const updateParams = useCallback((updates) => {
    const cur = paramsRef.current;
    const next = { q: cur.q, type: cur.typeFilter, genre: cur.genreFilter, studio: cur.studioFilter, ...updates };
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.type && next.type !== 'all') params.set('type', next.type);
    if (next.genre) params.set('genre', next.genre);
    if (next.studio) params.set('studio', next.studio);
    const qs = params.toString();
    router.replace(`/search${qs ? '?' + qs : ''}`, { scroll: false });
  }, [router]);

  // ── Debounce: user types → update URL 'q' after 800ms ──
  useEffect(() => {
    if (inputValue === paramsRef.current.q) return;
    const timer = setTimeout(() => {
      updateParams({ q: inputValue || undefined });
    }, 800);
    return () => clearTimeout(timer);
  }, [inputValue, updateParams]);

  // ── Sync inputValue when URL 'q' changes externally (back/forward nav) ──
  useEffect(() => {
    setInputValue(q);
  }, [q]);

  // ── Data fetching: driven purely by URL params ──
  useEffect(() => {
    const hasFilter = !!(q || genreFilter || studioFilter);
    const hasTypeOnly = typeFilter !== 'all' && !q && !genreFilter && !studioFilter;

    if (!hasFilter && !hasTypeOnly) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setHasSearched(true);
      try {
        let data;

        if (genreFilter || studioFilter) {
          // V7.5 Mission 4: Genre/studio filter → TMDB discover (global, not Jellyfin-local)
          const params = new URLSearchParams();
          const discoverType = typeFilter === 'tv' ? 'tv' : typeFilter === 'movie' ? 'movies' : 'movies';
          params.set('type', discoverType);
          if (genreFilter) params.set('genre', genreFilter);
          if (studioFilter) params.set('studio', studioFilter);
          params.set('page', '1');

          if (q) {
            // If both text query + genre, use search with type filter
            const searchParams = new URLSearchParams();
            searchParams.set('q', q);
            if (typeFilter !== 'all') searchParams.set('mediaType', typeFilter);
            data = await cachedApi(`search?${searchParams.toString()}`);
            // Client-side genre filter on search results
            const genreLower = genreFilter.toLowerCase();
            const filtered = (data.results || []).filter(i =>
              (i.genres || []).some(g => g.toLowerCase().includes(genreLower))
            );
            if (!cancelled) setResults(filtered);
          } else {
            data = await cachedApi(`discover?${params.toString()}`);
            if (!cancelled) setResults(data.results || []);
          }
        } else if (q) {
          // Text search only (no genre/studio) → Jellyseerr/Jellyfin via /api/search
          const params = new URLSearchParams();
          params.set('q', q);
          if (typeFilter !== 'all') params.set('mediaType', typeFilter);
          data = await cachedApi(`search?${params.toString()}`);
          if (!cancelled) setResults(data.results || []);
        } else if (hasTypeOnly) {
          // Type-only (no text, no genre, no studio) → Jellyseerr discover for global results
          const discoverType = typeFilter === 'tv' ? 'tv' : 'movies';
          data = await cachedApi(`discover?type=${discoverType}`);
          if (!cancelled) setResults(data.results || []);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [q, typeFilter, genreFilter, studioFilter]);

  const handleItemClick = (item) => {
    const id = item.id || item.tmdbId;
    if (id) setItemCache(id, item);
    router.push(`/media/${id}`);
  };

  return (
    <div data-testid="search-view" className="pt-24 px-6 md:px-16 min-h-screen">
      {/* ── Search Input ── */}
      <div className="mb-6 max-w-2xl">
        <div className="relative">
          <Input
            data-testid="global-search-input"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Rechercher un film, une série..."
            className="bg-white/5 border-white/10 text-white h-14 pl-14 text-lg rounded-2xl"
            autoFocus
          />
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          {inputValue && (
            <button onClick={() => { setInputValue(''); updateParams({ q: undefined }); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Type Filter Bar ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.id}
            data-testid={`filter-type-${f.id}`}
            onClick={() => updateParams({ type: f.id === 'all' ? undefined : f.id })}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all ${
              typeFilter === f.id
                ? 'bg-white text-black shadow-lg'
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <f.icon className="w-4 h-4" />{f.label}
          </button>
        ))}
      </div>

      {/* ── Genre Filter ── */}
      <div className="flex flex-wrap items-start gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-gray-500 mr-1 pt-1.5">
          <SlidersHorizontal className="w-4 h-4" />Genre :
        </div>
        {genreFilter ? (
          <button onClick={() => updateParams({ genre: undefined })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 text-red-300 text-sm border border-red-500/20 hover:bg-red-500/30 transition-colors">
            {GENRE_ICONS[genreFilter] || '🎬'} {genreFilter} <X className="w-3 h-3" />
          </button>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {genreOptions.map(g => (
              <button key={g} onClick={() => updateParams({ genre: g })}
                className="px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 text-xs hover:bg-white/10 hover:text-white transition-colors">
                {GENRE_ICONS[g] || '🎬'} {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Studio Filter ── */}
      {studioFilter && (
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <div className="flex items-center gap-2 text-sm text-gray-500 mr-1">
            <Building2 className="w-4 h-4" />Studio :
          </div>
          <button onClick={() => updateParams({ studio: undefined })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/20 text-purple-300 text-sm border border-purple-500/20 hover:bg-purple-500/30 transition-colors">
            {studioFilter} <X className="w-3 h-3" />
          </button>
        </div>
      )}
      {!studioFilter && <div className="mb-4" />}

      {/* ── Results ── */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
          {Array.from({ length: 12 }).map((_, i) => <div key={i}><div className="aspect-[2/3] skeleton rounded-2xl" /></div>)}
        </div>
      ) : results.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
          {results.map((item, i) => (
            <MediaCard key={item.id || i} item={item} onClick={handleItemClick} />
          ))}
        </div>
      ) : hasSearched ? (
        <div className="text-center py-24">
          <Search className="w-16 h-16 text-gray-800 mx-auto mb-4" />
          <h3 className="text-xl text-gray-500">Aucun résultat</h3>
          <p className="text-gray-600 mt-2">Essayez un autre terme ou modifiez les filtres</p>
        </div>
      ) : (
        <div className="text-center py-24">
          <Search className="w-16 h-16 text-gray-800 mx-auto mb-4" />
          <h3 className="text-xl text-gray-500">Rechercher du contenu</h3>
          <p className="text-gray-600 mt-2">Tapez un titre ou sélectionnez un genre pour commencer</p>
        </div>
      )}
    </div>
  );
}

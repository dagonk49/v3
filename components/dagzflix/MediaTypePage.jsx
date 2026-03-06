'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Film, Tv, Search, Sparkles, Library, Wand2 } from 'lucide-react';
import { cachedApi } from '@/lib/api';
import { MediaCard } from './MediaCard';
import { WizardView } from './WizardView';

export function MediaTypePage({ mediaType, onItemClick, onPlay }) {
  const [tab, setTab] = useState('library');
  const isTV = mediaType === 'series';
  const label = isTV ? 'Séries' : 'Films';
  const jellyfinType = isTV ? 'Series' : 'Movie';

  // Search
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const doSearch = async (q) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    try {
      const r = await cachedApi(`search?q=${encodeURIComponent(q)}&mediaType=${isTV ? 'tv' : 'movie'}`);
      setSearchResults((r.results || []).filter(i => isTV ? i.type === 'Series' || i.mediaType === 'tv' : i.type === 'Movie' || i.mediaType === 'movie'));
    } catch { /* ignore */ }
    setSearchLoading(false);
  };

  // DagzRank
  const [recos, setRecos] = useState([]);
  const [recoLoading, setRecoLoading] = useState(false);
  const loadRecos = async () => {
    setRecoLoading(true);
    try { const r = await cachedApi('recommendations'); setRecos((r.recommendations || []).filter(i => isTV ? i.type === 'Series' : i.type === 'Movie')); } catch { /* ignore */ }
    setRecoLoading(false);
  };

  // Library
  const [library, setLibrary] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const loadLib = async () => {
    setLibLoading(true);
    try { const r = await cachedApi(`media/library?type=${jellyfinType}&limit=1000&sortBy=SortName&sortOrder=Ascending`); setLibrary(r.items || []); } catch { /* ignore */ }
    setLibLoading(false);
  };

  useEffect(() => {
    if (tab === 'dagzrank') loadRecos();
    if (tab === 'library') loadLib();
  }, [tab]);

  useEffect(() => { loadLib(); }, []);

  const TABS = [
    { id: 'library', label: 'Ma Bibliothèque', icon: Library },
    { id: 'search', label: 'Recherche', icon: Search },
    { id: 'dagzrank', label: 'DagzRank', icon: Sparkles },
    { id: 'wizard', label: 'Le Magicien', icon: Wand2 },
  ];

  const SkeletonGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
      {Array.from({ length: 12 }).map((_, i) => <div key={i}><div className="aspect-[2/3] skeleton" /></div>)}
    </div>
  );

  return (
    <div data-testid={`page-${mediaType}`} className="pt-24 px-6 md:px-16 min-h-screen">
      <h1 className="text-3xl md:text-4xl font-black mb-6 flex items-center gap-3">
        {isTV ? <Tv className="w-8 h-8 text-green-400" /> : <Film className="w-8 h-8 text-blue-400" />}{label}
      </h1>
      <div className="flex gap-2 mb-8 overflow-x-auto hide-scrollbar pb-2">
        {TABS.map(t => (
          <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-medium transition-all whitespace-nowrap ${tab === t.id ? 'bg-white text-black shadow-lg' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {tab === 'search' && (
          <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <form onSubmit={(e) => { e.preventDefault(); doSearch(searchQ); }} className="mb-8 max-w-2xl">
              <div className="relative">
                <Input data-testid="media-search-input" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder={`Rechercher ${isTV ? 'une série' : 'un film'}...`}
                  className="bg-white/5 border-white/10 text-white h-14 pl-14 text-lg rounded-2xl" autoFocus />
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              </div>
            </form>
            {searchLoading ? <SkeletonGrid /> :
              searchResults.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">{searchResults.map((item, i) => <MediaCard key={item.id || i} item={item} onClick={onItemClick} />)}</div>
              ) : searchQ ? (
                <div className="text-center py-16"><Search className="w-12 h-12 text-gray-800 mx-auto mb-3" /><p className="text-gray-500">Aucun résultat</p></div>
              ) : (
                <div className="text-center py-16"><Search className="w-12 h-12 text-gray-800 mx-auto mb-3" /><p className="text-gray-500">Tapez pour rechercher des {label.toLowerCase()}</p></div>
              )}
          </motion.div>
        )}
        {tab === 'dagzrank' && (
          <motion.div key="dagzrank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center gap-2 mb-6"><Sparkles className="w-5 h-5 text-red-500" /><h2 className="text-lg font-bold">Recommandations personnalisées</h2></div>
            {recoLoading ? <SkeletonGrid /> :
              recos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">{recos.map((item, i) => <MediaCard key={item.id || i} item={item} onClick={onItemClick} />)}</div>
              ) : (
                <div className="text-center py-16"><Sparkles className="w-12 h-12 text-gray-800 mx-auto mb-3" /><p className="text-gray-500">Aucune recommandation disponible</p></div>
              )}
          </motion.div>
        )}
        {tab === 'library' && (
          <motion.div key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center gap-2 mb-6"><Library className="w-5 h-5 text-blue-400" /><h2 className="text-lg font-bold">Disponible sur votre serveur</h2></div>
            {libLoading ? <SkeletonGrid /> :
              library.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">{library.map((item, i) => <MediaCard key={item.id || i} item={item} onClick={onItemClick} />)}</div>
              ) : (
                <div className="text-center py-16"><Library className="w-12 h-12 text-gray-800 mx-auto mb-3" /><p className="text-gray-500">Aucun {isTV ? 'série' : 'film'} dans la bibliothèque</p></div>
              )}
          </motion.div>
        )}
        {tab === 'wizard' && (
          <motion.div key="wizard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <WizardView mediaType={mediaType} onItemClick={onItemClick} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

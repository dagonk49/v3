'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Tv, Search, Sparkles, Library, Wand2 } from 'lucide-react';
import { cachedApi } from '@/lib/api';
import { MediaGrid } from './MediaGrid';
import { WizardView } from './WizardView';

export function MediaTypePage({ mediaType, onItemClick, onPlay }) {
  const [tab, setTab] = useState('library');
  const isTV = mediaType === 'series';
  const label = isTV ? 'Séries' : 'Films';
  const jellyfinType = isTV ? 'Series' : 'Movie';
  const searchType = isTV ? 'tv' : 'movie';

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
            <MediaGrid
              items={[]}
              onItemClick={onItemClick}
              searchable
              searchMediaType={searchType}
              searchPlaceholder={`Rechercher ${isTV ? 'une série' : 'un film'}...`}
              emptyMessage={`Tapez pour rechercher des ${label.toLowerCase()}`}
            />
          </motion.div>
        )}
        {tab === 'dagzrank' && (
          <motion.div key="dagzrank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center gap-2 mb-6"><Sparkles className="w-5 h-5 text-red-500" /><h2 className="text-lg font-bold">Recommandations personnalisées</h2></div>
            <MediaGrid
              items={recos}
              onItemClick={onItemClick}
              loading={recoLoading}
              emptyMessage="Aucune recommandation disponible"
            />
          </motion.div>
        )}
        {tab === 'library' && (
          <motion.div key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex items-center gap-2 mb-6"><Library className="w-5 h-5 text-blue-400" /><h2 className="text-lg font-bold">Disponible sur votre serveur</h2></div>
            <MediaGrid
              items={library}
              onItemClick={onItemClick}
              loading={libLoading}
              searchable
              searchMediaType={searchType}
              searchPlaceholder={`Filtrer dans la bibliothèque...`}
              emptyMessage={`Aucun ${isTV ? 'série' : 'film'} dans la bibliothèque`}
            />
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

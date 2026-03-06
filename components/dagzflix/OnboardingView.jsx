'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Heart, ThumbsDown, Sparkles, Loader2 } from 'lucide-react';
import { api, invalidateCache } from '@/lib/api';
import { pageVariants, GENRE_LIST, GENRE_ICONS } from '@/lib/constants';

export function OnboardingView({ onComplete }) {
  const [fav, setFav] = useState([]);
  const [dis, setDis] = useState([]);
  const [saving, setSaving] = useState(false);

  const toggle = (g, list, setList, other, setOther) => {
    if (other.includes(g)) setOther(other.filter(x => x !== g));
    setList(list.includes(g) ? list.filter(x => x !== g) : [...list, g]);
  };

  const save = async () => {
    setSaving(true);
    await api('preferences', { method: 'POST', body: JSON.stringify({ favoriteGenres: fav, dislikedGenres: dis }) });
    invalidateCache('preferences'); invalidateCache('recommendations');
    setSaving(false); onComplete();
  };

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-red-600/15 rounded-3xl flex items-center justify-center mx-auto mb-5"><Sparkles className="w-8 h-8 text-red-500" /></div>
          <h2 className="text-3xl font-bold mb-2">Bienvenue !</h2>
          <p className="text-gray-500">Personnalisez vos recommandations</p>
        </div>
        <div className="glass-strong rounded-3xl p-8 mb-6">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><Heart className="w-5 h-5 text-red-500" />Genres adorés</h3>
          <div className="flex flex-wrap gap-2">
            {GENRE_LIST.map(g => (
              <button key={g} data-testid={`onboard-fav-${g}`} onClick={() => toggle(g, fav, setFav, dis, setDis)}
                className={`px-4 py-2.5 rounded-2xl text-sm font-medium transition-all ${fav.includes(g) ? 'bg-red-600 text-white shadow-lg shadow-red-600/20 scale-105' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                {GENRE_ICONS[g]} {g}
              </button>
            ))}
          </div>
        </div>
        <div className="glass-strong rounded-3xl p-8 mb-8">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><ThumbsDown className="w-5 h-5 text-gray-500" />Genres à éviter</h3>
          <div className="flex flex-wrap gap-2">
            {GENRE_LIST.map(g => (
              <button key={g} data-testid={`onboard-dis-${g}`} onClick={() => toggle(g, dis, setDis, fav, setFav)}
                className={`px-4 py-2.5 rounded-2xl text-sm font-medium transition-all ${dis.includes(g) ? 'bg-gray-600 text-white line-through' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                {GENRE_ICONS[g]} {g}
              </button>
            ))}
          </div>
        </div>
        <Button data-testid="onboard-save" onClick={save} disabled={saving} className="w-full h-14 bg-red-600 hover:bg-red-700 font-bold text-lg rounded-2xl">
          {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Sparkles className="w-5 h-5 mr-2" />}Commencer
        </Button>
        <button data-testid="onboard-skip" onClick={onComplete} className="w-full mt-4 text-gray-600 hover:text-gray-400 text-sm">Passer</button>
      </div>
    </motion.div>
  );
}

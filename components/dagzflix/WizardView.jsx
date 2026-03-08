'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Wand2, ChevronLeft, Star, Info, AlertCircle, Sparkles, CalendarDays, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { MOODS, ERAS, DURATIONS } from '@/lib/constants';
import { MediaCard } from './MediaCard';

export function WizardView({ mediaType, onItemClick }) {
  const [step, setStep] = useState(1);
  const [mood, setMood] = useState('');
  const [era, setEra] = useState('');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [excludedIds, setExcludedIds] = useState([]);

  const isTV = mediaType === 'series';

  const discover = async (extraExcludeIds = []) => {
    setLoading(true); setResult(null); setAlternatives([]);
    try {
      const mergedExclude = Array.from(new Set([...(excludedIds || []), ...(extraExcludeIds || [])].filter(Boolean)));
      const r = await api('wizard/discover', {
        method: 'POST',
        body: JSON.stringify({ mood, era, duration, mediaType: isTV ? 'tv' : 'movie', excludeIds: mergedExclude }),
      });
      setResult(r.perfectMatch); setAlternatives(r.alternatives || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const rejectAndRetry = async () => {
    if (!result) return;
    const rejectId = result.tmdbId || result.id;
    const nextExcludedIds = Array.from(new Set([...(excludedIds || []), rejectId].filter(Boolean)));
    setExcludedIds(nextExcludedIds);
    try {
      await api('wizard/feedback', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reject',
          itemId: result.id,
          tmdbId: result.tmdbId,
          genres: result.genres || [],
        }),
      });
    } catch (e) {
      console.error(e);
    }
    await discover(nextExcludedIds);
  };

  const reset = () => { setStep(1); setMood(''); setEra(''); setDuration(''); setResult(null); setAlternatives([]); setExcludedIds([]); };

  useEffect(() => { if (step === 4 && mood && era && duration) discover(); }, [step]);

  return (
    <div data-testid="wizard-view" className="pt-8">
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="w1" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="text-center">
            <div className="w-20 h-20 bg-purple-600/15 rounded-3xl flex items-center justify-center mx-auto mb-6"><Wand2 className="w-10 h-10 text-purple-400" /></div>
            <h2 className="text-2xl font-bold mb-2">Quelle est ton humeur ?</h2>
            <p className="text-gray-500 mb-8">Dis-moi ce que tu ressens ce soir</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 max-w-3xl mx-auto">
              {MOODS.map(m => (
                <button key={m.id} data-testid={`wizard-mood-${m.id}`} onClick={() => { setMood(m.id); setStep(2); }}
                  className="glass-card rounded-3xl p-6 text-center hover:scale-105 transition-all group">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${m.color} flex items-center justify-center mx-auto mb-4 group-hover:shadow-lg transition-all`}>
                    <m.icon className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="font-bold text-white mb-1">{m.label}</h3>
                  <p className="text-xs text-gray-500">{m.desc}</p>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="w2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="text-center">
            <div className="w-20 h-20 bg-blue-600/15 rounded-3xl flex items-center justify-center mx-auto mb-6"><CalendarDays className="w-10 h-10 text-blue-400" /></div>
            <h2 className="text-2xl font-bold mb-2">De quelle époque ?</h2>
            <p className="text-gray-500 mb-8">Choisis la période qui te parle</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
              {ERAS.map(e => (
                <button key={e.id} data-testid={`wizard-era-${e.id}`} onClick={() => { setEra(e.id); setStep(3); }}
                  className="glass-card rounded-3xl p-6 text-center hover:scale-105 transition-all">
                  <h3 className="font-bold text-white mb-1">{e.label}</h3>
                  <p className="text-xs text-gray-500">{e.desc}</p>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(1)} className="mt-6 text-gray-600 hover:text-gray-400 text-sm flex items-center gap-1 mx-auto"><ChevronLeft className="w-4 h-4" />Retour</button>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="w3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="text-center">
            <div className="w-20 h-20 bg-green-600/15 rounded-3xl flex items-center justify-center mx-auto mb-6"><Timer className="w-10 h-10 text-green-400" /></div>
            <h2 className="text-2xl font-bold mb-2">Combien de temps as-tu ?</h2>
            <p className="text-gray-500 mb-8">On adapte la durée à ton planning</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
              {DURATIONS.map(dd => (
                <button key={dd.id} data-testid={`wizard-dur-${dd.id}`} onClick={() => { setDuration(dd.id); setStep(4); }}
                  className="glass-card rounded-3xl p-6 text-center hover:scale-105 transition-all">
                  <h3 className="font-bold text-white mb-1">{dd.label}</h3>
                  <p className="text-xs text-gray-500">{dd.desc}</p>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(2)} className="mt-6 text-gray-600 hover:text-gray-400 text-sm flex items-center gap-1 mx-auto"><ChevronLeft className="w-4 h-4" />Retour</button>
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="w4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            {loading ? (
              <div className="text-center py-20">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }} className="w-20 h-20 mx-auto mb-6">
                  <Wand2 className="w-20 h-20 text-purple-400" />
                </motion.div>
                <h2 className="text-xl font-bold mb-2">Le Magicien cherche...</h2>
                <p className="text-gray-500">Analyse de tes goûts en cours</p>
              </div>
            ) : result ? (
              <div>
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold mb-2">Nous avons trouvé LE {isTV ? 'programme' : 'film'} parfait pour toi</h2>
                  <p className="text-gray-500">Basé sur ton humeur, tes préférences et notre algorithme</p>
                </div>
                <div data-testid="wizard-result" className="relative max-w-4xl mx-auto mb-12 rounded-3xl overflow-hidden glass-strong">
                  <div className="flex flex-col md:flex-row">
                    {result.backdropUrl && (
                      <div className="absolute inset-0"><img src={result.backdropUrl} alt="" className="w-full h-full object-cover opacity-20" /><div className="absolute inset-0 bg-gradient-to-r from-[#050505] via-[#050505]/80 to-transparent" /></div>
                    )}
                    <div className="relative flex flex-col md:flex-row gap-8 p-8">
                      <div className="w-40 md:w-52 flex-shrink-0">{result.posterUrl && <img src={result.posterUrl} alt={result.name} className="w-full rounded-2xl shadow-2xl" />}</div>
                      <div className="flex-1">
                        <Badge className="bg-purple-600 text-white mb-3"><Wand2 className="w-3 h-3 mr-1" />Match parfait</Badge>
                        <h3 className="text-3xl font-black mb-3">{result.name}</h3>
                        <div className="flex flex-wrap items-center gap-3 mb-4">
                          {result.year && <span className="text-gray-400">{result.year}</span>}
                          {result.voteAverage > 0 && <span className="flex items-center gap-1 text-yellow-400"><Star className="w-4 h-4 fill-current" />{result.voteAverage.toFixed(1)}</span>}
                        </div>
                        <p className="text-gray-300 mb-6 leading-relaxed line-clamp-4">{result.overview}</p>
                        <Button data-testid="wizard-result-detail" onClick={() => onItemClick(result)} className="bg-white hover:bg-gray-100 text-black font-bold px-8 h-12 rounded-xl">
                          <Info className="w-5 h-5 mr-2" />Voir les détails
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                {alternatives.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Sparkles className="w-5 h-5 text-purple-400" />Autres suggestions</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">{alternatives.slice(0, 6).map((a, i) => <MediaCard key={a.id || i} item={a} onClick={onItemClick} gridMode />)}</div>
                  </div>
                )}
                <div className="text-center mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                  <Button data-testid="wizard-retry" onClick={rejectAndRetry} variant="outline" className="border-white/10 text-gray-300 rounded-xl">
                    <Wand2 className="w-4 h-4 mr-2" />Réessayer
                  </Button>
                  <Button data-testid="wizard-reset" onClick={reset} variant="outline" className="border-white/10 text-gray-300 rounded-xl">
                    <Wand2 className="w-4 h-4 mr-2" />Relancer le Magicien
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-20">
                <AlertCircle className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">Aucun résultat</h3>
                <p className="text-gray-500 mb-6">Le Magicien n'a rien trouvé. Essaie d'autres critères !</p>
                <Button onClick={reset} variant="outline" className="border-white/10 text-gray-300 rounded-xl"><Wand2 className="w-4 h-4 mr-2" />Réessayer</Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

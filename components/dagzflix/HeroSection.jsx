'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Play, Info, Sparkles } from 'lucide-react';

export function HeroSection({ item, onPlay, onDetail }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div data-testid="hero-section" className="relative h-[75vh] min-h-[550px]">
      {!imgErr && item?.backdropUrl ? (
        <img src={item.backdropUrl} alt={item.name} className="absolute inset-0 w-full h-full object-cover" onError={() => setImgErr(true)} />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-[#050505]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/30 to-[#050505]/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#050505]/90 via-[#050505]/30 to-transparent" />
      <div className="relative z-10 h-full flex items-end">
        <div className="px-6 md:px-16 pb-24 max-w-3xl">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            {item?.dagzRank > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-red-600/20 backdrop-blur-sm border border-red-500/20 text-red-300 rounded-full px-3 py-1 text-sm font-medium mb-4">
                <Sparkles className="w-3.5 h-3.5" />Recommandé à {item.dagzRank}%
              </div>
            )}
            <h1 className="text-4xl md:text-6xl font-black mb-4 leading-[1.1]">{item?.name || 'DAGZFLIX'}</h1>
            {item?.overview && <p className="text-gray-300 text-base mb-8 line-clamp-3 max-w-xl font-light leading-relaxed">{item.overview}</p>}
            {item && (
              <div className="flex items-center gap-3">
                <Button data-testid="hero-play" onClick={() => onPlay(item)} className="bg-white hover:bg-gray-100 text-black font-bold px-8 h-13 text-base rounded-xl shadow-xl shadow-white/10">
                  <Play className="w-5 h-5 mr-2 fill-current" />Lecture
                </Button>
                <Button data-testid="hero-detail" onClick={() => onDetail(item)} variant="outline" className="border-white/20 text-white hover:bg-white/10 h-13 px-6 rounded-xl backdrop-blur">
                  <Info className="w-5 h-5 mr-2" />Plus d'infos
                </Button>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

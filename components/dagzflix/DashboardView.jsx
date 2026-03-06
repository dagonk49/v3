'use client';
import { useState, useEffect, useRef } from 'react';
import { Film, Tv, TrendingUp, Sparkles, Play, Clock } from 'lucide-react';
import { cachedApi } from '@/lib/api';
import { HeroSection } from './HeroSection';
import { MediaRow, MediaCard } from './MediaCard';

export function DashboardView({ user, onItemClick, onPlay }) {
  const [reco, setReco] = useState([]);
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [trendM, setTrendM] = useState([]);
  const [trendS, setTrendS] = useState([]);
  const [continueW, setContinueW] = useState([]);
  const [heroItem, setHeroItem] = useState(null);
  const heroRef = useRef(null);
  const [loads, setLoads] = useState({ reco: true, movies: true, series: true, trendM: true, trendS: true, continueW: true });

  useEffect(() => { load(); }, []);

  const load = async () => {
    const sl = (k, v) => setLoads(p => ({ ...p, [k]: v }));

    // Continue Watching
    sl('continueW', true);
    cachedApi('media/resume').then(r => {
      setContinueW(r.items || []);
      sl('continueW', false);
    }).catch(() => sl('continueW', false));

    // Recommendations
    sl('reco', true);
    cachedApi('recommendations').then(r => {
      const recs = r.recommendations || [];
      setReco(recs);
      if (recs.length > 0 && !heroRef.current) { heroRef.current = recs[0]; setHeroItem(recs[0]); }
      sl('reco', false);
    }).catch(() => sl('reco', false));

    // Recent movies
    sl('movies', true);
    cachedApi('media/library?type=Movie&limit=20&sortBy=DateCreated&sortOrder=Descending').then(r => {
      const i = r.items || [];
      setMovies(i);
      if (!heroRef.current && i.length > 0) { heroRef.current = i[0]; setHeroItem(i[0]); }
      sl('movies', false);
    }).catch(() => sl('movies', false));

    // Recent series
    sl('series', true);
    cachedApi('media/library?type=Series&limit=20&sortBy=DateCreated&sortOrder=Descending').then(r => { setSeries(r.items || []); sl('series', false); }).catch(() => sl('series', false));

    // Trending movies
    sl('trendM', true);
    cachedApi('discover?type=movies').then(r => { setTrendM(r.results || []); sl('trendM', false); }).catch(() => sl('trendM', false));

    // Trending series
    sl('trendS', true);
    cachedApi('discover?type=tv').then(r => { setTrendS(r.results || []); sl('trendS', false); }).catch(() => sl('trendS', false));
  };

  return (
    <div data-testid="dashboard-view" className="min-h-screen">
      <HeroSection item={heroItem} onPlay={onPlay} onDetail={onItemClick} />
      <div className="-mt-12 relative z-10">
        <MediaRow title="Reprendre la lecture" items={continueW} icon={<Play className="w-5 h-5 text-blue-400" />} onItemClick={onItemClick} loading={loads.continueW} />
        <MediaRow title="Recommandé pour vous" items={reco} icon={<Sparkles className="w-5 h-5 text-red-500" />} onItemClick={onItemClick} loading={loads.reco} size="large" />
        <MediaRow title="Films récents" items={movies} icon={<Film className="w-5 h-5 text-blue-400" />} onItemClick={onItemClick} loading={loads.movies} />
        <MediaRow title="Séries récentes" items={series} icon={<Tv className="w-5 h-5 text-green-400" />} onItemClick={onItemClick} loading={loads.series} />
        <MediaRow title="Tendances Films" items={trendM} icon={<TrendingUp className="w-5 h-5 text-orange-400" />} onItemClick={onItemClick} loading={loads.trendM} />
        <MediaRow title="Tendances Séries" items={trendS} icon={<TrendingUp className="w-5 h-5 text-purple-400" />} onItemClick={onItemClick} loading={loads.trendS} />
      </div>
      <div className="h-20" />
    </div>
  );
}

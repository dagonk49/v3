'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Play, Pause, ChevronLeft, Loader2, AlertCircle, SkipBack, SkipForward,
  Volume2, VolumeX, Subtitles, AudioLines, Maximize, Minimize,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/constants';
import Hls from 'hls.js';

/**
 * V0.013 — VideoPlayer optimisé
 * - MediaSession API : Le navigateur voit la vidéo (titre, contrôles OS)
 * - History API : Change l'URL en /watch/id pour faire plus propre
 * - HLS.js optimisé pour réduire la charge serveur (Remux favorisé)
 */
export function VideoPlayer({ item, episodeId, onClose }) {
  const [streamData, setStreamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [activeSub, setActiveSub] = useState(-1);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [hlsAudioTracks, setHlsAudioTracks] = useState([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMobile] = useState(() => typeof window !== 'undefined' && 'ontouchstart' in window);
  const [doubleTapSide, setDoubleTapSide] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const ctrlTimer = useRef(null);
  const progressRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const containerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0 });
  const doubleTapTimer = useRef(null);

  // ── 1. Gestion de l'URL virtuelle (Fake routing) ──
  useEffect(() => {
    const idToWatch = episodeId || item?.localId || item?.id;
    const originalTitle = document.title;
    const originalUrl = window.location.href;

    if (idToWatch) {
      window.history.pushState({ playerOpen: true }, '', `/watch/${idToWatch}`);
      document.title = `Lecture : ${item?.name || 'Vidéo'} - DagzFlix`;
    }

    const handlePopState = () => {
      // Si l'utilisateur fait "Précédent" dans le navigateur, on ferme le lecteur
      onClose();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // On remet l'URL d'origine sans recharger la page
      if (window.location.pathname.includes('/watch/')) {
        window.history.pushState({}, '', originalUrl);
      }
      document.title = originalTitle;
    };
  }, [episodeId, item?.id, item?.localId, item?.name, onClose]);

  // ── 2. Intégration MediaSession (Contrôles Navigateur/OS) ──
  useEffect(() => {
    if ('mediaSession' in navigator && item) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: item.name || 'Vidéo en cours',
        artist: 'DagzFlix',
        album: item.seriesName || 'Films & Séries',
        artwork: [
          { src: item.backdropUrl || item.posterUrl || '', sizes: '1280x720', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', togglePlay);
      navigator.mediaSession.setActionHandler('pause', togglePlay);
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    }
    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
      }
    };
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch stream metadata ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = episodeId || item?.localId || item?.id;
        if (!id) { setError('ID manquant'); setLoading(false); return; }
        // On demande le stream au backend
        const r = await api(`media/stream?id=${id}`);
        if (cancelled) return;
        if (r.streamUrl) {
          setStreamData(r);
          if (r.duration) setDuration(r.duration);
        } else {
          setError(r.error || 'Stream indisponible');
        }
      } catch (e) {
        if (!cancelled) setError(`Connexion au serveur échouée : ${e.message}`);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [episodeId, item, retryCount]);

  // ── Configuration HLS.js ──
  useEffect(() => {
    if (!streamData || !videoRef.current) return;
    const video = videoRef.current;
    const resumeSec = item?.playbackPositionTicks ? Math.floor(item.playbackPositionTicks / 10_000_000) : 0;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 60,
        maxMaxBufferLength: 120, // Plus de buffer pour éviter les micro-coupures
        startLevel: -1, 
        capLevelToPlayerSize: true, // Optimise la qualité selon la taille de l'écran
      });
      hlsRef.current = hls;

      hls.loadSource(streamData.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setHlsAudioTracks(hls.audioTracks || []);
        setActiveAudioTrack(hls.audioTrack);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              if (streamData.fallbackStreamUrl) {
                video.src = streamData.fallbackStreamUrl;
                if (resumeSec > 0) video.currentTime = resumeSec;
                video.play().catch(() => {});
              } else {
                setError('Le codec vidéo n\'est pas supporté par votre navigateur actuel.');
              }
              break;
          }
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamData.streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
      }, { once: true });
    } else {
      video.src = streamData.fallbackStreamUrl || streamData.streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
      }, { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Progress reporting ──
  const reportProgress = useCallback(async ({ isPaused = false, isStopped = false } = {}) => {
    try {
      const video = videoRef.current;
      const itemId = episodeId || item?.id;
      if (!video || !itemId || !streamData) return;
      const positionTicks = Math.max(0, Math.floor(video.currentTime * 10_000_000));
      await api('media/progress', {
        method: 'POST',
        body: JSON.stringify({
          itemId,
          mediaSourceId: streamData.mediaSourceId || itemId,
          playSessionId: streamData.playSessionId || '',
          positionTicks,
          isPaused,
          isStopped,
        }),
      });
    } catch (_) { }
  }, [episodeId, item?.id, streamData]);

  useEffect(() => {
    if (!streamData) return;
    progressIntervalRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) reportProgress({ isPaused: false });
    }, 10_000);
    return () => {
      clearInterval(progressIntervalRef.current);
      reportProgress({ isPaused: true, isStopped: true });
    };
  }, [streamData, reportProgress]);

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.duration && isFinite(v.duration)) setDuration(v.duration);
    if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
  };

  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (ctrlTimer.current) clearTimeout(ctrlTimer.current);
    ctrlTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setShowControls(false);
    }, 4000);
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    resetTimer();
  };

  const skip = (s) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + s));
    resetTimer();
  };

  const handleVol = (val) => {
    const v = videoRef.current;
    if (!v) return;
    const f = parseFloat(val);
    v.volume = f; setVolume(f);
    v.muted = f === 0; setIsMuted(f === 0);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
    if (!v.muted && v.volume === 0) { v.volume = 0.5; setVolume(0.5); }
  };

  const handleSeek = (e) => {
    const v = videoRef.current;
    if (!v || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = pct * (v.duration || 0);
    resetTimer();
  };

  const handleVideoAreaTap = useCallback((e) => {
    if (!isMobile) return;
    const now = Date.now();
    const x = e.touches?.[0]?.clientX ?? e.clientX;
    const dt = now - lastTapRef.current.time;
    const dx = Math.abs(x - lastTapRef.current.x);

    if (dt < 350 && dx < 80) {
      const el = containerRef.current || videoRef.current?.parentElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const side = (x - rect.left) < rect.width / 2 ? 'left' : 'right';
      skip(side === 'left' ? -10 : 10);
      setDoubleTapSide(side);
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      doubleTapTimer.current = setTimeout(() => setDoubleTapSide(null), 600);
      e.preventDefault();
      lastTapRef.current = { time: 0, x: 0 };
    } else {
      lastTapRef.current = { time: now, x };
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      doubleTapTimer.current = setTimeout(() => togglePlay(), 300);
    }
  }, [isMobile, skip, togglePlay]);

  const toggleFS = () => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const handleSub = (idx) => {
    setActiveSub(idx);
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === idx ? 'showing' : 'hidden';
    }
    setShowSubMenu(false);
  };

  const handleAudioTrack = (idx) => {
    if (hlsRef.current && hlsRef.current.audioTracks?.length > 0) {
      hlsRef.current.audioTrack = idx;
    }
    setShowAudioMenu(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const buffPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const subtitlesMeta = streamData?.subtitles || [];
  const audioTracksMeta = hlsAudioTracks.length > 0
    ? hlsAudioTracks.map((t, i) => ({ index: i, displayTitle: t.name || t.lang || `Audio ${i + 1}`, channels: 0, isDefault: i === activeAudioTrack }))
    : (streamData?.audioTracks || []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] bg-black flex items-center justify-center" onMouseMove={resetTimer}>
      {loading ? (
        <div className="text-center"><Loader2 className="w-12 h-12 animate-spin text-red-600 mx-auto mb-4" /><p className="text-gray-400">Chargement du lecteur…</p></div>
      ) : error ? (
        <div className="text-center max-w-md px-6">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">Lecture impossible</h3>
          <p className="text-gray-400 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setError(''); setLoading(true); setStreamData(null); setRetryCount(c => c + 1); }} className="bg-red-600 hover:bg-red-700 rounded-xl">Réessayer</Button>
            <Button onClick={onClose} className="bg-white/10 hover:bg-white/20 rounded-xl">Fermer</Button>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full relative">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            crossOrigin="anonymous"
            onTimeUpdate={onTimeUpdate}
            onPlay={() => { setIsPlaying(true); reportProgress({ isPaused: false }); }}
            onPause={() => { setIsPlaying(false); setShowControls(true); reportProgress({ isPaused: true }); }}
            onLoadedMetadata={(e) => { if (e.target.duration && isFinite(e.target.duration)) setDuration(e.target.duration); }}
            onClick={isMobile ? undefined : togglePlay}
            onTouchEnd={isMobile ? handleVideoAreaTap : undefined}
          >
            {subtitlesMeta.map((s, i) => <track key={i} kind="subtitles" src={s.url} srcLang={s.language} label={s.displayTitle} />)}
          </video>

          <AnimatePresence>
            {doubleTapSide && (
              <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={`absolute top-1/2 -translate-y-1/2 ${doubleTapSide === 'left' ? 'left-12' : 'right-12'} w-16 h-16 rounded-full bg-white/20 backdrop-blur flex items-center justify-center pointer-events-none z-20`}>
                {doubleTapSide === 'left' ? <SkipBack className="w-7 h-7" /> : <SkipForward className="w-7 h-7" />}
                <span className="absolute -bottom-5 text-xs text-white/80 font-bold">10s</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`absolute inset-0 transition-opacity duration-500 z-10 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-6 flex items-center justify-between">
              <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xl flex items-center justify-center hover:bg-white/20 pointer-events-auto"><ChevronLeft className="w-6 h-6" /></button>
              <h3 className="text-base font-bold truncate flex-1 text-center px-4">{item?.name}</h3>
              <div className="w-10" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center gap-8 sm:gap-12 pointer-events-none">
              <button onClick={() => skip(-10)} className="w-14 h-14 sm:w-14 sm:h-14 rounded-full bg-white/10 backdrop-blur-xl flex flex-col items-center justify-center hover:bg-white/20 pointer-events-auto active:scale-90 transition-transform"><SkipBack className="w-5 h-5" /><span className="text-[9px] text-gray-400 mt-0.5">10s</span></button>
              <button onClick={togglePlay} className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center hover:bg-white/30 pointer-events-auto shadow-2xl active:scale-90 transition-transform" style={{ width: '4.5rem', height: '4.5rem' }}>{isPlaying ? <Pause className="w-9 h-9 sm:w-10 sm:h-10" /> : <Play className="w-9 h-9 sm:w-10 sm:h-10 ml-1" />}</button>
              <button onClick={() => skip(30)} className="w-14 h-14 sm:w-14 sm:h-14 rounded-full bg-white/10 backdrop-blur-xl flex flex-col items-center justify-center hover:bg-white/20 pointer-events-auto active:scale-90 transition-transform"><SkipForward className="w-5 h-5" /><span className="text-[9px] text-gray-400 mt-0.5">30s</span></button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 sm:p-6 pt-16 pointer-events-auto">
              <div className="mb-3 sm:mb-4 group/prog cursor-pointer" ref={progressRef} onClick={handleSeek} onTouchEnd={handleSeek}>
                <div className="relative h-2 sm:h-1.5 group-hover/prog:h-3 bg-white/15 rounded-full transition-all overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-white/20 rounded-full" style={{ width: `${buffPct}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-red-600 rounded-full" style={{ width: `${progress}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 sm:w-4 sm:h-4 bg-red-600 rounded-full shadow-lg opacity-100 sm:opacity-0 group-hover/prog:opacity-100" style={{ left: `${progress}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="text-xs sm:text-sm font-mono text-gray-300">{formatTime(currentTime)}</span>
                  <span className="text-xs sm:text-sm text-gray-600">/</span>
                  <span className="text-xs sm:text-sm font-mono text-gray-500">{formatTime(duration)}</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className={`flex items-center gap-1 sm:gap-2 ${isMobile ? '' : 'group/vol'}`}>
                    <button onClick={toggleMute} className="p-2 sm:p-2 rounded-xl hover:bg-white/10 min-w-[40px] min-h-[40px] flex items-center justify-center">{isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-gray-400" /> : <Volume2 className="w-5 h-5" />}</button>
                    <div className={isMobile ? 'w-20' : 'w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300'}>
                      <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={e => handleVol(e.target.value)} className="w-20 sm:w-24 h-1.5 sm:h-1 appearance-none bg-white/20 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 sm:[&::-webkit-slider-thumb]:w-3 sm:[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full" />
                    </div>
                  </div>
                  {subtitlesMeta.length > 0 && (
                    <div className="relative">
                      <button onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }} className={`p-2 rounded-xl transition-all min-w-[40px] min-h-[40px] flex items-center justify-center ${activeSub >= 0 ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-400'}`}><Subtitles className="w-5 h-5" /></button>
                      {showSubMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[220px] max-h-[50vh] overflow-y-auto shadow-2xl">
                          <button onClick={() => handleSub(-1)} className={`w-full text-left px-4 py-3 sm:px-3 sm:py-2 rounded-xl text-sm ${activeSub === -1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>Désactiver</button>
                          {subtitlesMeta.map((s, i) => <button key={i} onClick={() => handleSub(i)} className={`w-full text-left px-4 py-3 sm:px-3 sm:py-2 rounded-xl text-sm ${activeSub === i ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{s.displayTitle}</button>)}
                        </div>
                      )}
                    </div>
                  )}
                  {audioTracksMeta.length > 1 && (
                    <div className="relative">
                      <button onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }} className="p-2 rounded-xl hover:bg-white/10 text-gray-400 min-w-[40px] min-h-[40px] flex items-center justify-center"><AudioLines className="w-5 h-5" /></button>
                      {showAudioMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[220px] shadow-2xl">
                          {audioTracksMeta.map((a, i) => <button key={i} onClick={() => handleAudioTrack(a.index ?? i)} className={`w-full text-left px-4 py-3 sm:px-3 sm:py-2 rounded-xl text-sm ${a.isDefault || activeAudioTrack === a.index ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{a.displayTitle}{a.channels ? ` (${a.channels}ch)` : ''}</button>)}
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={toggleFS} className="p-2 rounded-xl hover:bg-white/10 min-w-[40px] min-h-[40px] flex items-center justify-center">{isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
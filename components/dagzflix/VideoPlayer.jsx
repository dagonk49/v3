'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Play, Pause, ChevronLeft, Loader2, AlertCircle, SkipBack, SkipForward,
  Volume2, VolumeX, Subtitles, AudioLines, Maximize,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/constants';

export function VideoPlayer({ item, episodeId, onClose }) {
  const [streamUrl, setStreamUrl] = useState('');
  const [fallbackStreamUrl, setFallbackStreamUrl] = useState('');
  const [playSessionId, setPlaySessionId] = useState('');
  const [mediaSourceId, setMediaSourceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [subtitles, setSubtitles] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeSub, setActiveSub] = useState(-1);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const videoRef = useRef(null);
  const ctrlTimer = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    fetchStream();
    return () => { if (ctrlTimer.current) clearTimeout(ctrlTimer.current); };
  }, []);

  const fetchStream = async () => {
    try {
      // V7.6: Prefer localId for streaming (resolved Jellyfin ID), fallback to item.id
      const id = episodeId || item?.localId || item?.id;
      if (!id) { setError('ID manquant'); setLoading(false); return; }
      const r = await api(`media/stream?id=${id}`);
      if (r.streamUrl) {
        setStreamUrl(r.streamUrl);
        setFallbackStreamUrl(r.fallbackStreamUrl || '');
        setSubtitles(r.subtitles || []);
        setAudioTracks(r.audioTracks || []);
        setPlaySessionId(r.playSessionId || '');
        setMediaSourceId(r.mediaSourceId || id);
        if (r.duration) setDuration(r.duration);
      } else {
        setError(r.error || 'Stream indisponible');
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (ctrlTimer.current) clearTimeout(ctrlTimer.current);
    ctrlTimer.current = setTimeout(() => { if (isPlaying) setShowControls(false); }, 4000);
  }, [isPlaying]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { videoRef.current.play(); setIsPlaying(true); }
    else { videoRef.current.pause(); setIsPlaying(false); }
    resetTimer();
  };

  const skip = (s) => { if (!videoRef.current) return; videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + s)); resetTimer(); };
  const handleVol = (v) => { if (!videoRef.current) return; const val = parseFloat(v); setVolume(val); videoRef.current.volume = val; setIsMuted(val === 0); };
  const toggleMute = () => { if (!videoRef.current) return; if (isMuted) { videoRef.current.muted = false; videoRef.current.volume = volume || 0.5; setIsMuted(false); } else { videoRef.current.muted = true; setIsMuted(true); } };
  const handleSeek = (e) => { if (!videoRef.current || !progressRef.current) return; const rect = progressRef.current.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); videoRef.current.currentTime = pct * (videoRef.current.duration || 0); resetTimer(); };
  const toggleFS = () => { const el = videoRef.current?.parentElement?.parentElement; if (document.fullscreenElement) document.exitFullscreen(); else el?.requestFullscreen?.(); };
  const handleSub = (idx) => { setActiveSub(idx); if (!videoRef.current) return; const tracks = videoRef.current.textTracks; for (let i = 0; i < tracks.length; i++) { tracks[i].mode = i === idx ? 'showing' : 'hidden'; } setShowSubMenu(false); };
  const onTimeUpdate = () => { if (!videoRef.current) return; setCurrentTime(videoRef.current.currentTime); if (videoRef.current.duration) setDuration(videoRef.current.duration); if (videoRef.current.buffered.length > 0) setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1)); };

  const reportProgress = useCallback(async ({ isPaused = false, isStopped = false } = {}) => {
    try {
      const video = videoRef.current;
      const itemId = episodeId || item?.id;
      if (!video || !itemId) return;
      const positionTicks = Math.max(0, Math.floor(video.currentTime * 10000000));
      await api('media/progress', {
        method: 'POST',
        body: JSON.stringify({
          itemId,
          mediaSourceId,
          playSessionId,
          positionTicks,
          isPaused,
          isStopped,
        }),
      });
    } catch (_) {
      // Silently ignore progress ping failures to avoid disrupting playback UI
    }
  }, [episodeId, item?.id, mediaSourceId, playSessionId]);

  useEffect(() => {
    if (!streamUrl) return;
    const id = setInterval(() => {
      reportProgress({ isPaused: !isPlaying, isStopped: false });
    }, 10000);

    return () => {
      clearInterval(id);
      reportProgress({ isPaused: true, isStopped: true });
    };
  }, [streamUrl, isPlaying, reportProgress]);

  const handleVideoError = () => {
    if (fallbackStreamUrl && fallbackStreamUrl !== streamUrl) {
      setStreamUrl(fallbackStreamUrl);
      setError('');
      return;
    }
    setError('Lecture impossible pour cette source.');
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const buffPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="video-player" className="fixed inset-0 z-[200] bg-black flex items-center justify-center" onMouseMove={resetTimer}>
      {loading ? (
        <div className="text-center"><Loader2 className="w-12 h-12 animate-spin text-red-600 mx-auto mb-4" /><p className="text-gray-400">Chargement Direct Play...</p></div>
      ) : error ? (
        <div className="text-center max-w-md"><AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" /><h3 className="text-xl font-bold mb-2">Lecture impossible</h3><p className="text-gray-400 mb-6">{error}</p><Button onClick={onClose} className="bg-white/10 hover:bg-white/20 rounded-xl">Fermer</Button></div>
      ) : (
        <div className="w-full h-full relative">
          <video ref={videoRef} src={streamUrl} className="w-full h-full object-contain" autoPlay
            onTimeUpdate={onTimeUpdate}
            onPlay={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                if (videoRef.current.volume === 0) videoRef.current.volume = 1;
              }
              setIsPlaying(true);
              setIsMuted(false);
              reportProgress({ isPaused: false, isStopped: false });
            }}
            onPause={() => { setIsPlaying(false); setShowControls(true); reportProgress({ isPaused: true, isStopped: false }); }}
            onLoadedMetadata={(e) => setDuration(e.target.duration)}
            onError={handleVideoError}
            onClick={togglePlay}
          >
            {subtitles.map((s, i) => <track key={i} kind="subtitles" src={s.url} srcLang={s.language} label={s.displayTitle} />)}
          </video>
          <div className={`absolute inset-0 transition-opacity duration-500 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {/* Top bar */}
            <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-6 flex items-center justify-between">
              <button data-testid="player-close" onClick={onClose} className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xl flex items-center justify-center hover:bg-white/20"><ChevronLeft className="w-6 h-6" /></button>
              <h3 className="text-base font-bold truncate flex-1 text-center px-4">{item?.name}</h3>
              <div className="w-10" />
            </div>
            {/* Center controls */}
            <div className="absolute inset-0 flex items-center justify-center gap-12 pointer-events-none">
              <button onClick={() => skip(-10)} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-xl flex flex-col items-center justify-center hover:bg-white/20 pointer-events-auto"><SkipBack className="w-5 h-5" /><span className="text-[9px] text-gray-400 mt-0.5">10s</span></button>
              <button data-testid="player-playpause" onClick={togglePlay} className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center hover:bg-white/30 pointer-events-auto shadow-2xl">{isPlaying ? <Pause className="w-10 h-10" /> : <Play className="w-10 h-10 ml-1" />}</button>
              <button onClick={() => skip(30)} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-xl flex flex-col items-center justify-center hover:bg-white/20 pointer-events-auto"><SkipForward className="w-5 h-5" /><span className="text-[9px] text-gray-400 mt-0.5">30s</span></button>
            </div>
            {/* Bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-6 pt-16">
              <div className="mb-4 group/prog cursor-pointer" ref={progressRef} onClick={handleSeek}>
                <div className="relative h-1.5 group-hover/prog:h-3 bg-white/15 rounded-full transition-all overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-white/20 rounded-full" style={{ width: `${buffPct}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-red-600 rounded-full" style={{ width: `${progress}%` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-red-600 rounded-full shadow-lg opacity-0 group-hover/prog:opacity-100" style={{ left: `${progress}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-gray-300">{formatTime(currentTime)}</span>
                  <span className="text-sm text-gray-600">/</span>
                  <span className="text-sm font-mono text-gray-500">{formatTime(duration)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 group/vol">
                    <button onClick={toggleMute} className="p-2 rounded-xl hover:bg-white/10">{isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-gray-400" /> : <Volume2 className="w-5 h-5" />}</button>
                    <div className="w-0 group-hover/vol:w-24 overflow-hidden transition-all duration-300">
                      <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={e => handleVol(e.target.value)} className="w-24 h-1 appearance-none bg-white/20 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full" />
                    </div>
                  </div>
                  {subtitles.length > 0 && (
                    <div className="relative">
                      <button data-testid="player-subs-toggle" onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }} className={`p-2 rounded-xl transition-all ${activeSub >= 0 ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-400'}`}><Subtitles className="w-5 h-5" /></button>
                      {showSubMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                          <button onClick={() => handleSub(-1)} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activeSub === -1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>Désactiver</button>
                          {subtitles.map((s, i) => <button key={i} onClick={() => handleSub(i)} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activeSub === i ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{s.displayTitle}</button>)}
                        </div>
                      )}
                    </div>
                  )}
                  {audioTracks.length > 1 && (
                    <div className="relative">
                      <button onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }} className="p-2 rounded-xl hover:bg-white/10 text-gray-400"><AudioLines className="w-5 h-5" /></button>
                      {showAudioMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[200px]">
                          {audioTracks.map((a, i) => <button key={i} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${a.isDefault ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{a.displayTitle} ({a.channels}ch)</button>)}
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={toggleFS} className="p-2 rounded-xl hover:bg-white/10"><Maximize className="w-5 h-5" /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

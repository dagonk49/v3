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
import Hls from 'hls.js';

/**
 * V0.010 — VideoPlayer powered by hls.js
 * - Reliable HLS playback via hls.js (audio always transcoded to AAC by Jellyfin)
 * - Native Safari HLS fallback
 * - Direct Play fallback if HLS fails entirely
 * - Custom DagzFlix overlay controls
 * - Cross-sync progression (resume + report every 10 s)
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

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const ctrlTimer = useRef(null);
  const progressRef = useRef(null);
  const progressIntervalRef = useRef(null);

  // ── Fetch stream metadata ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = episodeId || item?.localId || item?.id;
        if (!id) { setError('ID manquant'); setLoading(false); return; }
        const r = await api(`media/stream?id=${id}`);
        if (cancelled) return;
        if (r.streamUrl) {
          setStreamData(r);
          if (r.duration) setDuration(r.duration);
        } else {
          setError(r.error || 'Stream indisponible');
        }
      } catch (e) { if (!cancelled) setError(e.message); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [episodeId, item?.localId, item?.id]);

  // ── Attach hls.js or native HLS once we have stream data ──
  useEffect(() => {
    if (!streamData || !videoRef.current) return;
    const video = videoRef.current;

    const resumeSec = item?.playbackPositionTicks
      ? Math.floor(item.playbackPositionTicks / 10_000_000)
      : 0;

    // Try hls.js first (Chrome, Firefox, Edge)
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1,  // auto quality
      });
      hlsRef.current = hls;

      hls.loadSource(streamData.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
      });

      // Expose HLS audio tracks for the track switcher
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        setHlsAudioTracks(hls.audioTracks || []);
        setActiveAudioTrack(hls.audioTrack);
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        setActiveAudioTrack(data.id);
      });

      // Fatal error → try Direct Play fallback
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.warn('[HLS] fatal error, trying direct play fallback', data.type);
          hls.destroy();
          hlsRef.current = null;
          if (streamData.fallbackStreamUrl) {
            video.src = streamData.fallbackStreamUrl;
            if (resumeSec > 0) video.currentTime = resumeSec;
            video.play().catch(() => {});
          } else {
            setError('Lecture impossible pour cette source.');
          }
        }
      });

    // Safari native HLS
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamData.streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
      }, { once: true });
      video.addEventListener('error', () => {
        if (streamData.fallbackStreamUrl) {
          video.src = streamData.fallbackStreamUrl;
          if (resumeSec > 0) video.currentTime = resumeSec;
          video.play().catch(() => {});
        } else {
          setError('Lecture impossible pour cette source.');
        }
      }, { once: true });

    // No HLS support at all → Direct Play
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
    } catch (_) { /* fire-and-forget */ }
  }, [episodeId, item?.id, streamData]);

  // ── 10 s progress interval + events ──
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

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (ctrlTimer.current) clearTimeout(ctrlTimer.current);
    };
  }, []);

  // ── Video element event handlers ──
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.duration && isFinite(v.duration)) setDuration(v.duration);
    if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
  };

  // ── Custom controls helpers ──
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
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
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
    v.volume = f;
    setVolume(f);
    v.muted = f === 0;
    setIsMuted(f === 0);
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted) { v.muted = false; if (v.volume === 0) v.volume = 0.5; setVolume(v.volume); setIsMuted(false); }
    else { v.muted = true; setIsMuted(true); }
  };

  const handleSeek = (e) => {
    const v = videoRef.current;
    if (!v || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * (v.duration || 0);
    resetTimer();
  };

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
    const tracks = v.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === idx ? 'showing' : 'hidden';
    }
    setShowSubMenu(false);
  };

  const handleAudioTrack = (idx) => {
    const hls = hlsRef.current;
    if (hls && hls.audioTracks?.length > 0) {
      hls.audioTrack = idx;
    }
    setShowAudioMenu(false);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const buffPct = duration > 0 ? (buffered / duration) * 100 : 0;

  // Use hls.js audio tracks if available, otherwise fall back to API metadata
  const subtitlesMeta = streamData?.subtitles || [];
  const audioTracksMeta = hlsAudioTracks.length > 0
    ? hlsAudioTracks.map((t, i) => ({ index: i, displayTitle: t.name || t.lang || `Audio ${i + 1}`, channels: 0, isDefault: i === activeAudioTrack }))
    : (streamData?.audioTracks || []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-testid="video-player" className="fixed inset-0 z-[200] bg-black flex items-center justify-center" onMouseMove={resetTimer}>
      {loading ? (
        <div className="text-center"><Loader2 className="w-12 h-12 animate-spin text-red-600 mx-auto mb-4" /><p className="text-gray-400">Chargement du lecteur…</p></div>
      ) : error ? (
        <div className="text-center max-w-md"><AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" /><h3 className="text-xl font-bold mb-2">Lecture impossible</h3><p className="text-gray-400 mb-6">{error}</p><Button onClick={onClose} className="bg-white/10 hover:bg-white/20 rounded-xl">Fermer</Button></div>
      ) : (
        <div className="w-full h-full relative">
          <video
            ref={videoRef}
            className="w-full h-full object-contain"
            playsInline
            onTimeUpdate={onTimeUpdate}
            onPlay={() => { setIsPlaying(true); reportProgress({ isPaused: false }); }}
            onPause={() => { setIsPlaying(false); setShowControls(true); reportProgress({ isPaused: true }); }}
            onLoadedMetadata={(e) => { if (e.target.duration && isFinite(e.target.duration)) setDuration(e.target.duration); }}
            onClick={togglePlay}
          >
            {subtitlesMeta.map((s, i) => <track key={i} kind="subtitles" src={s.url} srcLang={s.language} label={s.displayTitle} />)}
          </video>

          {/* ── Custom DagzFlix overlay controls ── */}
          <div className={`absolute inset-0 transition-opacity duration-500 z-10 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
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
                  {subtitlesMeta.length > 0 && (
                    <div className="relative">
                      <button data-testid="player-subs-toggle" onClick={() => { setShowSubMenu(!showSubMenu); setShowAudioMenu(false); }} className={`p-2 rounded-xl transition-all ${activeSub >= 0 ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-400'}`}><Subtitles className="w-5 h-5" /></button>
                      {showSubMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                          <button onClick={() => handleSub(-1)} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activeSub === -1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>Désactiver</button>
                          {subtitlesMeta.map((s, i) => <button key={i} onClick={() => handleSub(i)} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${activeSub === i ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{s.displayTitle}</button>)}
                        </div>
                      )}
                    </div>
                  )}
                  {audioTracksMeta.length > 1 && (
                    <div className="relative">
                      <button onClick={() => { setShowAudioMenu(!showAudioMenu); setShowSubMenu(false); }} className="p-2 rounded-xl hover:bg-white/10 text-gray-400"><AudioLines className="w-5 h-5" /></button>
                      {showAudioMenu && (
                        <div className="absolute bottom-12 right-0 glass-strong rounded-2xl p-2 min-w-[200px]">
                          {audioTracksMeta.map((a, i) => <button key={i} onClick={() => handleAudioTrack(a.index ?? i)} className={`w-full text-left px-3 py-2 rounded-xl text-sm ${a.isDefault ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>{a.displayTitle}{a.channels ? ` (${a.channels}ch)` : ''}</button>)}
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

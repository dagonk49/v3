'use client';
import { createContext, useContext, useState, useCallback } from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [playerItem, setPlayerItem] = useState(null);
  const [episodeId, setEpisodeId] = useState(null);

  const play = useCallback((item, epId = null) => {
    // 📡 LE RADAR ELECTRON (MÉTHODE PROPRE) 📡
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log("🎬 [DagzFlix PC] Clic intercepté via Context ! Envoi au lecteur natif...");
      window.electronAPI.launchMpv({ item, episodeId: epId });
      return; 
    }

    setPlayerItem(item);
    setEpisodeId(epId);
  }, []);

  const close = useCallback(() => {
    setPlayerItem(null);
    setEpisodeId(null);
  }, []);

  return (
    <PlayerContext.Provider value={{ playerItem, episodeId, play, close }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
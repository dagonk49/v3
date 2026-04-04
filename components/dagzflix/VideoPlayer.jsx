'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Play, Pause, ChevronLeft, Loader2, AlertCircle, SkipBack, SkipForward,
  Volume2, VolumeX, Subtitles, AudioLines, Maximize, Minimize, Settings, ChevronRight, Check
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/constants';
import Hls from 'hls.js';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTES DE DÉTECTION LINGUISTIQUE
   ─────────────────────────────────────
   Ces constantes alimentent l'algorithme de sélection automatique
   VFF → VFQ → VOSTFR. Elles couvrent les variantes d'encodage des
   langues rencontrées dans les serveurs Jellyfin / Plex / Emby.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Codes ISO 639-1 / 639-2 standards pour le français */
const FRENCH_LANG_CODES = ['fre', 'fra', 'fr'];

/**
 * Patterns pour identifier une piste VFF (Version Française France).
 * On les cherche dans le champ `name` et `lang` de chaque piste audio HLS.
 * "french" et "français" couvrent les cas où le serveur met un label lisible.
 */
const VFF_PATTERNS = ['vff', 'french', 'français', 'francais'];

/**
 * Patterns pour identifier une piste VFQ (Version Française Québec).
 * Priorité inférieure à la VFF dans notre cascade de sélection.
 */
const VFQ_PATTERNS = ['vfq', 'québécois', 'quebecois', 'quebec'];

/* ═══════════════════════════════════════════════════════════════════════════
   FONCTIONS UTILITAIRES DE DÉTECTION LINGUISTIQUE
   ─────────────────────────────────────
   Chaque fonction prend un objet « track » (piste audio ou sous-titre)
   et renvoie un booléen. Elles sont utilisées par l'algorithme en cascade
   déclenché après le parsing du manifeste HLS.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vérifie si une piste (audio ou sous-titre) est en français, toute variante confondue.
 * Accepte les formats HLS.js (lang/name) ET les formats DOM TextTrack (language/label).
 *
 * @param {{ lang?: string, name?: string, language?: string, label?: string }} track
 * @returns {boolean} true si la piste est identifiée comme française
 */
function isFrenchTrack(track) {
  const lang = (track.lang || track.language || '').toLowerCase();
  const name = (track.name || track.label || '').toLowerCase();
  return (
    FRENCH_LANG_CODES.includes(lang) ||
    VFF_PATTERNS.some(p => name.includes(p) || lang.includes(p)) ||
    VFQ_PATTERNS.some(p => name.includes(p) || lang.includes(p))
  );
}

/**
 * Vérifie si une piste est spécifiquement VFF (et PAS VFQ).
 * La VFF a la priorité la plus haute dans notre algorithme.
 * On exclut explicitement les patterns VFQ pour éviter les faux positifs.
 *
 * @param {{ lang?: string, name?: string, language?: string, label?: string }} track
 * @returns {boolean} true si c'est une piste VFF
 */
function isVFF(track) {
  const name = (track.name || track.label || '').toLowerCase();
  const lang = (track.lang || track.language || '').toLowerCase();
  const matchesVFF = VFF_PATTERNS.some(p => name.includes(p) || lang.includes(p));
  const matchesVFQ = VFQ_PATTERNS.some(p => name.includes(p) || lang.includes(p));
  // C'est VFF seulement si ça matche un pattern VFF SANS matcher un pattern VFQ
  return matchesVFF && !matchesVFQ;
}

/**
 * Vérifie si une piste est spécifiquement VFQ.
 * Deuxième priorité dans la cascade, après la VFF.
 *
 * @param {{ lang?: string, name?: string, language?: string, label?: string }} track
 * @returns {boolean} true si c'est une piste VFQ
 */
function isVFQ(track) {
  const name = (track.name || track.label || '').toLowerCase();
  const lang = (track.lang || track.language || '').toLowerCase();
  return VFQ_PATTERNS.some(p => name.includes(p) || lang.includes(p));
}

/**
 * V0.014 — VideoPlayer avec Adaptive Bitrate + Sélection automatique Audio/Sous-titres
 *
 * Nouveautés par rapport à V0.013 :
 * - ABR (Adaptive Bitrate) : Configuration fine de HLS.js pour gérer les fluctuations
 *   de bande passante (algorithme EWMA avec seuils conservateurs).
 * - Sélection automatique en cascade VFF → VFQ → VOSTFR :
 *     Étape A : Cherche une piste audio française (VFF prioritaire, puis VFQ, puis FR générique).
 *              Si trouvée → active cette piste, désactive les sous-titres.
 *     Étape B : Si aucune audio FR → cherche des sous-titres FR dans les textTracks.
 *              Si trouvés → les active automatiquement.
 *
 * INCHANGÉ : MediaSession API, History API, UI Tailwind/Framer Motion, contrôles tactiles.
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
  const [activeAudioTrack, setActiveAudioTrack] = useState(-1);
  const [hlsLevels, setHlsLevels] = useState([]);
  const [activeLevel, setActiveLevel] = useState(-1);
  const [activeQuality, setActiveQuality] = useState('auto'); // 'auto', '1080', '720', '480', '360'
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [settingsView, setSettingsView] = useState('main'); // main, audio, subs, quality
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

  /**
   * Ref verrou pour la sélection automatique de langue.
   * Une fois que l'algorithme VFF→VFQ→VOSTFR a tourné, ce flag empêche
   * de ré-exécuter la sélection (sinon on écraserait un choix manuel
   * de l'utilisateur si HLS.js émet un nouveau AUDIO_TRACKS_UPDATED).
   * Réinitialisé à false quand on change de vidéo (cleanup du useEffect HLS).
   */
  const autoLangApplied = useRef(false);

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

  // ── 3. Fetch stream metadata ──
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
          if (r.audioTracks && r.audioTracks.length > 0) {
            // Find default audio or first audio track
            const defaultAudio = r.audioTracks.find(a => a.isDefault) || r.audioTracks[0];
            if (defaultAudio.index !== undefined) {
              setActiveAudioTrack(defaultAudio.index);
            }
          }
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

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CONFIGURATION HLS.js — Adaptive Bitrate (ABR) + Sélection Automatique
  // ══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!streamData || !videoRef.current) return;
    const video = videoRef.current;
    const resumeSec = item?.playbackPositionTicks ? Math.floor(item.playbackPositionTicks / 10_000_000) : 0;

    // Réinitialiser le verrou de sélection automatique pour cette nouvelle source
    autoLangApplied.current = false;

    if (Hls.isSupported()) {
      /* ─────────────────────────────────────────────────────────────────────
         CRÉATION DE L'INSTANCE HLS.js AVEC PARAMÈTRES ABR OPTIMISÉS
         ─────────────────────────────────────────────────────────────────────
         HLS.js utilise un algorithme EWMA (Exponentially Weighted Moving Average)
         pour estimer la bande passante en temps réel. Les paramètres ci-dessous
         contrôlent la sensibilité et l'agressivité des changements de qualité.

         Philosophie :
         - Montée en qualité PRUDENTE (abrBandWidthUpFactor = 0.7)
           → On attend d'être sûr que la connexion tient avant de monter.
         - Descente en qualité RÉACTIVE (abrBandWidthFactor = 0.95)
           → Dès que la bande passante baisse, on descend vite pour éviter les saccades.
         - Estimation initiale CONSERVATRICE (500 kbps)
           → On commence en basse qualité et on monte, plutôt que de commencer
             haut et de provoquer un buffering immédiat.
      */
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,        // Désactivé pour laisser du temps au transcodage serveur

        /* ── Paramètres ABR (Adaptive Bitrate) ────────────────────────────── */
        startLevel: -1,               // -1 = HLS.js choisit le niveau initial via ABR automatique
        capLevelToPlayerSize: true,    // Ne charge pas du 4K si le player fait 720px de large
        abrEwmaDefaultEstimate: 500_000, // Estimation initiale bande passante : 500 kbps (conservateur)
        abrBandWidthFactor: 0.95,     // Seuil de descente : 95% du bitrate estimé (réactif)
        abrBandWidthUpFactor: 0.7,    // Seuil de montée : 70% du bitrate estimé (prudent, anti yo-yo)
        abrMaxWithRealBitrate: true,  // Utilise le vrai bitrate des segments (pas celui du manifeste)

        /* ── Gestion du Buffer ────────────────────────────────────────────── */
        maxBufferLength: 30,          // Buffer cible en secondes (assez pour absorber les micro-coupures)
        maxMaxBufferLength: 60,       // Plafond absolu du buffer (HLS.js ne bufferise pas au-delà)
        maxBufferSize: 60 * 1000 * 1000, // 60 Mo de buffer max en mémoire
        backBufferLength: 15,         // Garde 15s de buffer arrière (pour les retours en arrière rapides)
        maxBufferHole: 0.5,           // Tolère un trou de 0.5s dans le buffer avant de resynchroniser

        /* ── Timeouts & Retries (adaptés au transcodage serveur) ──────────── */
        manifestLoadingTimeOut: 20000, // 20s pour charger le master.m3u8 (le serveur peut transcoder)
        manifestLoadingMaxRetry: 5,    // 5 tentatives max pour le manifeste
        levelLoadingTimeOut: 20000,    // 20s pour les playlists de niveau (qualité spécifique)
        fragLoadingTimeOut: 20000,     // 20s par fragment vidéo (segments .ts)
      });
      hlsRef.current = hls;

      // Charger le manifeste master.m3u8 fourni par le backend
      hls.loadSource(streamData.streamUrl);
      hls.attachMedia(video);

      /* ─── Événement : MANIFEST_PARSED ──────────────────────────────────
         Le master.m3u8 a été téléchargé et parsé avec succès. HLS.js connaît
         maintenant tous les niveaux de qualité (levels), les pistes audio
         et les sous-titres disponibles dans le manifeste.
         On lance la lecture et on restaure la position si nécessaire. */
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        console.log(
          `[HLS] Manifeste parsé — ${data.levels?.length || 0} niveau(x) de qualité, ` +
          `${data.audioTracks?.length || 0} piste(s) audio, ` +
          `${data.subtitleTracks?.length || 0} piste(s) de sous-titres`
        );
        
        // Capture available quality levels
        setHlsLevels(data.levels || []);
        setActiveLevel(hls.currentLevel);

        // Restaurer la position de lecture si l'utilisateur avait commencé la vidéo
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});

        /* ─── Sélection automatique si les pistes audio sont déjà disponibles ──
           Sur certains manifestes, les pistes audio sont connues dès le parsing
           du manifeste (avant même AUDIO_TRACKS_UPDATED). On tente la sélection
           immédiatement pour éviter que l'utilisateur entende la mauvaise langue
           pendant ne serait-ce qu'une seconde. */
        const audioTracks = hls.audioTracks || [];
        if (audioTracks.length > 0 && !autoLangApplied.current) {
          executerSelectionAutomatique(hls, video, audioTracks);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setActiveLevel(data.level);
      });

      /* ─── Événement : AUDIO_TRACKS_UPDATED ─────────────────────────────
         Déclenché quand HLS.js détecte ou rafraîchit la liste des pistes audio.
         Peut se produire après MANIFEST_PARSED ou lors d'un changement de période
         dans un manifeste DASH-like. On met à jour le state React ET on relance
         l'algorithme de sélection si ce n'est pas déjà fait. */
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        const tracks = hls.audioTracks || [];

        console.log(`[HLS] Pistes audio mises à jour — ${tracks.length} piste(s) :`,
          tracks.map((t, i) => `[${i}] ${t.name || '?'} (${t.lang || '?'})`).join(', ')
        );

        // Lancer la sélection automatique VFF → VFQ → VOSTFR (une seule fois)
        if (!autoLangApplied.current && tracks.length > 0) {
          executerSelectionAutomatique(hls, video, tracks);
        }
      });

      /* ─── Événement : SUBTITLE_TRACKS_UPDATED ──────────────────────────
         Déclenché quand HLS.js détecte des pistes de sous-titres dans le manifeste.
         Si l'algorithme de sélection n'a pas encore trouvé d'audio FR et que la
         sélection n'a pas encore été appliquée, on relance la cascade pour tenter
         de trouver des sous-titres FR (cas VOSTFR). */
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        console.log(`[HLS] Pistes sous-titres mises à jour — ${(hls.subtitleTracks || []).length} piste(s)`);

        // Si la sélection audio a déjà été appliquée, on ne touche à rien
        if (autoLangApplied.current) return;

        // Sinon, si on n'a toujours pas de pistes audio (manifeste sans audio alternatives),
        // on tente la sélection qui tombera directement à l'Étape B (sous-titres)
        const audioTracks = hls.audioTracks || [];
        if (audioTracks.length <= 1) {
          executerSelectionAutomatique(hls, video, audioTracks);
        }
      });

      /* ─── Gestion des erreurs HLS.js ───────────────────────────────────
         Stratégie de récupération en 3 niveaux :
         1. Erreur réseau → on relance le chargement (startLoad)
         2. Erreur média → on tente la récupération (recoverMediaError)
         3. Erreur fatale autre → on détruit HLS.js et on bascule sur le fallback */
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error(`[HLS] Erreur fatale : ${data.type} — ${data.details}`);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('[HLS] Erreur réseau, tentative de reprise du chargement…');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('[HLS] Erreur média, tentative de récupération…');
              hls.recoverMediaError();
              break;
            default:
              console.error('[HLS] Erreur irrécupérable, destruction de l\'instance HLS.');
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
      /* ─── Fallback Safari natif (HLS natif dans WebKit) ────────────────
         Safari supporte HLS nativement sans hls.js. On passe directement
         l'URL du manifeste au tag <video>. La sélection automatique de langue
         sera tentée via les textTracks du DOM après le chargement des métadonnées. */
      video.src = streamData.streamUrl;
      video.addEventListener('loadedmetadata', () => {
        if (resumeSec > 0) video.currentTime = resumeSec;
        video.play().catch(() => {});
        // Tenter la sélection des sous-titres FR pour Safari (pas d'API audioTrack)
        appliquerSelectionSousTitres(video);
      }, { once: true });
    } else {
      /* ─── Fallback direct (pas de support HLS) ────────────────────────── */
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

  /* ══════════════════════════════════════════════════════════════════════════
     ALGORITHME DE SÉLECTION AUTOMATIQUE : VFF → VFQ → VOSTFR
     ══════════════════════════════════════════════════════════════════════════

     Cet algorithme implémente une cascade de sélection linguistique en 2 étapes :

     ┌─────────────────────────────────────────────────────────────────┐
     │  ÉTAPE A — Recherche d'une piste AUDIO française               │
     │  ──────────────────────────────────────────────────────────     │
     │  Priorité 1 : VFF (Version Française France)                   │
     │  Priorité 2 : VFQ (Version Française Québec)                   │
     │  Priorité 3 : Tout code français générique (fre, fra, fr)      │
     │                                                                 │
     │  → Si trouvée : activer cette piste audio via hls.audioTrack   │
     │                  + DÉSACTIVER tous les sous-titres              │
     │                  (on regarde en VF, pas besoin de sous-titres)  │
     └─────────────────────────────────────────────────────────────────┘
                                   │
                         (aucune audio FR trouvée)
                                   ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │  ÉTAPE B — Pas de VF → Activer les sous-titres français        │
     │  ──────────────────────────────────────────────────────────     │
     │  La vidéo est en VO (anglais, japonais, etc.).                  │
     │  → Chercher un textTrack français dans le DOM (<track>)        │
     │  → Si trouvé : mode = 'showing' (VOSTFR automatique)           │
     │  → Si non trouvé : lecture en VO brute, pas de sous-titres     │
     └─────────────────────────────────────────────────────────────────┘

     Le flag autoLangApplied (ref) empêche la cascade de se ré-exécuter
     après un choix manuel de l'utilisateur dans les menus audio/sous-titres.
  */

  /**
   * Fonction principale de l'algorithme de sélection automatique.
   * Appelée depuis MANIFEST_PARSED et/ou AUDIO_TRACKS_UPDATED (une seule fois).
   *
   * @param {Hls} hls - Instance HLS.js active
   * @param {HTMLVideoElement} video - Élément vidéo du DOM
   * @param {Array} audioTracks - Liste des pistes audio HLS.js
   */
  const executerSelectionAutomatique = useCallback((hls, video, audioTracks) => {
    // Verrou : on n'exécute qu'une seule fois par vidéo
    if (autoLangApplied.current) return;
    autoLangApplied.current = true;

    console.log('[AutoLang] Démarrage de la sélection automatique…');
    console.log(`[AutoLang] ${audioTracks.length} piste(s) audio disponible(s) :`,
      audioTracks.map((t, i) => `[${i}] "${t.name || '?'}" lang="${t.lang || '?'}"`).join(' | ')
    );

    /* ─── ÉTAPE A : Recherche d'une piste audio française ─────────────── */
    let frenchAudioIndex = -1;

    // Priorité 1 : VFF (Version Française France)
    frenchAudioIndex = audioTracks.findIndex(t => isVFF(t));
    if (frenchAudioIndex !== -1) {
      console.log(`[AutoLang] ✓ Piste VFF détectée à l'index ${frenchAudioIndex} : "${audioTracks[frenchAudioIndex].name}"`);
    }

    // Priorité 2 : VFQ (Version Française Québec)
    if (frenchAudioIndex === -1) {
      frenchAudioIndex = audioTracks.findIndex(t => isVFQ(t));
      if (frenchAudioIndex !== -1) {
        console.log(`[AutoLang] ✓ Piste VFQ détectée à l'index ${frenchAudioIndex} : "${audioTracks[frenchAudioIndex].name}"`);
      }
    }

    // Priorité 3 : N'importe quel code français générique (fre, fra, fr)
    if (frenchAudioIndex === -1) {
      frenchAudioIndex = audioTracks.findIndex(t => isFrenchTrack(t));
      if (frenchAudioIndex !== -1) {
        console.log(`[AutoLang] ✓ Piste audio FR générique détectée à l'index ${frenchAudioIndex} : "${audioTracks[frenchAudioIndex].name}" (lang: "${audioTracks[frenchAudioIndex].lang}")`);
      }
    }

    if (frenchAudioIndex !== -1) {
      /* ─── Audio FR trouvée → l'activer et désactiver les sous-titres ─── */
      hls.audioTrack = frenchAudioIndex;
      setActiveAudioTrack(frenchAudioIndex);

      // Désactiver TOUS les sous-titres (on est en VF, pas besoin)
      desactiverTousLesSousTitres(video);
      setActiveSub(-1);

      console.log('[AutoLang] ✓ Sélection terminée : Audio FR activée, sous-titres désactivés.');
      return;
    }

    /* ─── ÉTAPE B : Pas de VF audio → passage en mode VOSTFR ─────────── */
    console.log('[AutoLang] Aucune piste audio FR trouvée → recherche de sous-titres FR (VOSTFR)…');
    appliquerSelectionSousTitres(video);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Recherche et active des sous-titres français dans les textTracks du DOM.
   * Utilisé dans l'Étape B de la cascade (mode VOSTFR).
   *
   * Les textTracks proviennent des éléments <track> rendus par React à partir
   * de streamData.subtitles. On vérifie d'abord les métadonnées du backend
   * (streamData.subtitles) puis on fallback sur les textTracks du DOM.
   *
   * @param {HTMLVideoElement} video - Élément vidéo du DOM
   */
  const appliquerSelectionSousTitres = useCallback((video) => {
    /**
     * Fonction interne : tente de trouver et activer un sous-titre FR.
     * Retourne true si un sous-titre a été activé, false sinon.
     */
    const chercherEtActiverSousTitreFR = () => {
      const textTracks = video.textTracks;
      if (!textTracks || textTracks.length === 0) return false;

      // Parcourir toutes les pistes de sous-titres
      for (let i = 0; i < textTracks.length; i++) {
        const track = textTracks[i];
        // Utiliser la même logique de détection que pour l'audio
        if (isFrenchTrack({ lang: track.language, name: track.label })) {
          // Sous-titre FR trouvé ! On active celui-ci et on désactive les autres
          for (let j = 0; j < textTracks.length; j++) {
            textTracks[j].mode = (j === i) ? 'showing' : 'hidden';
          }
          setActiveSub(i);
          console.log(`[AutoLang] ✓ Sous-titres FR activés (index ${i}) : "${track.label}" (lang: "${track.language}")`);
          return true;
        }
      }
      return false;
    };

    // Tentative immédiate (les textTracks sont souvent disponibles après le render React)
    if (chercherEtActiverSousTitreFR()) return;

    /* Si les textTracks ne sont pas encore prêts (race condition possible entre
       le render React des <track> et la mise à jour du DOM), on réessaie après
       un court délai. On fait 2 tentatives espacées pour maximiser les chances. */
    setTimeout(() => {
      if (chercherEtActiverSousTitreFR()) return;
      // Dernière tentative après 1.5s
      setTimeout(() => {
        if (!chercherEtActiverSousTitreFR()) {
          console.log('[AutoLang] ✗ Aucun sous-titre FR trouvé → lecture en VO sans sous-titres.');
        }
      }, 1000);
    }, 500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Désactive tous les textTracks (sous-titres) de l'élément vidéo.
   * Appelé quand on active une piste audio française (pas besoin de sous-titres en VF).
   *
   * @param {HTMLVideoElement} video - Élément vidéo du DOM
   */
  const desactiverTousLesSousTitres = (video) => {
    if (!video?.textTracks) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = 'hidden';
    }
  };

  // ── 5. Useeffect de secours : sélection automatique via les métadonnées streamData ──
  // Ce useEffect agit comme filet de sécurité pour les cas où AUDIO_TRACKS_UPDATED
  // ne se déclenche pas (ex: manifeste avec une seule piste audio, ou Safari natif).
  // Il utilise les métadonnées de streamData.audioTracks pour la détection.
  useEffect(() => {
    // Ne rien faire si la sélection a déjà été appliquée
    if (autoLangApplied.current) return;
    // On a besoin de streamData et de l'élément vidéo
    if (!streamData || !videoRef.current) return;

    const video = videoRef.current;
    const metaAudioTracks = streamData.audioTracks || [];

    // Si on utilise HLS.js et qu'il n'y a qu'une piste audio (ou aucune),
    // vérifier via les métadonnées du backend si la VO est en français
    if (metaAudioTracks.length > 0) {
      // Chercher une piste FR dans les métadonnées du backend
      const hasFrenchAudio = metaAudioTracks.some(t =>
        isFrenchTrack({ lang: t.language || t.codec, name: t.displayTitle || '' })
      );

      if (hasFrenchAudio) {
        // L'audio par défaut est probablement en français, désactiver les sous-titres
        desactiverTousLesSousTitres(video);
        setActiveSub(-1);
        autoLangApplied.current = true;
        console.log('[AutoLang/Fallback] Audio FR détectée via métadonnées backend, sous-titres désactivés.');
        return;
      }
    }

    // Si HLS.js est actif, on attend que AUDIO_TRACKS_UPDATED se déclenche
    if (hlsRef.current) return;

    // Fallback pur (Safari natif, pas de HLS.js) : tenter la sélection sous-titres
    // après un court délai pour laisser le temps au DOM de rendre les <track>
    const timer = setTimeout(() => {
      if (!autoLangApplied.current) {
        autoLangApplied.current = true;
        appliquerSelectionSousTitres(video);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [streamData, appliquerSelectionSousTitres]);

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

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      
      const v = videoRef.current;
      if (!v) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFS();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'arrowright':
          e.preventDefault();
          skip(10);
          break;
        case 'arrowleft':
          e.preventDefault();
          skip(-10);
          break;
        case 'arrowup':
          e.preventDefault();
          handleVol(Math.min(1, (v.volume || 0) + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVol(Math.max(0, (v.volume || 0) - 0.1));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleFS, toggleMute, skip, handleVol]);

  const handleSub = (idx) => {
    setActiveSub(idx);
    const v = videoRef.current;
    if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = i === idx ? 'showing' : 'hidden';
    }
  };

  const reloadStreamUrl = useCallback((audioIdx, quality) => {
    if (!streamData || !streamData.streamUrl) {
      console.warn('[Player] Pas de streamUrl disponible pour recharger.');
      return;
    }
    
    console.log(`[Player] Demande de rechargement. Audio: ${audioIdx}, Qualité: ${quality}`);
    
    try {
      const url = new URL(streamData.streamUrl);
      console.log(`[Player] URL de base extraite : ${url.origin}${url.pathname}`);
      
      if (audioIdx !== undefined && audioIdx !== -1) {
        url.searchParams.set('AudioStreamIndex', audioIdx.toString());
        console.log(`[Player] Paramètre HLS mis à jour : AudioStreamIndex=${audioIdx}`);
      } else {
        url.searchParams.delete('AudioStreamIndex');
        console.log(`[Player] Paramètre HLS supprimé : AudioStreamIndex (utilisation du défaut serveur)`);
      }
      
      if (quality && quality !== 'auto') {
        const bitrates = {
          '1080': '8000000',
          '720': '4000000',
          '480': '1500000',
          '360': '700000'
        };
        const targetBitrate = bitrates[quality] || '140000000';
        url.searchParams.set('VideoBitrate', targetBitrate);
        console.log(`[Player] Paramètre HLS mis à jour : VideoBitrate=${targetBitrate}`);
      } else {
        // Fallback to high bitrate if auto
        url.searchParams.set('VideoBitrate', '140000000');
      }
      
      // Cache-busting timestamp pour forcer Jellyfin à ignorer son cache
      url.searchParams.set('_t', Date.now());
      
      const newUrl = url.toString();
      console.log(`[Player] *** NOUVELLE REQUÊTE HLS PRÊTE *** URL : ${newUrl}`);
      
      const currentPos = videoRef.current ? videoRef.current.currentTime : 0;

      if (hlsRef.current) {
        console.log('[Player] Interruption du flux actuel et injection de la nouvelle URL dans HLS.js...');
        hlsRef.current.stopLoad();
        hlsRef.current.loadSource(newUrl);
        hlsRef.current.once(Hls.Events.MANIFEST_PARSED, () => {
          console.log(`[Player] Nouveau flux reçu de Jellyfin ! Reprise de la lecture à ${Math.round(currentPos)} secondes.`);
          if (videoRef.current) {
             videoRef.current.currentTime = currentPos;
             videoRef.current.play().catch(e => console.error('[Player] Lecture automatique bloquée par le navigateur :', e));
          }
        });
      } else if (videoRef.current) {
        console.log('[Player] Changement de la source native du lecteur vidéo...');
        videoRef.current.src = newUrl;
        videoRef.current.currentTime = currentPos;
        videoRef.current.play().catch(e => console.error('[Player] Lecture automatique bloquée par le navigateur :', e));
      }
    } catch(e) {
      console.error('[Player] Erreur critique lors de la génération de la nouvelle URL :', e);
    }
  }, [streamData]);

  const handleAudioTrack = (idx) => {
    console.log(`[Player] Sélection manuelle de la piste audio : ${idx}`);
    setActiveAudioTrack(idx);
    reloadStreamUrl(idx, activeQuality);
  };

  const handleQuality = (quality) => {
    console.log(`[Player] Sélection manuelle de la qualité : ${quality}`);
    setActiveQuality(quality);
    reloadStreamUrl(activeAudioTrack, quality);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const buffPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const subtitlesMeta = streamData?.subtitles || [];
  const audioTracksMeta = streamData?.audioTracks || [];

  const uniqueHlsLevels = [];
  if (hlsLevels && hlsLevels.length > 0) {
    const heights = new Set();
    for (let i = hlsLevels.length - 1; i >= 0; i--) {
      if (!heights.has(hlsLevels[i].height)) {
        heights.add(hlsLevels[i].height);
        uniqueHlsLevels.push({ ...hlsLevels[i], originalIndex: i });
      }
    }
  }

  const getActiveAudioTitle = () => {
    if (audioTracksMeta.length === 0) return 'Inconnu';
    const found = audioTracksMeta.find(a => (a.index !== undefined ? a.index : audioTracksMeta.indexOf(a)) === activeAudioTrack);
    return found?.displayTitle || 'Inconnu';
  };

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
                  {(subtitlesMeta.length > 0 || audioTracksMeta.length > 1 || hlsLevels.length > 0) && (
                    <div className="relative">
                      <button onClick={() => { setShowSettingsMenu(!showSettingsMenu); setSettingsView('main'); }} className={`p-2 rounded-xl transition-all min-w-[40px] min-h-[40px] flex items-center justify-center ${showSettingsMenu ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-gray-400'}`}>
                        <Settings className="w-5 h-5" />
                      </button>
                      {showSettingsMenu && (
                        <div className="absolute bottom-14 right-0 glass-strong rounded-2xl p-2 min-w-[260px] max-h-[60vh] overflow-y-auto shadow-2xl z-50 text-white">
                          {settingsView === 'main' && (
                            <div className="flex flex-col gap-1">
                              <button onClick={() => setSettingsView('quality')} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors">
                                <span className="font-semibold text-gray-300">Qualité</span>
                                <div className="flex items-center gap-2 text-gray-400">
                                  <span>{activeQuality === 'auto' ? 'Auto' : `${activeQuality}p`}</span>
                                  <ChevronRight className="w-4 h-4" />
                                </div>
                              </button>
                              {audioTracksMeta.length > 1 && (
                                <button onClick={() => setSettingsView('audio')} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors">
                                  <span className="font-semibold text-gray-300">Audio</span>
                                  <div className="flex items-center gap-2 text-gray-400 max-w-[120px]">
                                    <span className="truncate">{getActiveAudioTitle()}</span>
                                    <ChevronRight className="w-4 h-4 flex-shrink-0" />
                                  </div>
                                </button>
                              )}
                              {subtitlesMeta.length > 0 && (
                                <button onClick={() => setSettingsView('subs')} className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors">
                                  <span className="font-semibold text-gray-300">Sous-titres</span>
                                  <div className="flex items-center gap-2 text-gray-400 max-w-[120px]">
                                    <span className="truncate">{activeSub === -1 ? 'Désactivé' : subtitlesMeta[activeSub]?.displayTitle}</span>
                                    <ChevronRight className="w-4 h-4 flex-shrink-0" />
                                  </div>
                                </button>
                              )}
                            </div>
                          )}

                          {settingsView === 'quality' && (
                            <div className="flex flex-col gap-1">
                              <button onClick={() => setSettingsView('main')} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors mb-2 border-b border-white/10">
                                <ChevronLeft className="w-4 h-4" /> <span className="font-semibold">Retour</span>
                              </button>
                              
                              {[
                                { id: 'auto', label: 'Auto' },
                                { id: '1080', label: '1080p', desc: '8 Mbps' },
                                { id: '720', label: '720p', desc: '4 Mbps' },
                                { id: '480', label: '480p', desc: '1.5 Mbps' },
                                { id: '360', label: '360p', desc: '0.7 Mbps' }
                              ].map((q) => (
                                <button key={q.id} onClick={() => handleQuality(q.id)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm ${activeQuality === q.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                  <span>{q.label} {q.desc && <span className="text-xs text-gray-500 ml-1">({q.desc})</span>}</span>
                                  {activeQuality === q.id && <Check className="w-4 h-4 text-green-400" />}
                                </button>
                              ))}
                            </div>
                          )}

                          {settingsView === 'audio' && (
                            <div className="flex flex-col gap-1">
                              <button onClick={() => setSettingsView('main')} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors mb-2 border-b border-white/10">
                                <ChevronLeft className="w-4 h-4" /> <span className="font-semibold">Retour</span>
                              </button>
                              {audioTracksMeta.map((a, i) => {
                                const trackIndex = a.index !== undefined ? a.index : i;
                                return (
                                  <button key={trackIndex} onClick={() => handleAudioTrack(trackIndex)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm ${activeAudioTrack === trackIndex ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                    <span>{a.displayTitle}{a.channels ? ` (${a.channels}ch)` : ''}</span>
                                    {activeAudioTrack === trackIndex && <Check className="w-4 h-4 text-green-400" />}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {settingsView === 'subs' && (
                            <div className="flex flex-col gap-1">
                              <button onClick={() => setSettingsView('main')} className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-white/10 transition-colors mb-2 border-b border-white/10">
                                <ChevronLeft className="w-4 h-4" /> <span className="font-semibold">Retour</span>
                              </button>
                              <button onClick={() => handleSub(-1)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm ${activeSub === -1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                <span>Désactivé</span>
                                {activeSub === -1 && <Check className="w-4 h-4 text-green-400" />}
                              </button>
                              {subtitlesMeta.map((s, i) => (
                                <button key={i} onClick={() => handleSub(i)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm ${activeSub === i ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}>
                                  <span>{s.displayTitle}</span>
                                  {activeSub === i && <Check className="w-4 h-4 text-green-400" />}
                                </button>
                              ))}
                            </div>
                          )}
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

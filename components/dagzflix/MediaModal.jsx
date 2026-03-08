'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  X, Download, Clock, Check, Loader2, Play, Tv, Film,
  ChevronDown, AlertCircle, Layers
} from 'lucide-react';
import { api, cachedApi } from '@/lib/api';

/**
 * Résout le tmdbId depuis un item.
 */
const resolveTmdbId = (item) =>
  item?.tmdbId || item?.providerIds?.Tmdb || item?.providerIds?.TMDb || item?.providerIds?.tmdb || null;

/**
 * MediaModal — Modal de demande Jellyseerr avec gestion des saisons.
 *
 * V0,012 :
 *  - Si film : bouton "Demander" unique via tmdbId
 *  - Si série (tv) : sélecteur de saisons individuelles + bouton "Demander" global
 *  - Mobile : plein écran (fixed inset-0) avec scroll vertical + bouton X flottant
 *  - API : requêtes directes via /api/media/request avec tmdbId
 *
 * @param {Object} props
 * @param {Object} props.item - Le média (id, tmdbId, name, type, posterUrl)
 * @param {boolean} props.isOpen - Contrôle la visibilité
 * @param {Function} props.onClose - Callback fermeture
 * @param {Function} [props.onRequested] - Callback après demande réussie
 */
export function MediaModal({ item, isOpen, onClose, onRequested }) {
  const [status, setStatus] = useState('loading'); // loading | available | pending | not_available
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState(new Set());
  const [requesting, setRequesting] = useState(false);
  const [requestResult, setRequestResult] = useState(null); // null | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const [seasonsLoading, setSeasonsLoading] = useState(false);

  const isSeries = item?.type === 'Series' || item?.mediaType === 'tv';
  const tmdbId = resolveTmdbId(item);

  // ── Charger le statut + saisons au montage ──
  useEffect(() => {
    if (!isOpen || !item) return;
    setStatus('loading');
    setRequestResult(null);
    setErrorMsg('');
    setSelectedSeasons(new Set());

    (async () => {
      try {
        // 1. Vérifier le statut Jellyseerr
        const params = new URLSearchParams();
        if (item.id) params.set('id', item.id);
        if (tmdbId) params.set('tmdbId', tmdbId);
        params.set('mediaType', isSeries ? 'tv' : 'movie');
        const r = await cachedApi(`media/status?${params.toString()}`);
        setStatus(r.status || 'not_available');

        // 2. Si série, charger les saisons via TMDB (Jellyseerr expose ça)
        if (isSeries) {
          setSeasonsLoading(true);
          await loadSeasons();
          setSeasonsLoading(false);
        }
      } catch {
        setStatus('not_available');
      }
    })();
  }, [isOpen, item?.id, item?.tmdbId]);

  /**
   * Charge les saisons depuis Jellyfin (si local) ou via media/detail (TMDB).
   * Chaîne de fallback robuste :
   *  1. Jellyfin /media/seasons si l'item est local (mediaStatus === 5)
   *  2. seasonCount / numberOfSeasons depuis l'item existant
   *  3. Appel /media/detail pour récupérer numberOfSeasons depuis le backend
   */
  const loadSeasons = async () => {
    try {
      // 1. Essayer via Jellyfin d'abord (si l'item est local)
      const streamId = item.localId || item.id;
      if (streamId && (item.mediaStatus === 5 || item.localId)) {
        try {
          const r = await cachedApi(`media/seasons?seriesId=${streamId}`);
          const jfSeasons = r.seasons || [];
          if (jfSeasons.length > 0) {
            setSeasons(jfSeasons.map(s => ({
              seasonNumber: s.seasonNumber,
              name: s.name,
              episodeCount: s.episodeCount || 0,
              isOwned: true, // Sur Jellyfin = déjà disponible
            })));
            return;
          }
        } catch (e) {
          console.warn('[MediaModal] Jellyfin seasons fetch failed:', e.message);
          // Continue to fallback
        }
      }

      // 2. Utiliser les infos de l'item si déjà disponibles
      const existingCount = item.seasonCount || item.numberOfSeasons;
      if (existingCount > 0) {
        const fallbackSeasons = [];
        for (let i = 1; i <= existingCount; i++) {
          fallbackSeasons.push({
            seasonNumber: i,
            name: `Saison ${i}`,
            episodeCount: 0,
            isOwned: false,
          });
        }
        setSeasons(fallbackSeasons);
        return;
      }

      // 3. Dernière tentative : récupérer via media/detail (le backend renvoie numberOfSeasons)
      const detailId = tmdbId || item.id;
      if (detailId) {
        try {
          const detail = await cachedApi(`media/detail?id=${detailId}`);
          const d = detail.item;
          const count = d?.seasonCount || d?.numberOfSeasons || 0;
          if (count > 0) {
            const fallbackSeasons = [];
            for (let i = 1; i <= count; i++) {
              fallbackSeasons.push({
                seasonNumber: i,
                name: `Saison ${i}`,
                episodeCount: 0,
                isOwned: d?.mediaStatus === 5,
              });
            }
            setSeasons(fallbackSeasons);
            return;
          }
        } catch (e) {
          console.warn('[MediaModal] Detail fetch for seasons failed:', e.message);
        }
      }

      // Aucune info de saison trouvée
      setSeasons([]);
    } catch {
      setSeasons([]);
    }
  };

  // ── Toggle une saison ──
  const toggleSeason = useCallback((seasonNumber) => {
    setSelectedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  }, []);

  // ── Sélectionner / Désélectionner toutes ──
  const toggleAll = useCallback(() => {
    const requestable = seasons.filter(s => !s.isOwned);
    if (selectedSeasons.size === requestable.length) {
      setSelectedSeasons(new Set());
    } else {
      setSelectedSeasons(new Set(requestable.map(s => s.seasonNumber)));
    }
  }, [seasons, selectedSeasons]);

  // ── Envoyer la demande ──
  const handleRequest = async () => {
    if (!tmdbId) {
      setErrorMsg('ID TMDB manquant — impossible de créer la demande.');
      setRequestResult('error');
      return;
    }

    setRequesting(true);
    setErrorMsg('');

    try {
      const body = {
        tmdbId: String(tmdbId),
        itemId: item.id,
        mediaType: isSeries ? 'tv' : 'movie',
      };

      // Pour les séries, envoyer les saisons sélectionnées
      if (isSeries && selectedSeasons.size > 0) {
        body.seasons = Array.from(selectedSeasons).sort((a, b) => a - b);
      }

      const r = await api('media/request', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (r.success) {
        setRequestResult('success');
        setStatus('pending');
        onRequested?.();
      } else {
        throw new Error(r.error || 'Erreur inconnue');
      }
    } catch (e) {
      if (e.payload?.message?.includes('409') || e.message?.includes('already')) {
        setRequestResult('success');
        setStatus('pending');
      } else {
        setErrorMsg(e.message || 'Erreur lors de la demande');
        setRequestResult('error');
      }
    }
    setRequesting(false);
  };

  if (!isOpen || !item) return null;

  const requestableSeasons = seasons.filter(s => !s.isOwned);
  const allOwnedOnJellyfin = isSeries && seasons.length > 0 && seasons.every(s => s.isOwned);
  const canRequest = status !== 'available' && status !== 'pending' && !allOwnedOnJellyfin;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={`
              bg-[#0a0a0a] border border-white/10 overflow-y-auto
              w-full h-full sm:h-auto sm:max-h-[85vh]
              sm:w-full sm:max-w-lg sm:rounded-3xl
              relative
            `}
          >
            {/* ── Bouton X flottant (toujours accessible sur mobile) ── */}
            <button
              onClick={onClose}
              className="fixed sm:absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center hover:bg-white/20 transition-colors shadow-lg"
              aria-label="Fermer"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* ── En-tête avec poster + infos ── */}
            <div className="p-6 pt-16 sm:pt-6">
              <div className="flex gap-4 mb-6">
                {item.posterUrl && (
                  <div className="w-24 h-36 rounded-2xl overflow-hidden bg-white/5 flex-shrink-0 shadow-lg">
                    <img src={item.posterUrl} alt={item.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-white mb-1 line-clamp-2">{item.name}</h2>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {item.year && <span className="text-sm text-gray-400">{item.year}</span>}
                    <Badge variant="outline" className="border-white/10 text-gray-400 text-xs">
                      {isSeries ? <><Tv className="w-3 h-3 mr-1" />Série</> : <><Film className="w-3 h-3 mr-1" />Film</>}
                    </Badge>
                  </div>
                  {/* Statut actuel */}
                  <div className="mt-2">
                    {status === 'loading' && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-3 h-3 animate-spin" />Vérification...
                      </div>
                    )}
                    {status === 'available' && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <Check className="w-4 h-4" />Disponible sur le serveur
                      </div>
                    )}
                    {status === 'pending' && (
                      <div className="flex items-center gap-2 text-sm text-yellow-400">
                        <Clock className="w-4 h-4" />Demande en cours
                      </div>
                    )}
                    {status === 'not_available' && (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Download className="w-4 h-4" />Non disponible
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Sélecteur de saisons (séries uniquement) ── */}
              {isSeries && canRequest && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                      <Layers className="w-4 h-4 text-purple-400" />
                      Saisons à demander
                    </h3>
                    {requestableSeasons.length > 1 && (
                      <button
                        onClick={toggleAll}
                        className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                      >
                        {selectedSeasons.size === requestableSeasons.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    )}
                  </div>

                  {seasonsLoading ? (
                    <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />Chargement des saisons...
                    </div>
                  ) : seasons.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pr-1 hide-scrollbar">
                      {seasons.map((s) => {
                        const selected = selectedSeasons.has(s.seasonNumber);
                        const owned = s.isOwned;
                        return (
                          <button
                            key={s.seasonNumber}
                            onClick={() => !owned && toggleSeason(s.seasonNumber)}
                            disabled={owned}
                            className={`
                              flex items-center gap-3 p-3 rounded-xl text-left text-sm transition-all
                              ${owned
                                ? 'bg-green-500/10 text-green-400 border border-green-500/20 cursor-default'
                                : selected
                                  ? 'bg-red-500/15 text-white border border-red-500/30 ring-1 ring-red-500/20'
                                  : 'bg-white/5 text-gray-400 border border-white/5 hover:bg-white/10 hover:text-white'
                              }
                            `}
                          >
                            <div className={`
                              w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors
                              ${owned ? 'bg-green-500/20' : selected ? 'bg-red-500 text-white' : 'bg-white/10'}
                            `}>
                              {owned ? <Check className="w-3 h-3" /> : selected ? <Check className="w-3 h-3" /> : null}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium truncate block">{s.name}</span>
                              {s.episodeCount > 0 && (
                                <span className="text-xs opacity-60">{s.episodeCount} ép.</span>
                              )}
                            </div>
                            {owned && (
                              <Badge className="bg-green-500/20 text-green-400 text-[10px] border-0">Local</Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600 py-2">Aucune information de saison disponible</p>
                  )}
                </div>
              )}

              {/* ── Messages de résultat ── */}
              {requestResult === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2"
                >
                  <Check className="w-5 h-5 flex-shrink-0" />
                  <span>Demande envoyée avec succès ! Le média sera bientôt disponible.</span>
                </motion.div>
              )}

              {requestResult === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <span>{errorMsg || 'Erreur lors de la demande'}</span>
                </motion.div>
              )}

              {/* ── Bouton d'action principal ── */}
              <div className="flex gap-3">
                {status === 'available' || allOwnedOnJellyfin ? (
                  <Button
                    onClick={onClose}
                    className="flex-1 h-12 rounded-xl bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
                  >
                    <Check className="w-5 h-5 mr-2" />
                    {allOwnedOnJellyfin ? 'Toutes les saisons sont disponibles' : 'Déjà disponible'}
                  </Button>
                ) : status === 'pending' || requestResult === 'success' ? (
                  <Button
                    disabled
                    className="flex-1 h-12 rounded-xl bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                  >
                    <Clock className="w-5 h-5 mr-2" />Demande en cours
                  </Button>
                ) : (
                  <Button
                    onClick={handleRequest}
                    disabled={requesting || status === 'loading' || (isSeries && selectedSeasons.size === 0 && requestableSeasons.length > 0)}
                    className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/20 disabled:opacity-40"
                  >
                    {requesting ? (
                      <><Loader2 className="w-5 h-5 animate-spin mr-2" />Envoi en cours...</>
                    ) : (
                      <>
                        <Download className="w-5 h-5 mr-2" />
                        {isSeries && selectedSeasons.size > 0
                          ? `Demander ${selectedSeasons.size} saison${selectedSeasons.size > 1 ? 's' : ''}`
                          : isSeries
                            ? 'Sélectionnez des saisons'
                            : 'Demander ce film'
                        }
                      </>
                    )}
                  </Button>
                )}
              </div>

              {/* ── Aide en bas ── */}
              {canRequest && !requestResult && (
                <p className="text-xs text-gray-600 text-center mt-4 px-4">
                  La demande sera envoyée à Jellyseerr. Le téléchargement commencera automatiquement.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

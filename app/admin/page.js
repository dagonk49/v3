'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { api, cachedApi, invalidateCache } from '@/lib/api';
import {
  Shield, Users, ChevronLeft, Save, Loader2, Crown, User, Baby,
  AlertTriangle, BarChart3, Clock, Heart, Film, Activity, X, Eye,
} from 'lucide-react';

/** Rôles disponibles avec métadonnées d'affichage */
const ROLES = [
  { value: 'admin', label: 'Administrateur', icon: Crown, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' },
  { value: 'adult', label: 'Adulte', icon: User, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/30' },
  { value: 'child', label: 'Enfant', icon: Baby, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/30' },
];

/** Formatte les secondes en heures/minutes lisibles */
function formatWatchTime(seconds) {
  if (!seconds || seconds <= 0) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

/**
 * V0.010 Mission 4 — God-Mode Admin Dashboard.
 * - Statistiques globales (télémétrie) en haut
 * - Tableau utilisateurs avec rôle modifiable
 * - Slide-over au clic sur un utilisateur (watch time, genres, historique, contrôle parental)
 */
export default function AdminPage() {
  const { user, status } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingChanges, setPendingChanges] = useState({});
  const [saving, setSaving] = useState({});
  const [toast, setToast] = useState(null);

  // Telemetry stats
  const [telemetry, setTelemetry] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(true);

  // User detail slide-over
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userStats, setUserStats] = useState(null);
  const [userStatsLoading, setUserStatsLoading] = useState(false);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Charger utilisateurs + télémétrie ──
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await cachedApi('admin/users');
      setUsers(data.users || []);
    } catch (err) {
      if (err.status === 403) {
        setError('Accès refusé — rôle administrateur requis.');
      } else {
        setError(err.message || 'Erreur lors du chargement des utilisateurs.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTelemetry = useCallback(async () => {
    try {
      setTelemetryLoading(true);
      const data = await cachedApi('admin/telemetry');
      setTelemetry(data);
    } catch (_) {
      // Non-blocking
    } finally {
      setTelemetryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'ready') {
      loadUsers();
      loadTelemetry();
    }
  }, [status, loadUsers, loadTelemetry]);

  // ── Load user stats when slide-over opens ──
  useEffect(() => {
    if (!selectedUserId) { setUserStats(null); return; }
    let cancelled = false;
    (async () => {
      setUserStatsLoading(true);
      try {
        const data = await api(`admin/user-stats?userId=${selectedUserId}`);
        if (!cancelled) setUserStats(data);
      } catch (_) {
        if (!cancelled) setUserStats(null);
      } finally {
        if (!cancelled) setUserStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedUserId]);

  // ── Rôle management ──
  const handleRoleChange = (userId, newRole) => {
    setPendingChanges(prev => ({ ...prev, [userId]: newRole }));
  };

  const saveRole = async (userId) => {
    const role = pendingChanges[userId];
    if (!role) return;

    setSaving(prev => ({ ...prev, [userId]: true }));
    try {
      await api('admin/users/update', {
        method: 'POST',
        body: JSON.stringify({ userId, role }),
      });

      setUsers(prev => prev.map(u => u.userId === userId ? { ...u, role } : u));
      setPendingChanges(prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      invalidateCache('admin/users');
      setToast({ type: 'success', message: 'Rôle mis à jour avec succès.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erreur lors de la mise à jour.' });
    } finally {
      setSaving(prev => ({ ...prev, [userId]: false }));
    }
  };

  // ── Helpers ──
  const getRoleInfo = (role) => ROLES.find(r => r.value === role) || ROLES[1];
  const selectedUser = users.find(u => u.userId === selectedUserId);

  // ── Attente auth ──
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ── Header ── */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Retour à l'accueil"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">God-Mode</h1>
              <p className="text-xs text-white/40">Administration & Analytiques</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-white/40">
            <Users className="w-4 h-4" />
            <span>{users.length} utilisateur{users.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[100]"
          >
            <div className={`px-5 py-3 rounded-xl border shadow-2xl backdrop-blur-xl flex items-center gap-3 ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {toast.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span className="text-sm font-medium">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Content ── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-white/30" />
            <p className="text-white/40 text-sm">Chargement…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <AlertTriangle className="w-10 h-10 text-red-400/60" />
            <p className="text-red-300/80 text-sm text-center max-w-md">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm"
            >
              Retour à l'accueil
            </button>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            {/* ── Telemetry Stats Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard
                icon={BarChart3} color="text-purple-400" bg="bg-purple-400/10"
                label="Événements" value={telemetryLoading ? '…' : (telemetry?.totalEvents?.toLocaleString() || '0')}
              />
              <StatCard
                icon={Eye} color="text-blue-400" bg="bg-blue-400/10"
                label="Lectures" value={telemetryLoading ? '…' : (telemetry?.actionBreakdown?.watch?.toLocaleString() || '0')}
              />
              <StatCard
                icon={Heart} color="text-pink-400" bg="bg-pink-400/10"
                label="Favoris" value={telemetryLoading ? '…' : (telemetry?.actionBreakdown?.favorite?.toLocaleString() || '0')}
              />
              <StatCard
                icon={Activity} color="text-emerald-400" bg="bg-emerald-400/10"
                label="Clics" value={telemetryLoading ? '…' : (telemetry?.actionBreakdown?.click?.toLocaleString() || '0')}
              />
            </div>

            {/* ── Top 10 médias les plus consultés ── */}
            {!telemetryLoading && telemetry?.topClicked?.length > 0 && (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden mb-8">
                <div className="px-5 py-4 bg-white/[0.03] border-b border-white/5 flex items-center gap-3">
                  <div className="p-1.5 bg-amber-500/10 rounded-lg">
                    <BarChart3 className="w-4 h-4 text-amber-400" />
                  </div>
                  <h2 className="text-sm font-semibold text-white/80">Top 10 — Médias les plus consultés</h2>
                </div>
                <div className="divide-y divide-white/[0.03]">
                  {telemetry.topClicked.map((item, idx) => (
                    <div
                      key={item.itemId}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Rank */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                        idx === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : idx === 1 ? 'bg-gray-400/15 text-gray-300 border border-gray-400/20'
                        : idx === 2 ? 'bg-orange-500/15 text-orange-300 border border-orange-500/20'
                        : 'bg-white/5 text-white/40 border border-white/5'
                      }`}>
                        {idx + 1}
                      </div>
                      {/* Poster */}
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={item.title || ''}
                          className="w-10 h-14 rounded-lg object-cover shrink-0 bg-white/5"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-14 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                          <Film className="w-4 h-4 text-white/20" />
                        </div>
                      )}
                      {/* Title + metadata */}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.title || `ID: ${item.itemId}`}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.mediaType && (
                            <span className="text-[10px] uppercase tracking-wider text-white/30 bg-white/5 px-2 py-0.5 rounded-full">
                              {item.mediaType === 'Series' ? 'Série' : item.mediaType === 'Movie' ? 'Film' : item.mediaType}
                            </span>
                          )}
                          {item.lastClick && (
                            <span className="text-[10px] text-white/25">
                              Dernier clic : {new Date(item.lastClick).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Click count */}
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-amber-300">{item.clicks}</p>
                        <p className="text-[10px] text-white/30 uppercase tracking-wider">clic{item.clicks > 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Users table ── */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] md:grid-cols-[2fr_1fr_1fr_auto_auto] gap-4 px-5 py-3 bg-white/[0.03] border-b border-white/5 text-xs text-white/40 uppercase tracking-wider">
                <span>Utilisateur</span>
                <span className="hidden md:block">Dernière connexion</span>
                <span>Rôle</span>
                <span className="text-right">Profil</span>
                <span className="text-right">Action</span>
              </div>

              {/* Rows */}
              {users.map((u, idx) => {
                const roleInfo = getRoleInfo(pendingChanges[u.userId] || u.role);
                const RoleIcon = roleInfo.icon;
                const hasChange = !!pendingChanges[u.userId];
                const isSaving = !!saving[u.userId];

                return (
                  <motion.div
                    key={u.userId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04, duration: 0.25 }}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] md:grid-cols-[2fr_1fr_1fr_auto_auto] gap-4 px-5 py-4 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors items-center"
                  >
                    {/* Username */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${roleInfo.bg} border`}>
                        {u.username?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.username}</p>
                        <p className="text-xs text-white/30 truncate font-mono">{u.userId?.slice(0, 12)}…</p>
                      </div>
                    </div>

                    {/* Last login */}
                    <span className="hidden md:block text-xs text-white/40">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>

                    {/* Role select */}
                    <div className="relative">
                      <select
                        value={pendingChanges[u.userId] || u.role}
                        onChange={(e) => handleRoleChange(u.userId, e.target.value)}
                        disabled={isSaving}
                        className={`appearance-none bg-transparent border rounded-lg px-3 py-1.5 pr-7 text-xs font-medium cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-40 ${roleInfo.bg} ${roleInfo.color}`}
                      >
                        {ROLES.map(r => (
                          <option key={r.value} value={r.value} className="bg-[#1a1a1a] text-white">
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <RoleIcon className={`absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${roleInfo.color}`} />
                    </div>

                    {/* View profile button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => setSelectedUserId(u.userId)}
                        className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/10 text-white/40 hover:text-white/70 transition-all border border-white/5"
                        aria-label="Voir le profil"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Save button */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => saveRole(u.userId)}
                        disabled={!hasChange || isSaving}
                        className={`p-2 rounded-lg transition-all ${
                          hasChange
                            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                            : 'bg-white/[0.02] text-white/15 border border-transparent cursor-not-allowed'
                        }`}
                        aria-label="Sauvegarder"
                      >
                        {isSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}

              {users.length === 0 && (
                <div className="px-5 py-12 text-center text-white/30 text-sm">
                  Aucun utilisateur trouvé.
                </div>
              )}
            </div>

            {/* ── Legend ── */}
            <div className="mt-6 flex flex-wrap gap-4 justify-center">
              {ROLES.map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.value} className="flex items-center gap-2 text-xs text-white/40">
                    <Icon className={`w-3.5 h-3.5 ${r.color}`} />
                    <span>{r.label}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

      {/* ── User Stats Slide-over ── */}
      <AnimatePresence>
        {selectedUserId && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
              onClick={() => setSelectedUserId(null)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-[#111] border-l border-white/5 z-[70] overflow-y-auto"
            >
              {/* Panel header */}
              <div className="sticky top-0 bg-[#111]/95 backdrop-blur-md border-b border-white/5 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {selectedUser && (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${getRoleInfo(selectedUser.role).bg} border`}>
                      {selectedUser.username?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div>
                    <h2 className="text-base font-semibold">{selectedUser?.username || '—'}</h2>
                    <p className="text-xs text-white/40">{getRoleInfo(selectedUser?.role).label}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedUserId(null)} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Panel body */}
              <div className="p-6 space-y-6">
                {userStatsLoading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-white/30" />
                  </div>
                ) : userStats ? (
                  <>
                    {/* Quick stats grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <MiniCard icon={Clock} color="text-blue-400" label="Temps total" value={formatWatchTime(userStats.totalWatchSeconds)} />
                      <MiniCard icon={Heart} color="text-pink-400" label="Favoris" value={String(userStats.favoritesCount || 0)} />
                    </div>

                    {/* Favorite genres */}
                    {userStats.favoriteGenres?.length > 0 && (
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                          <Film className="w-3.5 h-3.5" /> Genres favoris
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {userStats.favoriteGenres.map(g => (
                            <span key={g} className="px-3 py-1 rounded-full text-xs bg-white/5 text-white/60 border border-white/5">
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Parental control quick edit */}
                    <div>
                      <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5" /> Contrôle parental
                      </h3>
                      <select
                        value={pendingChanges[selectedUserId] || selectedUser?.role || 'adult'}
                        onChange={(e) => handleRoleChange(selectedUserId, e.target.value)}
                        className="w-full appearance-none bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                      >
                        {ROLES.map(r => (
                          <option key={r.value} value={r.value} className="bg-[#1a1a1a] text-white">
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {pendingChanges[selectedUserId] && (
                        <button
                          onClick={() => saveRole(selectedUserId)}
                          disabled={!!saving[selectedUserId]}
                          className="mt-2 w-full py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm font-medium border border-amber-500/30 transition-all disabled:opacity-40"
                        >
                          {saving[selectedUserId] ? 'Enregistrement…' : 'Sauvegarder le rôle'}
                        </button>
                      )}
                    </div>

                    {/* Recent activity */}
                    {userStats.recentActivity?.length > 0 && (
                      <div>
                        <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3 flex items-center gap-2">
                          <Activity className="w-3.5 h-3.5" /> Activité récente
                        </h3>
                        <div className="space-y-1 max-h-[300px] overflow-y-auto">
                          {userStats.recentActivity.map((ev, i) => (
                            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.03] transition-colors">
                              <div className="min-w-0">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  ev.action === 'watch' ? 'bg-blue-500/10 text-blue-400'
                                  : ev.action === 'favorite' ? 'bg-pink-500/10 text-pink-400'
                                  : ev.action === 'click' ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-white/5 text-white/40'
                                }`}>
                                  {ev.action}
                                </span>
                                {ev.value != null && (
                                  <span className="ml-2 text-xs text-white/30">
                                    {ev.action === 'watch' ? formatWatchTime(ev.value) : ev.value}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-white/25 shrink-0 ml-2">
                                {ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-center text-white/30 text-sm py-12">Aucune donnée disponible.</p>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Stat card for top telemetry row */
function StatCard({ icon: Icon, color, bg, label, value }) {
  return (
    <div className={`rounded-xl border border-white/5 ${bg} p-4 flex items-center gap-3`}>
      <Icon className={`w-5 h-5 ${color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight">{value}</p>
        <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      </div>
    </div>
  );
}

/** Mini stat card for slide-over */
function MiniCard({ icon: Icon, color, label, value }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
      <Icon className={`w-4 h-4 ${color} mb-2`} />
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}

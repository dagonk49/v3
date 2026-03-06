'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { api, cachedApi, invalidateCache } from '@/lib/api';
import { Shield, Users, ChevronLeft, Save, Loader2, Crown, User, Baby, AlertTriangle } from 'lucide-react';

/** Rôles disponibles avec métadonnées d'affichage */
const ROLES = [
  { value: 'admin', label: 'Administrateur', icon: Crown, color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30' },
  { value: 'adult', label: 'Adulte', icon: User, color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/30' },
  { value: 'child', label: 'Enfant', icon: Baby, color: 'text-green-400', bg: 'bg-green-400/10 border-green-400/30' },
];

/**
 * Page d'administration — Gestion des utilisateurs et rôles.
 * Accessible uniquement aux utilisateurs avec le rôle 'admin'.
 * Permet de modifier le rôle de chaque utilisateur (admin/adult/child).
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

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Charger les utilisateurs ──
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

  useEffect(() => {
    if (status === 'ready') loadUsers();
  }, [status, loadUsers]);

  // ── Mettre à jour le rôle d'un utilisateur ──
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
      setToast({ type: 'success', message: `Rôle mis à jour avec succès.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'Erreur lors de la mise à jour.' });
    } finally {
      setSaving(prev => ({ ...prev, [userId]: false }));
    }
  };

  // ── Attente auth ──
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 animate-spin text-white/40" />
      </div>
    );
  }

  // ── Rôle badge helper ──
  const getRoleInfo = (role) => ROLES.find(r => r.value === role) || ROLES[1];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ── Header ── */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
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
              <h1 className="text-lg font-semibold">Administration</h1>
              <p className="text-xs text-white/40">Gestion des utilisateurs et rôles</p>
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
      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-white/30" />
            <p className="text-white/40 text-sm">Chargement des utilisateurs…</p>
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {/* ── Users table ── */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[2fr_1fr_1fr_auto] gap-4 px-5 py-3 bg-white/[0.03] border-b border-white/5 text-xs text-white/40 uppercase tracking-wider">
                <span>Utilisateur</span>
                <span className="hidden md:block">Dernière connexion</span>
                <span>Rôle</span>
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
                    className="grid grid-cols-[1fr_auto_auto_auto] md:grid-cols-[2fr_1fr_1fr_auto] gap-4 px-5 py-4 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors items-center"
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
    </div>
  );
}

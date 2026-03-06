'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { cachedApi, clearCache, api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | setup | login | onboarding | ready
  const router = useRouter();
  const pathname = usePathname();

  // ── Initial auth check ──
  useEffect(() => {
    (async () => {
      try {
        const s = await cachedApi('setup/check');
        if (!s.setupComplete) { setStatus('setup'); return; }
        const sess = await cachedApi('auth/session');
        if (sess.authenticated) {
          setUser(sess.user);
          setStatus(sess.onboardingComplete ? 'ready' : 'onboarding');
        } else {
          setStatus('login');
        }
      } catch {
        setStatus('setup');
      }
    })();
  }, []);

  // ── Redirect based on auth status ──
  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = ['/login', '/setup', '/onboarding'].includes(pathname);
    const isAdmin = pathname === '/admin';
    if (status === 'setup' && pathname !== '/setup') router.replace('/setup');
    else if (status === 'login' && pathname !== '/login') router.replace('/login');
    else if (status === 'onboarding' && pathname !== '/onboarding') router.replace('/onboarding');
    else if (status === 'ready' && isPublic) router.replace('/');
    // /admin accessible uniquement si ready (authentifié) — le contrôle admin se fait côté page
  }, [status, pathname, router]);

  const onLogin = useCallback((u, onboardingComplete) => {
    clearCache();
    setUser(u);
    setStatus(onboardingComplete ? 'ready' : 'onboarding');
  }, []);

  const onLogout = useCallback(async () => {
    try { await api('auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearCache();
    setUser(null);
    setStatus('login');
  }, []);

  // V7.8: Écouter l'événement session expirée (token Jellyfin mort) → auto-logout
  useEffect(() => {
    const handler = () => {
      console.warn('[Auth] Session expirée détectée — déconnexion automatique');
      clearCache();
      setUser(null);
      setStatus('login');
    };
    window.addEventListener('dagzflix:session-expired', handler);
    return () => window.removeEventListener('dagzflix:session-expired', handler);
  }, []);

  const onSetupComplete = useCallback(() => setStatus('login'), []);
  const onOnboardingComplete = useCallback(() => setStatus('ready'), []);

  return (
    <AuthContext.Provider value={{ user, status, onLogin, onLogout, onSetupComplete, onOnboardingComplete }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

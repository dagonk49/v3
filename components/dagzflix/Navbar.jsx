'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Search, X, Home, Film, Tv, LogOut, Heart } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function Navbar() {
  const { user, onLogout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [sq, setSq] = useState('');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', h);
    return () => window.removeEventListener('scroll', h);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (sq.trim()) {
      router.push(`/search?q=${encodeURIComponent(sq.trim())}`);
      setSearchOpen(false);
      setSq('');
    }
  };

  const navItems = [
    { href: '/', label: 'Accueil', icon: Home },
    { href: '/movies', label: 'Films', icon: Film },
    { href: '/series', label: 'Séries', icon: Tv },
    { href: '/favorites', label: 'Favoris', icon: Heart },
  ];

  return (
    <nav data-testid="main-navbar" className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'bg-black/80 backdrop-blur-2xl shadow-2xl' : 'bg-gradient-to-b from-black/60 to-transparent'}`}>
      <div className="max-w-[1800px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
        <div className="flex items-center gap-10">
          <button data-testid="nav-logo" onClick={() => router.push('/')}>
            <h1 className="text-2xl font-black tracking-tighter"><span className="text-red-600">DAGZ</span><span>FLIX</span></h1>
          </button>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(t => {
              const isActive = pathname === t.href || (t.href !== '/' && pathname.startsWith(t.href));
              return (
                <button key={t.href} data-testid={`nav-${t.href === '/' ? 'dashboard' : t.href.slice(1)}`} onClick={() => router.push(t.href)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                  <t.icon className="w-4 h-4" />{t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {searchOpen ? (
              <motion.form key="s" initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }} onSubmit={submit} className="relative">
                <Input data-testid="nav-search-input" value={sq} onChange={e => setSq(e.target.value)} placeholder="Rechercher..." className="bg-white/5 border-white/10 text-white h-10 pl-10 pr-10 rounded-xl" autoFocus />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <button type="button" onClick={() => { setSearchOpen(false); setSq(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
              </motion.form>
            ) : (
              <button data-testid="nav-search-toggle" onClick={() => setSearchOpen(true)} className="p-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5">
                <Search className="w-5 h-5" />
              </button>
            )}
          </AnimatePresence>
          <div data-testid="nav-user-avatar" className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-red-600/20">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <button data-testid="nav-logout" onClick={onLogout} className="p-2 rounded-xl text-gray-500 hover:text-red-500 hover:bg-white/5" title="Déconnexion">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}

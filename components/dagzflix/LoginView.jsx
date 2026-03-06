'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { api, clearCache } from '@/lib/api';
import { pageVariants } from '@/lib/constants';

export function LoginView({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const r = await api('auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      if (r.success) { clearCache(); onLogin(r.user, r.onboardingComplete); }
      else setError(r.error || 'Échec');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-screen bg-[#050505] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-red-900/20 rounded-full blur-[150px]" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-purple-900/10 rounded-full blur-[120px]" />
      <div className="relative w-full max-w-md z-10">
        <div className="text-center mb-12">
          <h1 className="text-7xl font-black tracking-tighter mb-3"><span className="text-red-600">DAGZ</span><span>FLIX</span></h1>
          <p className="text-gray-500 font-light">Identifiants Jellyfin</p>
        </div>
        <motion.form initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} onSubmit={submit} className="glass-strong rounded-3xl p-10 space-y-6">
          <div>
            <Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">Utilisateur</Label>
            <Input data-testid="login-username" value={u} onChange={e => setU(e.target.value)} placeholder="Nom d'utilisateur" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-13 rounded-xl text-base" autoFocus />
          </div>
          <div>
            <Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">Mot de passe</Label>
            <div className="relative">
              <Input data-testid="login-password" value={p} onChange={e => setP(e.target.value)} type={show ? 'text' : 'password'} placeholder="Mot de passe" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-13 rounded-xl text-base pr-12" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300">{show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>
            </div>
          </div>
          {error && <div data-testid="login-error" className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
          <Button data-testid="login-submit" type="submit" className="w-full h-13 bg-red-600 hover:bg-red-700 font-bold text-lg rounded-xl" disabled={loading || !u}>{loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Se connecter'}</Button>
        </motion.form>
      </div>
    </motion.div>
  );
}

'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Loader2, Server, Link2, Download, Shield, ArrowRight, ChevronLeft, AlertCircle } from 'lucide-react';
import { api, invalidateCache } from '@/lib/api';
import { pageVariants } from '@/lib/constants';

export function SetupView({ onComplete }) {
  const [step, setStep] = useState(1);
  const [jUrl, setJUrl] = useState('');
  const [jKey, setJKey] = useState('');
  const [sUrl, setSUrl] = useState('');
  const [sKey, setSKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const testConn = async (t) => {
    setTesting(true); setTestResult(null); setError('');
    try {
      const r = await api('setup/test', {
        method: 'POST',
        body: JSON.stringify({ type: t, url: t === 'jellyfin' ? jUrl : sUrl, apiKey: t === 'jellyfin' ? jKey : sKey }),
      });
      if (r.success) setTestResult({ type: t, ...r });
      else setError(r.error || 'Échec');
    } catch (e) { setError(e.message); }
    setTesting(false);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await api('setup/save', {
        method: 'POST',
        body: JSON.stringify({ jellyfinUrl: jUrl, jellyfinApiKey: jKey, jellyseerrUrl: sUrl, jellyseerrApiKey: sKey }),
      });
      if (r.success) { invalidateCache('setup'); onComplete(); }
      else setError(r.error);
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-screen bg-[#050505] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <h1 className="text-7xl font-black tracking-tighter mb-3"><span className="text-red-600">DAGZ</span><span>FLIX</span></h1>
          <p className="text-gray-500 text-lg font-light">Configuration initiale</p>
        </div>
        <div className="flex items-center justify-center gap-3 mb-10">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold transition-all ${s === step ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-110' : s < step ? 'bg-white/10 text-green-400' : 'bg-white/5 text-gray-600'}`}>
                {s < step ? <Check className="w-5 h-5" /> : s}
              </div>
              {s < 3 && <div className={`w-14 h-[2px] rounded-full ${s < step ? 'bg-green-500/50' : 'bg-white/5'}`} />}
            </div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="glass-strong rounded-3xl p-8">
              <div className="flex items-center gap-4 mb-8"><div className="p-3.5 bg-purple-500/15 rounded-2xl"><Server className="w-6 h-6 text-purple-400" /></div><div><h2 className="text-xl font-bold">Jellyfin</h2><p className="text-sm text-gray-500">Serveur de streaming</p></div></div>
              <div className="space-y-5">
                <div><Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">URL *</Label><Input data-testid="setup-jellyfin-url" value={jUrl} onChange={e => setJUrl(e.target.value)} placeholder="https://jellyfin.example.com" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-12 rounded-xl" /></div>
                <div><Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">Clé API</Label><Input data-testid="setup-jellyfin-key" value={jKey} onChange={e => setJKey(e.target.value)} placeholder="Clé API" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-12 rounded-xl" type="password" /></div>
                {testResult?.type === 'jellyfin' && <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-2xl text-green-400 text-sm flex items-center gap-2"><Check className="w-4 h-4" />{testResult.serverName}</div>}
                {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm">{error}</div>}
                <div className="flex gap-3">
                  <Button data-testid="setup-test-jellyfin" variant="outline" className="flex-1 border-white/10 text-gray-300 h-12 rounded-xl" onClick={() => testConn('jellyfin')} disabled={!jUrl || testing}>{testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}Tester</Button>
                  <Button data-testid="setup-next-1" className="flex-1 bg-red-600 hover:bg-red-700 h-12 rounded-xl font-semibold" onClick={() => { setStep(2); setError(''); setTestResult(null); }} disabled={!jUrl}>Suivant<ArrowRight className="w-4 h-4 ml-2" /></Button>
                </div>
              </div>
            </motion.div>
          )}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="glass-strong rounded-3xl p-8">
              <div className="flex items-center gap-4 mb-8"><div className="p-3.5 bg-blue-500/15 rounded-2xl"><Download className="w-6 h-6 text-blue-400" /></div><div><h2 className="text-xl font-bold">Jellyseerr</h2><p className="text-sm text-gray-500">Requêtes (optionnel)</p></div></div>
              <div className="space-y-5">
                <div><Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">URL</Label><Input data-testid="setup-jellyseerr-url" value={sUrl} onChange={e => setSUrl(e.target.value)} placeholder="https://jellyseerr.example.com" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-12 rounded-xl" /></div>
                <div><Label className="text-gray-400 text-xs uppercase tracking-wider mb-2 block">Clé API</Label><Input data-testid="setup-jellyseerr-key" value={sKey} onChange={e => setSKey(e.target.value)} placeholder="Clé API" className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 h-12 rounded-xl" type="password" /></div>
                {error && <div className="p-4 bg-red-500/10 rounded-2xl text-red-400 text-sm">{error}</div>}
                <div className="flex gap-3">
                  <Button variant="outline" className="border-white/10 text-gray-300 h-12 rounded-xl" onClick={() => { setStep(1); setError(''); }}><ChevronLeft className="w-4 h-4 mr-1" />Retour</Button>
                  <Button data-testid="setup-next-2" className="flex-1 bg-red-600 hover:bg-red-700 h-12 rounded-xl font-semibold" onClick={() => { setStep(3); setError(''); }}>Suivant<ArrowRight className="w-4 h-4 ml-2" /></Button>
                </div>
              </div>
            </motion.div>
          )}
          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="glass-strong rounded-3xl p-8">
              <div className="flex items-center gap-4 mb-8"><div className="p-3.5 bg-green-500/15 rounded-2xl"><Shield className="w-6 h-6 text-green-400" /></div><div><h2 className="text-xl font-bold">Confirmation</h2></div></div>
              <div className="space-y-4">
                <div className="p-5 bg-white/3 rounded-2xl border border-white/5"><p className="text-purple-400 text-sm font-semibold mb-1">Jellyfin</p><p className="text-sm text-gray-300 break-all">{jUrl}</p></div>
                <div className="p-5 bg-white/3 rounded-2xl border border-white/5"><p className="text-blue-400 text-sm font-semibold mb-1">Jellyseerr</p><p className="text-sm text-gray-300 break-all">{sUrl || 'Non configuré'}</p></div>
                {error && <div className="p-4 bg-red-500/10 rounded-2xl text-red-400 text-sm">{error}</div>}
                <div className="flex gap-3">
                  <Button variant="outline" className="border-white/10 text-gray-300 h-12 rounded-xl" onClick={() => setStep(2)}><ChevronLeft className="w-4 h-4 mr-1" />Retour</Button>
                  <Button data-testid="setup-save" className="flex-1 bg-red-600 hover:bg-red-700 h-12 rounded-xl font-bold pulse-glow" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}Sauvegarder</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

'use client';
import { AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { usePlayer } from '@/lib/player-context';
import { LoadingScreen } from './LoadingScreen';
import { Navbar } from './Navbar';
import { VideoPlayer } from './VideoPlayer';

const PUBLIC_PATHS = ['/login', '/setup', '/onboarding'];

export function AppShell({ children }) {
  const { status } = useAuth();
  const { playerItem, episodeId, close } = usePlayer();
  const pathname = usePathname();

  // Show loading during initial auth check
  if (status === 'loading') return <LoadingScreen />;

  const isPublic = PUBLIC_PATHS.includes(pathname);

  // While redirect is pending, show loading to prevent flash
  if (status !== 'ready' && !isPublic) return <LoadingScreen />;
  if (status === 'ready' && isPublic) return null; // redirect in progress

  const showNavbar = status === 'ready' && !isPublic;

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <AnimatePresence>
        {playerItem && (
          <VideoPlayer item={playerItem} episodeId={episodeId} onClose={close} />
        )}
      </AnimatePresence>
      {showNavbar && <Navbar />}
      {children}
    </div>
  );
}

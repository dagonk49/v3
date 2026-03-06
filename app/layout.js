import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { PlayerProvider } from '@/lib/player-context';
import { AppShell } from '@/components/dagzflix/AppShell';

export const metadata = {
  title: 'DagzFlix - Streaming Unifié',
  description: 'Plateforme de streaming unifiée - Regardez et demandez vos contenus préférés',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen bg-[#0a0a0a] text-white antialiased">
        <AuthProvider>
          <PlayerProvider>
            <AppShell>{children}</AppShell>
          </PlayerProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

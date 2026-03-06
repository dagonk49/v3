'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { usePlayer } from '@/lib/player-context';
import { setItemCache } from '@/lib/item-store';
import { DashboardView } from '@/components/dagzflix/DashboardView';

export default function HomePage() {
  const { user, status } = useAuth();
  const { play } = usePlayer();
  const router = useRouter();

  if (status !== 'ready') return null;

  const handleItemClick = (item) => {
    if (item?.__searchGenre) {
      router.push(`/search?genre=${encodeURIComponent(item.__searchGenre)}`);
      return;
    }
    const itemId = item.id || item.tmdbId;
    if (itemId) setItemCache(itemId, item);
    router.push(`/media/${itemId}`);
  };

  return <DashboardView user={user} onItemClick={handleItemClick} onPlay={(item) => play(item)} />;
}

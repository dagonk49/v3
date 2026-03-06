'use client';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { usePlayer } from '@/lib/player-context';
import { getItemCache, setItemCache } from '@/lib/item-store';
import { MediaDetailView } from '@/components/dagzflix/MediaDetailView';

export default function MediaDetailPage() {
  const { status } = useAuth();
  const { play } = usePlayer();
  const router = useRouter();
  const params = useParams();

  if (status !== 'ready') return null;

  const itemId = params.id;
  const cachedItem = getItemCache(itemId);
  const item = cachedItem || { id: itemId };

  const handleItemClick = (itemToClick) => {
    if (itemToClick?.__searchGenre) {
      router.push(`/search?genre=${encodeURIComponent(itemToClick.__searchGenre)}`);
      return;
    }
    const id = itemToClick.id || itemToClick.tmdbId;
    if (id) setItemCache(id, itemToClick);
    router.push(`/media/${id}`);
  };

  return (
    <MediaDetailView
      item={item}
      onBack={() => router.back()}
      onPlay={(playItem) => play(playItem)}
      onItemClick={handleItemClick}
    />
  );
}

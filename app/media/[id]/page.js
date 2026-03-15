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

    let rawId = String(itemToClick.id || itemToClick.tmdbId);
    
    // LE CORRECTIF FRONTEND EST ICI : On ajoute 'tv' ou 'movie' dans l'URL
    if (/^\d+$/.test(rawId) || rawId.startsWith('tmdb-')) {
        const cleanId = rawId.replace(/^tmdb-(tv-|movie-)?/, '');
        const isTv = itemToClick.mediaType === 'tv' || itemToClick.type === 'Series';
        rawId = `tmdb-${isTv ? 'tv' : 'movie'}-${cleanId}`;
    }
    
    if (rawId) setItemCache(rawId, itemToClick);
    router.push(`/media/${rawId}`);
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
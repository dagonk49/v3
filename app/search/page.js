'use client';
import { Suspense } from 'react';
import { useAuth } from '@/lib/auth-context';
import { SearchView } from '@/components/dagzflix/SearchView';

function SearchFallback() {
  return (
    <div className="pt-24 px-6 md:px-16 min-h-screen">
      <div className="h-14 skeleton max-w-2xl rounded-2xl mb-10" />
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 w-24 skeleton rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
        {Array.from({ length: 12 }).map((_, i) => <div key={i}><div className="aspect-[2/3] skeleton rounded-2xl" /></div>)}
      </div>
    </div>
  );
}

export default function SearchPage() {
  const { status } = useAuth();
  if (status !== 'ready') return null;

  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchView />
    </Suspense>
  );
}

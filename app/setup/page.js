'use client';
import { useAuth } from '@/lib/auth-context';
import { SetupView } from '@/components/dagzflix/SetupView';

export default function SetupPage() {
  const { onSetupComplete, status } = useAuth();
  if (status !== 'setup') return null;
  return <SetupView onComplete={onSetupComplete} />;
}

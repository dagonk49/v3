'use client';
import { useAuth } from '@/lib/auth-context';
import { OnboardingView } from '@/components/dagzflix/OnboardingView';

export default function OnboardingPage() {
  const { onOnboardingComplete, status } = useAuth();
  if (status !== 'onboarding') return null;
  return <OnboardingView onComplete={onOnboardingComplete} />;
}

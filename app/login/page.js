'use client';
import { useAuth } from '@/lib/auth-context';
import { LoginView } from '@/components/dagzflix/LoginView';

export default function LoginPage() {
  const { onLogin, status } = useAuth();
  if (status !== 'login') return null;
  return <LoginView onLogin={onLogin} />;
}

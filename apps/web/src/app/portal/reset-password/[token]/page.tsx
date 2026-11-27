'use client';

import { useParams } from 'next/navigation';
import { PortalFrame } from '@/components/portal/frame';
import { ResetPasswordForm } from '@/components/password-reset';

export default function PortalResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  return <PortalFrame><title>Reset password, Client portal</title><ResetPasswordForm base="/portal/auth" token={token} loginHref="/portal/login" forgotHref="/portal/forgot-password" /></PortalFrame>;
}

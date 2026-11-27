'use client';

import { useParams } from 'next/navigation';
import { ResetPasswordForm } from '@/components/password-reset';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  return <><title>Reset password, FreelanceOS</title><ResetPasswordForm base="/auth" token={token} loginHref="/login" forgotHref="/forgot-password" /></>;
}

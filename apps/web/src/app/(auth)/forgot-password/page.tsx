'use client';

import { ForgotPasswordForm } from '@/components/password-reset';

export default function ForgotPasswordPage() {
  return <><title>Forgot password, FreelanceOS</title><ForgotPasswordForm base="/auth" loginHref="/login" /></>;
}

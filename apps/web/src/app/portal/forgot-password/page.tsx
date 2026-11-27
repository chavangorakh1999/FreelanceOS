'use client';

import { PortalFrame } from '@/components/portal/frame';
import { ForgotPasswordForm } from '@/components/password-reset';

export default function PortalForgotPasswordPage() {
  return <PortalFrame><title>Forgot password, Client portal</title><ForgotPasswordForm base="/portal/auth" loginHref="/portal/login" /></PortalFrame>;
}

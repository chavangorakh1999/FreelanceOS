import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = { title: { default: 'FreelanceOS', template: '%s · FreelanceOS' }, description: 'Run your freelance business from first conversation to final payment.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}

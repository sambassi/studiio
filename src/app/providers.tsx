'use client';

import { SessionProvider } from 'next-auth/react';
import { I18nProvider } from '@/i18n/provider';
import ServiceAlertBanner from '@/components/ui/ServiceAlertBanner';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider>
        <ServiceAlertBanner />
        {children}
      </I18nProvider>
    </SessionProvider>
  );
}

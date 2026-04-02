'use client';

import { useTranslations } from '@/i18n/client';

export default function PrivacyPage() {
  const t = useTranslations('privacy');

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">{t('title')}</h1>
      <p className="text-gray-400 mb-4">{t('lastUpdated')}</p>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.introduction.title')}</h2>
        <p className="text-gray-300">{t('sections.introduction.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.tiktokApp.title')}</h2>
        <p className="text-gray-300">{t('sections.tiktokApp.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.dataCollection.title')}</h2>
        <p className="text-gray-300">{t('sections.dataCollection.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.dataUsage.title')}</h2>
        <p className="text-gray-300">{t('sections.dataUsage.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.dataSharing.title')}</h2>
        <p className="text-gray-300">{t('sections.dataSharing.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.security.title')}</h2>
        <p className="text-gray-300">{t('sections.security.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.dataDeletion.title')}</h2>
        <p className="text-gray-300">{t('sections.dataDeletion.content')}</p>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">{t('sections.contactSection.title')}</h2>
        <p className="text-gray-300">{t('sections.contactSection.content')}</p>
      </section>
    </div>
  );
}

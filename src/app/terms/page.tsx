'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

interface TermsData {
  success: boolean;
  content: string;
  updatedAt: string;
}

export default function TermsPage() {
  const t = useTranslations('terms');
  const [terms, setTerms] = useState<TermsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTerms() {
      try {
        const res = await fetch('/api/terms');
        const data: TermsData = await res.json();
        setTerms(data);
      } catch (error) {
        console.error('Failed to fetch terms:', error);
        setTerms({
          success: false,
          content: t('loadError'),
          updatedAt: new Date().toISOString(),
        });
      } finally {
        setLoading(false);
      }
    }

    fetchTerms();
  }, []);

  const lastUpdated = terms?.updatedAt
    ? new Date(terms.updatedAt).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-studiio-primary hover:text-orange-400 transition mb-6"
          >
            <ArrowLeft size={20} />
            {t('backToHome')}
          </Link>

          <h1 className="text-4xl font-bold mb-2">{t('title')}</h1>

          {lastUpdated && (
            <p className="text-gray-400 text-sm">
              {t('lastUpdated', { date: lastUpdated })}
            </p>
          )}
        </div>

        {/* Branding */}
        <div className="mb-8 pb-8 border-b border-gray-800">
          <p className="text-gray-300">
            <strong className="text-gradient">{t('branding')}</strong>
          </p>
        </div>

        {/* Content - uses dangerouslySetInnerHTML as in original code; content comes from admin-controlled API */}
        <div className="prose prose-invert max-w-none">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-studiio-primary"></div>
              </div>
              <p className="text-gray-400 mt-4">{t('loadingTerms')}</p>
            </div>
          ) : terms?.success && terms?.content ? (
            <div
              className="bg-gray-900 rounded-lg p-8 border border-gray-800"
              dangerouslySetInnerHTML={{
                __html: terms.content
              }}
            />
          ) : (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-6 text-red-300">
              <p>{t('unavailable')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm">
            © 2024 Studiio. Tous droits réservés.
          </p>
        </div>
      </div>
    </main>
  );
}

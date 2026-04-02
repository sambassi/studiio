'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTranslations } from '@/i18n/client';

interface TermsData {
  content: string;
  lastModified: string;
  modifiedBy: string;
}

export default function TermsPage() {
  const t = useTranslations('admin');
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [lastModified, setLastModified] = useState('');
  const [modifiedBy, setModifiedBy] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchTerms();
  }, []);

  const fetchTerms = async () => {
    try {
      setLoading(true);
      setError('');

      const res = await fetch('/api/admin/terms');

      if (!res.ok) throw new Error(t('terms.errorLoading'));

      const data: TermsData = await res.json();
      setContent(data.content);
      setOriginalContent(data.content);
      setLastModified(data.lastModified);
      setModifiedBy(data.modifiedBy);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');

      const res = await fetch('/api/admin/terms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) throw new Error(t('terms.errorSaving'));

      const data: TermsData = await res.json();
      setOriginalContent(content);
      setLastModified(data.lastModified);
      setModifiedBy(data.modifiedBy);
      showToast(t('terms.saved'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== originalContent;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('terms.title')}</h1>
        <p className="text-gray-400">{t('terms.subtitle')}</p>
      </div>

      {toast && (
        <div className={`px-4 py-3 rounded-lg flex items-center gap-3 ${
          toast.type === 'success'
            ? 'bg-green-900/20 border border-green-800 text-green-300'
            : 'bg-red-900/20 border border-red-800 text-red-300'
        }`}>
          {toast.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('terms.editContent')}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                </div>
              ) : (
                <div className="space-y-4">
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="input-base w-full h-96 resize-none font-mono text-sm"
                    placeholder={t('terms.placeholder')}
                  />
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      disabled={!hasChanges || saving}
                      onClick={() => {
                        setContent(originalContent);
                      }}
                    >
                      {t('terms.cancelChanges')}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!hasChanges || saving}
                      onClick={handleSave}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          {t('terms.saving')}
                        </>
                      ) : (
                        t('terms.save')
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('terms.info.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('terms.info.lastModified')}</p>
                <p className="text-white">
                  {lastModified ? new Date(lastModified).toLocaleDateString('fr-FR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }) : t('terms.info.never')}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('terms.info.modifiedBy')}</p>
                <p className="text-white">{modifiedBy || t('terms.info.na')}</p>
              </div>
              <div className="pt-4 border-t border-gray-800">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('terms.info.characterCount')}</p>
                <p className="text-white text-2xl font-bold">{content.length.toLocaleString('fr-FR')}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t('terms.info.lineCount')}</p>
                <p className="text-white text-2xl font-bold">{content.split('\n').length}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('terms.preview')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-gray-300 max-h-96 overflow-y-auto prose prose-invert">
                {content.slice(0, 500)}
                {content.length > 500 && '...'}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

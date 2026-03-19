import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StoryTemplate } from '@picture-book/shared';
import { apiClient } from '../api/client';
import { AppHeader } from '../components/AppHeader';

export function TemplateSelectPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<StoryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get<{ templates: StoryTemplate[] }>('/api/templates');
      setTemplates(res.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テンプレートの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="テンプレートを選択" />
      <main className="mx-auto max-w-4xl px-6 py-8">
        {loading && <p className="text-center text-gray-500">読み込み中...</p>}
        {error && (
          <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && templates.length === 0 && (
          <p className="text-center text-gray-500">テンプレートがありません</p>
        )}
        {!loading && templates.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/templates/${t.id}/assign`)}
                className="rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
              >
                <h2 className="text-sm font-semibold text-gray-800">{t.title}</h2>
                <p className="mt-1 text-xs text-gray-500">{t.description}</p>
                <p className="mt-2 text-xs text-gray-400">
                  対象年齢: {t.ageRange.min}〜{t.ageRange.max}歳
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.roles.map((r) => (
                    <span key={r.role} className={`rounded-full px-2 py-0.5 text-xs ${r.required ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.label}{r.required ? ' *' : ''}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { THEME_LABELS } from '@picture-book/shared';
import type { Theme } from '@picture-book/shared';
import { AppHeader } from '../components/AppHeader';

const THEME_EMOJIS: Record<Theme, string> = {
  adventure: '🗺️',
  animals: '🐾',
  space: '🚀',
  ocean: '🌊',
  magic: '✨',
  friendship: '🤝',
};

const themes = Object.keys(THEME_LABELS) as Theme[];

export function ThemeSelectPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [pageCount, setPageCount] = useState<number | ''>('');
  const [warning, setWarning] = useState('');

  function handleGenerate() {
    if (!selectedTheme) {
      setWarning('テーマを選択してください');
      return;
    }
    setWarning('');
    navigate('/generating/new', {
      state: {
        profileId,
        theme: selectedTheme,
        ...(pageCount !== '' ? { pageCount: Number(pageCount) } : {}),
      },
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="テーマを選択" />
      <div className="flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl rounded-lg bg-white p-8 shadow">

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {themes.map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => {
                setSelectedTheme(theme);
                setWarning('');
              }}
              aria-pressed={selectedTheme === theme}
              className={`flex flex-col items-center gap-2 rounded-lg border-2 p-6 text-center transition-colors ${
                selectedTheme === theme
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <span className="text-4xl" role="img" aria-hidden="true">
                {THEME_EMOJIS[theme]}
              </span>
              <span className="text-sm font-medium text-gray-700">
                {THEME_LABELS[theme]}
              </span>
            </button>
          ))}
        </div>

        {warning && (
          <p role="alert" className="mb-4 text-center text-sm text-red-600">
            {warning}
          </p>
        )}

        <div className="mb-4">
          <label htmlFor="pageCount" className="mb-1 block text-sm font-medium text-gray-700">
            ページ数（空欄で年齢に応じた自動設定）
          </label>
          <input
            id="pageCount"
            type="number"
            min={1}
            max={16}
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="例: 2"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          生成開始
        </button>
      </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { PageData } from '@picture-book/shared';
import { getToken } from '../api/client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const MAX_LENGTH = 200;

interface PageEditorProps {
  bookId: string;
  page: PageData;
  onTextUpdate: (pageNumber: number, newText: string) => void;
}

interface ContentUnsafeError {
  code: 'CONTENT_UNSAFE';
  message: string;
  details: { flaggedCategories: string[] };
}

export function PageEditor({ bookId, page, onTextUpdate }: PageEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(page.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [flaggedCategories, setFlaggedCategories] = useState<string[]>([]);

  function handleEdit() {
    setDraft(page.text);
    setError('');
    setFlaggedCategories([]);
    setEditing(true);
  }

  function handleCancel() {
    setDraft(page.originalText);
    setError('');
    setFlaggedCategories([]);
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setFlaggedCategories([]);

    try {
      const token = getToken();
      const res = await fetch(
        `${API_URL}/api/books/${bookId}/pages/${page.pageNumber}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text: draft }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: '保存に失敗しました' }));
        if (body.code === 'CONTENT_UNSAFE') {
          const unsafe = body as ContentUnsafeError;
          setError(unsafe.message);
          setFlaggedCategories(unsafe.details.flaggedCategories);
          return;
        }
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }

      onTextUpdate(page.pageNumber, draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  const overLimit = draft.length > MAX_LENGTH;

  if (!editing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleEdit}
          className="rounded border border-blue-300 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
        >
          編集
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        className={`w-full rounded border p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 ${
          overLimit
            ? 'border-red-400 focus:ring-red-300'
            : 'border-gray-300 focus:ring-blue-300'
        }`}
      />

      <div className="flex items-center justify-between text-xs">
        <span className={overLimit ? 'font-medium text-red-600' : 'text-gray-500'}>
          {draft.length} / {MAX_LENGTH} 文字
          {overLimit && ' — 200文字を超えています'}
        </span>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            取り消し
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || overLimit}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {flaggedCategories.length > 0 && (
            <p className="mt-1 text-xs text-red-600">
              検出カテゴリ: {flaggedCategories.join(', ')}。内容を修正してください。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

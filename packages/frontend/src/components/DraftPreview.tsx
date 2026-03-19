import { useState } from 'react';
import type { StoryDraft } from '@picture-book/shared';

interface DraftPreviewProps {
  draft: StoryDraft;
  onApprove: (editedDraft: StoryDraft) => void;
  onEdit: () => void;
}

export function DraftPreview({ draft, onApprove, onEdit }: DraftPreviewProps) {
  const [pages, setPages] = useState(draft.pages.map((p) => ({ ...p })));

  function handleTextChange(index: number, text: string) {
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, text } : p)));
  }

  function handleApprove() {
    onApprove({ ...draft, pages });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-4 text-lg font-bold text-gray-800">{draft.title}</h2>
      <div className="space-y-3">
        {pages.map((page, i) => (
          <div key={page.pageNumber} className="rounded border border-gray-100 p-3">
            <p className="mb-1 text-xs text-gray-400">ページ {page.pageNumber}</p>
            <textarea
              value={page.text}
              onChange={(e) => handleTextChange(i, e.target.value)}
              rows={2}
              className="w-full resize-none rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-400"
            />
            {page.roles.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">登場: {page.roles.join(', ')}</p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleApprove}
          className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          承認して保存
        </button>
        <button
          onClick={onEdit}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          やり直す
        </button>
      </div>
    </div>
  );
}

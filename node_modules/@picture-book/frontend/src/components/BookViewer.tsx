import { useState } from 'react';
import type { PageData } from '@picture-book/shared';
import { PageEditor } from './PageEditor';

interface BookViewerProps {
  pages: PageData[];
  bookId?: string;
  onTextUpdate?: (pageNumber: number, newText: string) => void;
}

export function BookViewer({ pages, bookId, onTextUpdate }: BookViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (pages.length === 0) {
    return <p className="text-center text-gray-500">ページがありません</p>;
  }

  const page = pages[currentIndex];
  const totalPages = pages.length;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === totalPages - 1;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Illustration */}
      <div className="w-full overflow-hidden rounded-lg bg-gray-100">
        <img
          src={page.imageUrl}
          alt={`ページ ${page.pageNumber}`}
          className="h-auto w-full object-contain"
        />
      </div>

      {/* Text */}
      <p className="w-full rounded-lg bg-white p-4 text-center text-base leading-relaxed text-gray-800">
        {page.text}
      </p>

      {/* Page Editor */}
      {bookId && onTextUpdate && (
        <div className="w-full">
          <PageEditor bookId={bookId} page={page} onTextUpdate={onTextUpdate} />
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setCurrentIndex((i) => i - 1)}
          disabled={isFirst}
          aria-label="前のページ"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 前へ
        </button>

        <span className="min-w-[4rem] text-center text-sm text-gray-600">
          {currentIndex + 1} / {totalPages}
        </span>

        <button
          type="button"
          onClick={() => setCurrentIndex((i) => i + 1)}
          disabled={isLast}
          aria-label="次のページ"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          次へ →
        </button>
      </div>
    </div>
  );
}

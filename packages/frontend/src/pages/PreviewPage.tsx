import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { PageData } from '@picture-book/shared';
import { apiClient, getToken } from '../api/client';
import { BookViewer } from '../components/BookViewer';
import { AppHeader } from '../components/AppHeader';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

interface BookDetail {
  id: string;
  title: string;
  profileId: string;
  theme: string;
  pages: PageData[];
  createdAt: string;
  updatedAt: string;
}

export function PreviewPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const fetchBook = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.get<BookDetail>(`/api/books/${bookId}`);
      setBook(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '絵本の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchBook();
  }, [fetchBook]);

  async function handleDownload() {
    if (!bookId) return;
    setDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/books/${bookId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`ダウンロードに失敗しました (${res.status})`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${book?.title ?? 'ehon'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ダウンロードに失敗しました');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow">
          <p className="mb-2 text-4xl">⚠️</p>
          <p className="mb-4 text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            ダッシュボードに戻る
          </button>
        </div>
      </div>
    );
  }

  if (!book) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={book.title}>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          {downloading ? 'ダウンロード準備中...' : 'PDFダウンロード'}
        </button>
      </AppHeader>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <BookViewer
          pages={book.pages}
          bookId={book.id}
          onTextUpdate={(pageNumber, newText) => {
            setBook((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                pages: prev.pages.map((p) =>
                  p.pageNumber === pageNumber ? { ...p, text: newText } : p,
                ),
              };
            });
          }}
        />
      </main>
    </div>
  );
}

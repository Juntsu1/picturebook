import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';

interface BookSummary {
  id: string;
  title: string;
  thumbnailUrl: string;
  createdAt: string;
  updatedAt: string;
}

export function DashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get<{ books: BookSummary[] }>('/api/books');
      setBooks(res.books);
    } catch (err) {
      setError(err instanceof Error ? err.message : '絵本の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  async function handleDelete(bookId: string, title: string) {
    const confirmed = window.confirm(`「${title}」を削除しますか？この操作は取り消せません。`);
    if (!confirmed) return;

    try {
      await apiClient.delete(`/api/books/${bookId}`);
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました');
    }
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">マイ絵本</h1>
        <button
          onClick={handleLogout}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          ログアウト
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <button
            onClick={() => navigate('/templates')}
            className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:shadow-md"
          >
            <p className="text-2xl">📖</p>
            <p className="mt-2 text-sm font-medium text-gray-800">テンプレートから作成</p>
          </button>
          <button
            onClick={() => navigate('/profiles/new')}
            className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:shadow-md"
          >
            <p className="text-2xl">✏️</p>
            <p className="mt-2 text-sm font-medium text-gray-800">自由に作成</p>
          </button>
          <button
            onClick={() => navigate('/chat-stories')}
            className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:shadow-md"
          >
            <p className="text-2xl">🤖</p>
            <p className="mt-2 text-sm font-medium text-gray-800">AIと一緒にストーリーを作る</p>
          </button>
          <button
            onClick={() => navigate('/characters')}
            className="rounded-lg border border-gray-200 bg-white p-4 text-center shadow-sm transition hover:shadow-md"
          >
            <p className="text-2xl">👥</p>
            <p className="mt-2 text-sm font-medium text-gray-800">キャラクター管理</p>
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-500">読み込み中...</p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {!loading && !error && books.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="mb-4 text-gray-500">まだ絵本がありません</p>
            <button
              onClick={() => navigate('/profiles/new')}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              最初の絵本を作る
            </button>
          </div>
        )}

        {!loading && books.length > 0 && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <div
                key={book.id}
                className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/books/${book.id}`)}
                  className="block w-full text-left"
                  aria-label={`${book.title}を開く`}
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-gray-100">
                    {book.thumbnailUrl ? (
                      <img
                        src={book.thumbnailUrl}
                        alt={book.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-400">
                        No Image
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-sm font-semibold text-gray-800">
                      {book.title}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(book.createdAt).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                </button>
                <div className="border-t border-gray-100 px-4 py-2">
                  <button
                    onClick={() => handleDelete(book.id, book.title)}
                    className="text-xs text-red-500 hover:text-red-700"
                    aria-label={`${book.title}を削除`}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

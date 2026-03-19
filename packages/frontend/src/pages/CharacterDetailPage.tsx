import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CharacterSheetStatus } from '../components/CharacterSheetStatus';
import { AppHeader } from '../components/AppHeader';
import { CHARACTER_ROLES } from '@picture-book/shared';

interface CharacterDetail {
  id: string;
  name: string;
  role: string;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  photoUrl: string | null;
  characterSheetUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
}

export function CharacterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<CharacterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<CharacterDetail>(`/api/characters/${id}`);
        if (!cancelled) setCharacter(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Poll while generating
  useEffect(() => {
    if (!id || character?.characterSheetStatus !== 'generating') return;
    const timer = setInterval(async () => {
      try {
        const res = await apiClient.get<CharacterDetail>(`/api/characters/${id}`);
        setCharacter(res);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [id, character?.characterSheetStatus]);

  async function handleRegenerate() {
    if (!id) return;
    setRegenerating(true);
    try {
      await apiClient.post(`/api/characters/${id}/regenerate-sheet`);
      setCharacter((prev) => prev ? { ...prev, characterSheetStatus: 'generating', characterSheetUrl: null } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : '再生成に失敗しました');
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error || 'キャラクターが見つかりません'}</p>
          <button onClick={() => navigate('/characters')} className="text-blue-600 hover:underline">
            一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  const roleLabel = CHARACTER_ROLES[character.role as keyof typeof CHARACTER_ROLES] ?? character.role;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={character.name}>
        <button
          onClick={() => navigate(`/characters/${character.id}/edit`)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          編集
        </button>
      </AppHeader>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Character info */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow">
          <div className="flex items-start gap-6">
            {character.photoUrl ? (
              <img
                src={character.photoUrl}
                alt={`${character.name}の写真`}
                className="h-32 w-32 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-gray-200 text-gray-400">
                写真なし
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-800">{character.name}</h2>
              <p className="text-sm text-gray-600">{roleLabel}</p>
              {character.age != null && <p className="text-sm text-gray-500">{character.age}歳</p>}
              {character.gender && <p className="text-sm text-gray-500">{character.gender}</p>}
              {character.appearance && (
                <p className="mt-2 text-sm text-gray-600">{character.appearance}</p>
              )}
            </div>
          </div>
        </div>

        {/* Character sheet section */}
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">キャラクターシート</h2>
            <div className="flex items-center gap-3">
              <CharacterSheetStatus status={character.characterSheetStatus} />
              {(character.characterSheetStatus === 'completed' || character.characterSheetStatus === 'failed') && (
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {regenerating ? '再生成中...' : '再生成'}
                </button>
              )}
            </div>
          </div>

          {character.characterSheetStatus === 'none' && (
            <p className="text-sm text-gray-500">
              写真をアップロードするとキャラクターシートが自動生成されます。
            </p>
          )}

          {character.characterSheetStatus === 'generating' && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              キャラクターシートを生成中です。しばらくお待ちください...
            </div>
          )}

          {character.characterSheetStatus === 'failed' && (
            <p className="text-sm text-red-600">
              キャラクターシートの生成に失敗しました。「再生成」ボタンで再試行できます。
            </p>
          )}

          {character.characterSheetStatus === 'completed' && character.characterSheetUrl && (
            <div className="mt-2">
              <img
                src={character.characterSheetUrl}
                alt={`${character.name}のキャラクターシート`}
                className="max-w-full rounded-lg border border-gray-200"
              />
            </div>
          )}

          {character.characterSheetStatus === 'completed' && !character.characterSheetUrl && (
            <p className="text-sm text-gray-500">
              キャラクターシートは生成済みですが、URLの取得に失敗しました。再生成をお試しください。
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

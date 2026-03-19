import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CharacterCard } from '../components/CharacterCard';
import { AppHeader } from '../components/AppHeader';

interface CharacterResponse {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
}

export function CharacterListPage() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<CharacterResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCharacters = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get<{ characters: CharacterResponse[] }>('/api/characters');
      setCharacters(res.characters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'キャラクターの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  // Poll while any character has 'generating' status
  useEffect(() => {
    const hasGenerating = characters.some((c) => c.characterSheetStatus === 'generating');
    if (!hasGenerating) return;
    const timer = setInterval(() => {
      apiClient.get<{ characters: CharacterResponse[] }>('/api/characters').then((res) => {
        setCharacters(res.characters);
      }).catch(() => { /* ignore polling errors */ });
    }, 5000);
    return () => clearInterval(timer);
  }, [characters]);

  async function handleDelete(id: string) {
    const confirmed = window.confirm('このキャラクターを削除しますか？');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/api/characters/${id}`);
      setCharacters((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : '削除に失敗しました');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="キャラクター管理">
        <button
          onClick={() => navigate('/characters/new')}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          新規キャラクター登録
        </button>
      </AppHeader>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && <p className="text-center text-gray-500">読み込み中...</p>}
        {error && (
          <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && characters.length === 0 && (
          <p className="text-center text-gray-500">キャラクターが登録されていません</p>
        )}
        {!loading && characters.length > 0 && (
          <div className="space-y-4">
            {characters.map((c) => (
              <CharacterCard
                key={c.id}
                id={c.id}
                name={c.name}
                role={c.role}
                photoUrl={c.photoUrl}
                characterSheetStatus={c.characterSheetStatus}
                onClick={(cid) => navigate(`/characters/${cid}`)}
                onEdit={(cid) => navigate(`/characters/${cid}/edit`)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

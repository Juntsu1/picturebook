import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { StoryTemplate } from '@picture-book/shared';
import { apiClient } from '../api/client';
import { RoleAssignmentPanel } from '../components/RoleAssignmentPanel';
import { AppHeader } from '../components/AppHeader';

interface CharacterResponse {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
}

export function RoleAssignPage() {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const [template, setTemplate] = useState<StoryTemplate | null>(null);
  const [characters, setCharacters] = useState<CharacterResponse[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError('');
    try {
      const [tplRes, charRes] = await Promise.all([
        apiClient.get<StoryTemplate>(`/api/templates/${templateId}`),
        apiClient.get<{ characters: CharacterResponse[] }>('/api/characters'),
      ]);
      setTemplate(tplRes);
      setCharacters(charRes.characters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleAssign(role: string, characterId: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      if (characterId) {
        next[role] = characterId;
      } else {
        delete next[role];
      }
      return next;
    });
  }

  const requiredRoles = template?.roles.filter((r) => r.required) ?? [];
  const allRequiredAssigned = requiredRoles.every((r) => assignments[r.role]);

  function handleStart() {
    if (!templateId) return;
    navigate('/generating-multi', {
      state: { templateId, characterAssignments: assignments },
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'テンプレートが見つかりません'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={`${template.title} — ロール割り当て`} />
      <main className="mx-auto max-w-2xl px-6 py-8">
        {characters.length === 0 && (
          <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
            キャラクターが登録されていません。
            <button onClick={() => navigate('/characters/new')} className="ml-1 font-medium underline">
              新規登録
            </button>
          </div>
        )}

        <RoleAssignmentPanel
          roles={template.roles}
          characters={characters}
          assignments={assignments}
          onChange={handleAssign}
        />

        <button
          onClick={handleStart}
          disabled={!allRequiredAssigned}
          className="mt-6 w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          生成開始
        </button>
      </main>
    </div>
  );
}

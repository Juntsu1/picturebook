import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ProgressEvent } from '@picture-book/shared';
import { ProgressBar } from '../components/ProgressBar';
import { getToken } from '../api/client';
import { AppHeader } from '../components/AppHeader';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

interface GeneratingState {
  status: 'connecting' | 'story' | 'character_sheets' | 'illustration' | 'complete' | 'error';
  title?: string;
  currentPage: number;
  totalPages: number;
  errorMessage?: string;
  retryable: boolean;
}

const INITIAL_STATE: GeneratingState = {
  status: 'connecting',
  currentPage: 0,
  totalPages: 0,
  retryable: false,
};

export function MultiGeneratingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { templateId, characterAssignments } = (location.state ?? {}) as {
    templateId?: string;
    characterAssignments?: Record<string, string>;
  };

  const [state, setState] = useState<GeneratingState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const requestIdRef = useRef<string>(crypto.randomUUID());

  const startGeneration = useCallback(async () => {
    if (!templateId || !characterAssignments) return;
    if (startedRef.current) return;
    startedRef.current = true;

    setState(INITIAL_STATE);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const token = getToken();

    try {
      const res = await fetch(`${API_URL}/api/books/generate-multi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          templateId,
          characterAssignments,
          requestId: requestIdRef.current,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setState((s) => ({
          ...s,
          status: 'error',
          errorMessage: `サーバーエラー (${res.status})`,
          retryable: true,
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as ProgressEvent;
            handleEvent(event, setState, navigate);
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setState((s) => ({
        ...s,
        status: 'error',
        errorMessage: 'ネットワークエラーが発生しました',
        retryable: true,
      }));
    }
  }, [templateId, characterAssignments, navigate]);

  useEffect(() => {
    if (!templateId || !characterAssignments) {
      navigate('/', { replace: true });
      return;
    }
    startGeneration();
    return () => {
      abortRef.current?.abort();
      startedRef.current = false;
    };
  }, [templateId, characterAssignments, navigate, startGeneration]);

  const percent = computePercent(state);
  const label = computeLabel(state);

  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="エラー" />
        <div className="flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow">
          <p className="mb-2 text-4xl">⚠️</p>
          <h1 className="mb-2 text-xl font-bold text-gray-800">エラーが発生しました</h1>
          <p className="mb-6 text-sm text-gray-600">{state.errorMessage}</p>
          {state.retryable && (
            <button
              type="button"
              onClick={() => {
                requestIdRef.current = crypto.randomUUID();
                startedRef.current = false;
                startGeneration();
              }}
              className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              再試行
            </button>
          )}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="絵本を生成中" />
      <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <ProgressBar percent={percent} label={label} />
      </div>
      </div>
    </div>
  );
}

function handleEvent(
  event: ProgressEvent,
  setState: React.Dispatch<React.SetStateAction<GeneratingState>>,
  navigate: ReturnType<typeof useNavigate>,
) {
  switch (event.type) {
    case 'story_generating':
      setState((s) => ({ ...s, status: 'story' }));
      break;
    case 'story_complete':
      setState((s) => ({
        ...s,
        status: 'illustration',
        title: event.title,
        totalPages: event.pageCount,
        currentPage: 0,
      }));
      break;
    case 'character_sheets_checking':
      setState((s) => ({ ...s, status: 'character_sheets' }));
      break;
    case 'illustration_generating':
      setState((s) => ({
        ...s,
        status: 'illustration',
        currentPage: event.pageNumber,
        totalPages: event.totalPages,
      }));
      break;
    case 'illustration_complete':
      // currentPage は illustration_generating で更新済みのため変更不要
      break;
    case 'complete':
      setState((s) => ({ ...s, status: 'complete' }));
      navigate(`/books/${event.bookId}`, { replace: true });
      break;
    case 'error':
      setState((s) => ({
        ...s,
        status: 'error',
        errorMessage: event.message,
        retryable: event.retryable,
      }));
      break;
  }
}

function computePercent(state: GeneratingState): number {
  if (state.status === 'connecting' || state.status === 'story') return 10;
  if (state.status === 'character_sheets') return 15;
  if (state.status === 'illustration' && state.totalPages > 0) {
    return 20 + Math.round((state.currentPage / state.totalPages) * 80);
  }
  if (state.status === 'complete') return 100;
  return 0;
}

function computeLabel(state: GeneratingState): string {
  switch (state.status) {
    case 'connecting':
      return '接続中...';
    case 'story':
      return 'ストーリーを生成中...';
    case 'character_sheets':
      return 'キャラクターシートを確認中...';
    case 'illustration':
      if (state.totalPages > 0) {
        return `イラストを生成中... (${state.currentPage}/${state.totalPages})`;
      }
      return 'イラストを生成中...';
    case 'complete':
      return '生成完了！';
    default:
      return '';
  }
}

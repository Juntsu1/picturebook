import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ChatMessage, StoryDraft, ChatSSEEvent } from '@picture-book/shared';
import { apiClient, getToken } from '../api/client';
import { ChatMessageList } from '../components/ChatMessageList';
import { ChatInput } from '../components/ChatInput';
import { DraftPreview } from '../components/DraftPreview';
import { AppHeader } from '../components/AppHeader';
import { useInterviewFlow } from '../hooks/useInterviewFlow';
import { formatAnswersAsText } from '../utils/formatAnswers';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function ChatStoryPage() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [sessionId, setSessionId] = useState<string | null>(urlSessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<StoryDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [error, setError] = useState('');

  const {
    state: interviewState,
    getCurrentMessage,
    submitAnswer,
    proceedToAdvanced,
    skipToComplete,
  } = useInterviewFlow();

  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const interviewCompleteSentRef = useRef(false);

  function addAssistantMessage(content: string) {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content, timestamp: new Date().toISOString() },
    ]);
  }

  const createSession = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const res = await apiClient.post<{ sessionId: string }>('/api/chat-stories/sessions');
      setSessionId(res.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'セッション作成に失敗しました');
    }
  }, []);

  useEffect(() => {
    if (sessionId && messages.length === 0 && !urlSessionId) {
      addAssistantMessage(getCurrentMessage());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId && !urlSessionId) {
      createSession();
    } else if (urlSessionId) {
      (async () => {
        try {
          const res = await apiClient.get<{ messages: ChatMessage[]; draft: StoryDraft | null }>(
            `/api/chat-stories/sessions/${urlSessionId}`
          );
          setMessages(res.messages);
          setDraft(res.draft);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'セッションの取得に失敗しました');
        }
      })();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId, urlSessionId, createSession]);

  async function sendToBackend(message: string) {
    if (!sessionId) return;
    setSending(true);
    setError('');

    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = getToken();
      const url = `${API_URL}/api/chat-stories/sessions/${sessionId}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(`サーバーエラー (${res.status})`);
        setSending(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', timestamp: new Date().toISOString() },
      ]);

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
            const event = JSON.parse(json) as ChatSSEEvent;
            if (event.type === 'chunk') {
              assistantContent += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: assistantContent,
                };
                return updated;
              });
            } else if (event.type === 'error' || event.type === 'content_filtered') {
              setError(event.message);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setError('ネットワークエラーが発生しました');
    } finally {
      setSending(false);
    }
  }

  async function handleSend(message: string) {
    if (!message.trim()) return;

    if (interviewState.phase !== 'complete') {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: message, timestamp: new Date().toISOString() },
      ]);

      if (message === 'こだわり設定をする') {
        addAssistantMessage(proceedToAdvanced());
        return;
      }
      if (message === 'スキップしてストーリーを作る') {
        skipToComplete();
        return;
      }

      const { nextMessage } = submitAnswer(message);
      if (nextMessage !== null) {
        addAssistantMessage(nextMessage);
      }
      return;
    }

    await sendToBackend(message);
  }

  useEffect(() => {
    if (interviewState.phase === 'complete' && sessionId && !interviewCompleteSentRef.current) {
      interviewCompleteSentRef.current = true;
      sendToBackend(formatAnswersAsText(interviewState.answers));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewState.phase]);

  async function handleGenerateDraft() {
    if (!sessionId) return;
    setDraftLoading(true);
    setError('');
    try {
      const res = await apiClient.post<{ draft: StoryDraft }>(
        `/api/chat-stories/sessions/${sessionId}/draft`
      );
      setDraft(res.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ドラフト生成に失敗しました');
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleApproveDraft() {
    if (!sessionId) return;
    try {
      const res = await apiClient.post<{ templateId: string }>(
        `/api/chat-stories/sessions/${sessionId}/save`
      );
      navigate(`/templates/${res.templateId}/assign`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AppHeader title="AIと一緒にストーリーを作る" />
      {error && (
        <div role="alert" className="mx-6 mt-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">
        {draft ? (
          <div className="flex-1 overflow-y-auto p-6">
            <DraftPreview draft={draft} onApprove={handleApproveDraft} onEdit={() => setDraft(null)} />
          </div>
        ) : (
          <>
            <ChatMessageList messages={messages} onChoiceSelect={handleSend} disabled={sending} />
            <div className="px-4 py-2">
              <button
                onClick={handleGenerateDraft}
                disabled={draftLoading || sending || interviewState.phase !== 'complete'}
                className="w-full rounded border border-green-600 px-4 py-2 text-sm font-medium text-green-600 hover:bg-green-50 disabled:opacity-50"
              >
                {draftLoading ? '生成中...' : 'ストーリーを完成させる'}
              </button>
            </div>
            <ChatInput onSend={handleSend} disabled={sending || !sessionId} />
          </>
        )}
      </div>
    </div>
  );
}
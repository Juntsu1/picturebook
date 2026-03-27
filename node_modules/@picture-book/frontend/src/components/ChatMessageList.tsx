import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@picture-book/shared';

interface ChatMessageListProps {
  messages: ChatMessage[];
  onChoiceSelect?: (choice: string) => void;
  disabled?: boolean;
}

interface ParsedMessage {
  text: string;
  choices: string[];
  multiSelect: boolean;
}

/** [CHOICES: A|B|C] または [MULTI_CHOICES: A|B|C] をメッセージ末尾から抽出してパースする */
function parseChoices(content: string): ParsedMessage {
  const multiMatch = content.match(/\[MULTI_CHOICES:\s*([^\]]+)\]\s*$/);
  if (multiMatch) {
    const choices = multiMatch[1].split('|').map((s) => s.trim()).filter(Boolean);
    const text = content.slice(0, multiMatch.index).trimEnd();
    return { text, choices, multiSelect: true };
  }
  const singleMatch = content.match(/\[CHOICES:\s*([^\]]+)\]\s*$/);
  if (singleMatch) {
    const choices = singleMatch[1].split('|').map((s) => s.trim()).filter(Boolean);
    const text = content.slice(0, singleMatch.index).trimEnd();
    return { text, choices, multiSelect: false };
  }
  return { text: content, choices: [], multiSelect: false };
}

interface MultiSelectButtonsProps {
  choices: string[];
  onConfirm: (selected: string) => void;
  disabled?: boolean;
}

function MultiSelectButtons({ choices, onConfirm, disabled }: MultiSelectButtonsProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(choice: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(choice)) next.delete(choice);
      else next.add(choice);
      return next;
    });
  }

  function handleConfirm() {
    if (selected.size === 0) return;
    onConfirm([...selected].join('、'));
  }

  return (
    <div className="mt-2 max-w-[75%]">
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice}
            onClick={() => toggle(choice)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
              selected.has(choice)
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-blue-500 bg-white text-blue-600 hover:bg-blue-50'
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
      <button
        onClick={handleConfirm}
        disabled={disabled || selected.size === 0}
        className="mt-2 rounded border border-blue-600 bg-blue-600 px-4 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        決定する
      </button>
    </div>
  );
}

export function ChatMessageList({ messages, onChoiceSelect, disabled }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 最後のassistantメッセージのインデックス（選択肢ボタンはそこだけ表示）
  const lastAssistantIdx = messages.reduce<number>(
    (acc, m, i) => (m.role === 'assistant' ? i : acc),
    -1
  );

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {messages
        .filter((m) => m.role !== 'system')
        .map((m, i) => {
          const isLastAssistant = m.role === 'assistant' && i === lastAssistantIdx;
          const { text, choices, multiSelect } =
            m.role === 'assistant'
              ? parseChoices(m.content)
              : { text: m.content, choices: [], multiSelect: false };

          return (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-800'
                }`}
              >
                {text}
              </div>

              {isLastAssistant && choices.length > 0 && (
                multiSelect ? (
                  <MultiSelectButtons
                    choices={choices}
                    onConfirm={(val) => onChoiceSelect?.(val)}
                    disabled={disabled}
                  />
                ) : (
                  <div className="mt-2 flex max-w-[75%] flex-wrap gap-2">
                    {choices.map((choice) => (
                      <button
                        key={choice}
                        onClick={() => onChoiceSelect?.(choice)}
                        disabled={disabled}
                        className="rounded-full border border-blue-500 bg-white px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          );
        })}
      <div ref={bottomRef} />
    </div>
  );
}

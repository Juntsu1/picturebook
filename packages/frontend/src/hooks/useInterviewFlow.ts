import { useState, useCallback } from 'react';
import {
  BASIC_QUESTIONS,
  ADVANCED_QUESTIONS,
  PHASE_TRANSITION_CHOICES,
} from '../constants/interviewQuestions';

export type InterviewPhase = 'basic' | 'advanced' | 'complete';

export interface InterviewState {
  phase: InterviewPhase;
  currentIndex: number;
  answers: Record<string, string>;
}

export interface UseInterviewFlowReturn {
  state: InterviewState;
  getCurrentMessage: () => string;
  submitAnswer: (answer: string) => { nextMessage: string | null };
  proceedToAdvanced: () => string;
  skipToComplete: () => void;
}

function buildChoicesSuffix(choices: string[], multiSelect?: boolean): string {
  if (choices.length === 0) return '';
  const tag = multiSelect ? 'MULTI_CHOICES' : 'CHOICES';
  return ` [${tag}: ${choices.join('|')}]`;
}

function buildQuestionMessage(phase: 'basic' | 'advanced', index: number): string {
  const questions = phase === 'basic' ? BASIC_QUESTIONS : ADVANCED_QUESTIONS;
  const q = questions[index];
  return q.text + buildChoicesSuffix(q.choices, q.multiSelect);
}

const INITIAL_STATE: InterviewState = {
  phase: 'basic',
  currentIndex: 0,
  answers: {},
};

export function useInterviewFlow(): UseInterviewFlowReturn {
  const [state, setState] = useState<InterviewState>(INITIAL_STATE);

  const getCurrentMessage = useCallback((): string => {
    if (state.phase === 'complete') return '';
    return buildQuestionMessage(state.phase, state.currentIndex);
  }, [state.phase, state.currentIndex]);

  const submitAnswer = useCallback(
    (answer: string): { nextMessage: string | null } => {
      if (!answer.trim()) return { nextMessage: null };

      // state を直接参照して nextMessage を計算（setState コールバック外で確定させる）
      // NOTE: この関数は state が stale にならないよう state を依存に含めている
      setState((prev) => {
        if (prev.phase === 'complete') return prev;
        const questions = prev.phase === 'basic' ? BASIC_QUESTIONS : ADVANCED_QUESTIONS;
        const currentQuestion = questions[prev.currentIndex];
        const updatedAnswers = { ...prev.answers, [currentQuestion.key]: answer };
        const isLast = prev.currentIndex === questions.length - 1;

        if (prev.phase === 'basic' && isLast) {
          return { ...prev, answers: updatedAnswers, currentIndex: prev.currentIndex + 1 };
        }
        if (prev.phase === 'advanced' && isLast) {
          return { ...prev, phase: 'complete', answers: updatedAnswers };
        }
        return { ...prev, currentIndex: prev.currentIndex + 1, answers: updatedAnswers };
      });

      // nextMessage を state に依存せず計算（呼び出し時点の state を使う）
      if (state.phase === 'complete') return { nextMessage: null };

      const questions = state.phase === 'basic' ? BASIC_QUESTIONS : ADVANCED_QUESTIONS;
      const isLast = state.currentIndex === questions.length - 1;

      if (state.phase === 'basic' && isLast) {
        return {
          nextMessage: `基本的な設定が決まりました！\nこだわり設定もしますか？ [CHOICES: ${PHASE_TRANSITION_CHOICES}]`,
        };
      }
      if (state.phase === 'advanced' && isLast) {
        return { nextMessage: null };
      }
      return { nextMessage: buildQuestionMessage(state.phase, state.currentIndex + 1) };
    },
    [state]
  );

  const proceedToAdvanced = useCallback((): string => {
    const firstMsg = buildQuestionMessage('advanced', 0);
    setState((prev) => ({ ...prev, phase: 'advanced', currentIndex: 0 }));
    return firstMsg;
  }, []);

  const skipToComplete = useCallback((): void => {
    setState((prev) => ({ ...prev, phase: 'complete' }));
  }, []);

  return { state, getCurrentMessage, submitAnswer, proceedToAdvanced, skipToComplete };
}

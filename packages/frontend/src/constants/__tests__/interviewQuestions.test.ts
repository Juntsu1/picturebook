import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  BASIC_QUESTIONS,
  ADVANCED_QUESTIONS,
  PHASE_TRANSITION_CHOICES,
  type InterviewQuestion,
} from '../interviewQuestions';

// Unit tests

describe('BASIC_QUESTIONS', () => {
  it('10問であること', () => {
    expect(BASIC_QUESTIONS).toHaveLength(10);
  });

  it('各質問が key・text・choices を持つこと', () => {
    for (const q of BASIC_QUESTIONS) {
      expect(typeof q.key).toBe('string');
      expect(q.key.length).toBeGreaterThan(0);
      expect(typeof q.text).toBe('string');
      expect(q.text.length).toBeGreaterThan(0);
      expect(Array.isArray(q.choices)).toBe(true);
    }
  });

  it('multiSelect: true を持つ質問がないこと', () => {
    const multiSelectQuestions = BASIC_QUESTIONS.filter((q) => q.multiSelect === true);
    expect(multiSelectQuestions).toHaveLength(0);
  });

  it('質問の key が期待通りの順序であること', () => {
    const keys = BASIC_QUESTIONS.map((q) => q.key);
    expect(keys).toEqual([
      'targetAge',
      'readingStyle',
      'length',
      'protagonist',
      'personality',
      'setting',
      'theme',
      'wish',
      'obstacle',
      'ending',
    ]);
  });
});

describe('ADVANCED_QUESTIONS', () => {
  it('14問であること', () => {
    expect(ADVANCED_QUESTIONS).toHaveLength(14);
  });

  it('各質問が key・text・choices を持つこと', () => {
    for (const q of ADVANCED_QUESTIONS) {
      expect(typeof q.key).toBe('string');
      expect(q.key.length).toBeGreaterThan(0);
      expect(typeof q.text).toBe('string');
      expect(q.text.length).toBeGreaterThan(0);
      expect(Array.isArray(q.choices)).toBe(true);
    }
  });

  it('multiSelect: true を持つ質問が motifs と avoidElements のみであること', () => {
    const multiSelectKeys = ADVANCED_QUESTIONS.filter((q) => q.multiSelect === true).map((q) => q.key);
    expect(multiSelectKeys).toEqual(['motifs', 'avoidElements']);
  });

  it('質問の key が期待通りの順序であること', () => {
    const keys = ADVANCED_QUESTIONS.map((q) => q.key);
    expect(keys).toEqual([
      'characterCount',
      'atmosphere',
      'realism',
      'storyPattern',
      'dialogueAmount',
      'repetition',
      'onomatopoeia',
      'motifs',
      'avoidElements',
      'season',
      'timeOfDay',
      'learningElement',
      'protagonistName',
      'languageLevel',
    ]);
  });
});

describe('PHASE_TRANSITION_CHOICES', () => {
  it('パイプ区切りで2つの選択肢を持つこと', () => {
    const parts = PHASE_TRANSITION_CHOICES.split('|');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('こだわり設定をする');
    expect(parts[1]).toBe('スキップしてストーリーを作る');
  });
});

// Property-based tests

describe('Property 1: 全質問が必須フィールドを持つ', () => {
  /**
   * Validates: Requirements 1.3
   */
  const allQuestions: InterviewQuestion[] = [...BASIC_QUESTIONS, ...ADVANCED_QUESTIONS];

  it('任意の質問オブジェクトが非空の key・text と配列の choices を持つ', () => {
    fc.assert(
      fc.property(fc.constantFrom(...allQuestions), (question) => {
        expect(typeof question.key).toBe('string');
        expect(question.key.length).toBeGreaterThan(0);
        expect(typeof question.text).toBe('string');
        expect(question.text.length).toBeGreaterThan(0);
        expect(Array.isArray(question.choices)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

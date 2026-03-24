import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatAnswersAsText } from '../formatAnswers';

describe('formatAnswersAsText', () => {
  it('空の answers でデフォルトメッセージを返す', () => {
    const result = formatAnswersAsText({});
    expect(result).toBe('【絵本の要件】\n（まだ回答がありません）');
  });

  it('回答が【絵本の要件】ヘッダーを含む', () => {
    const result = formatAnswersAsText({ targetAge: '3〜4歳' });
    expect(result).toContain('【絵本の要件】');
  });

  it('targetAge が「対象年齢」に変換される', () => {
    const result = formatAnswersAsText({ targetAge: '3〜4歳' });
    expect(result).toContain('- 対象年齢: 3〜4歳');
  });

  it('複数の既知キーが日本語ラベルに変換される', () => {
    const result = formatAnswersAsText({
      readingStyle: '読み聞かせ中心',
      length: '短め（6〜8見開き）',
      protagonist: 'うさぎ',
    });
    expect(result).toContain('- 読み方: 読み聞かせ中心');
    expect(result).toContain('- 長さ: 短め（6〜8見開き）');
    expect(result).toContain('- 主人公: うさぎ');
  });

  it('マッピングにないキーはそのままキー名を使う', () => {
    const result = formatAnswersAsText({ unknownKey: 'someValue' });
    expect(result).toContain('- unknownKey: someValue');
  });

  it('末尾に「以上の要件でストーリーを作ってください。」を含む', () => {
    const result = formatAnswersAsText({ targetAge: '3〜4歳' });
    expect(result).toContain('以上の要件でストーリーを作ってください。');
  });

  /**
   * Property 5: formatAnswers が全回答キーを含むテキストを返す
   * Validates: Requirements 7.2
   */
  it('Property 5: 全回答の値がテキストに含まれる', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          { minKeys: 1 }
        ),
        (answers) => {
          const result = formatAnswersAsText(answers);
          return Object.values(answers).every((value) => result.includes(value));
        }
      ),
      { numRuns: 100 }
    );
  });
});

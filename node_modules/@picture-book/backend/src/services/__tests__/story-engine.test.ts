import { describe, it, expect } from 'vitest';
import { buildPrompt, parseStoryResponse, getAgeGroup } from '../story-engine.js';
import type { ChildProfile } from '../story-engine.js';
import type { Theme } from '@picture-book/shared';

describe('StoryEngine', () => {
  describe('getAgeGroup', () => {
    it('returns correct group for toddlers (0-3)', () => {
      const group = getAgeGroup(2);
      expect(group.label).toBe('0-3歳');
      expect(group.pageCount).toBe(8);
      expect(group.maxSentenceLength).toBe(15);
    });

    it('returns correct group for preschool (4-6)', () => {
      const group = getAgeGroup(5);
      expect(group.label).toBe('4-6歳');
      expect(group.pageCount).toBe(10);
    });

    it('returns correct group for early elementary (7-9)', () => {
      const group = getAgeGroup(8);
      expect(group.label).toBe('7-9歳');
      expect(group.pageCount).toBe(12);
    });

    it('returns correct group for older children (10+)', () => {
      const group = getAgeGroup(12);
      expect(group.label).toBe('10歳以上');
      expect(group.pageCount).toBe(16);
    });
  });

  describe('buildPrompt', () => {
    const baseProfile: ChildProfile = {
      name: 'たろう',
      age: 5,
    };

    it('includes child name in prompt', () => {
      const prompt = buildPrompt(baseProfile, 'adventure');
      expect(prompt).toContain('たろう');
    });

    it('includes theme label in prompt', () => {
      const prompt = buildPrompt(baseProfile, 'space');
      expect(prompt).toContain('宇宙');
    });

    it('includes optional profile fields when provided', () => {
      const profile: ChildProfile = {
        ...baseProfile,
        gender: '男の子',
        favoriteColor: '青',
        favoriteAnimal: '犬',
        appearance: '茶色い髪',
      };
      const prompt = buildPrompt(profile, 'animals');
      expect(prompt).toContain('男の子');
      expect(prompt).toContain('青');
      expect(prompt).toContain('犬');
      expect(prompt).toContain('茶色い髪');
    });

    it('excludes null optional fields', () => {
      const profile: ChildProfile = {
        name: 'はなこ',
        age: 3,
        gender: null,
        favoriteColor: null,
      };
      const prompt = buildPrompt(profile, 'magic');
      expect(prompt).not.toContain('性別');
      expect(prompt).not.toContain('好きな色');
    });

    it('includes safety constraints', () => {
      const prompt = buildPrompt(baseProfile, 'adventure');
      expect(prompt).toContain('暴力的');
      expect(prompt).toContain('性的');
      expect(prompt).toContain('恐怖');
    });
  });

  describe('parseStoryResponse', () => {
    it('parses valid JSON response', () => {
      const json = JSON.stringify({
        title: 'たろうの冒険',
        pages: Array.from({ length: 8 }, (_, i) => ({
          pageNumber: i + 1,
          text: `ページ${i + 1}のテキスト`,
        })),
      });

      const result = parseStoryResponse(json);
      expect(result.title).toBe('たろうの冒険');
      expect(result.pages).toHaveLength(8);
      expect(result.pages[0].pageNumber).toBe(1);
    });

    it('parses JSON wrapped in markdown code block', () => {
      const json = '```json\n' + JSON.stringify({
        title: 'テスト',
        pages: Array.from({ length: 10 }, (_, i) => ({
          pageNumber: i + 1,
          text: `テキスト${i + 1}`,
        })),
      }) + '\n```';

      const result = parseStoryResponse(json);
      expect(result.title).toBe('テスト');
      expect(result.pages).toHaveLength(10);
    });

    it('throws on missing title', () => {
      const json = JSON.stringify({ pages: [{ pageNumber: 1, text: 'test' }] });
      expect(() => parseStoryResponse(json)).toThrow('タイトル');
    });

    it('throws on empty pages', () => {
      const json = JSON.stringify({ title: 'test', pages: [] });
      expect(() => parseStoryResponse(json)).toThrow('ページ');
    });

    it('throws when page count is below 1', () => {
      const json = JSON.stringify({
        title: 'test',
        pages: [],
      });
      expect(() => parseStoryResponse(json)).toThrow('ページ');
    });

    it('throws when page count exceeds 16', () => {
      const json = JSON.stringify({
        title: 'test',
        pages: Array.from({ length: 20 }, (_, i) => ({
          pageNumber: i + 1,
          text: `text${i + 1}`,
        })),
      });
      expect(() => parseStoryResponse(json)).toThrow('範囲外');
    });

    it('accepts exactly 8 pages', () => {
      const json = JSON.stringify({
        title: 'test',
        pages: Array.from({ length: 8 }, (_, i) => ({
          pageNumber: i + 1,
          text: `text${i + 1}`,
        })),
      });
      const result = parseStoryResponse(json);
      expect(result.pages).toHaveLength(8);
    });

    it('accepts exactly 16 pages', () => {
      const json = JSON.stringify({
        title: 'test',
        pages: Array.from({ length: 16 }, (_, i) => ({
          pageNumber: i + 1,
          text: `text${i + 1}`,
        })),
      });
      const result = parseStoryResponse(json);
      expect(result.pages).toHaveLength(16);
    });
  });
});

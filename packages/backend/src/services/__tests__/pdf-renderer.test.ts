import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderPdf, renderPdfWithRetry } from '../pdf-renderer.js';
import type { BookData } from '@picture-book/shared';

// Use ASCII text for tests since StandardFonts.Helvetica doesn't support Japanese
function makeBookData(pageCount: number): BookData {
  return {
    id: 'book-1',
    title: 'Test Book',
    theme: 'adventure',
    pages: Array.from({ length: pageCount }, (_, i) => ({
      pageNumber: i + 1,
      text: `Page ${i + 1} text. Once upon a time in a land far away.`,
      originalText: `Page ${i + 1} text. Once upon a time in a land far away.`,
      imageUrl: `https://example.com/page-${i + 1}.png`,
    })),
    profile: { name: 'Taro', age: 5 },
  };
}

// Create a minimal valid PNG (1x1 pixel, white)
function createMinimalPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe('pdf-renderer', () => {
  describe('renderPdf', () => {
    it('generates a valid PDF binary', async () => {
      const book = makeBookData(3);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      const buffer = await renderPdf(book, { fetchImage: mockFetch });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      const header = buffer.subarray(0, 5).toString('ascii');
      expect(header).toBe('%PDF-');
    });

    it('page count equals title page + content pages', async () => {
      const pageCount = 5;
      const book = makeBookData(pageCount);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      const buffer = await renderPdf(book, { fetchImage: mockFetch });
      const pdfDoc = await PDFDocument.load(buffer);

      expect(pdfDoc.getPageCount()).toBe(pageCount + 1);
    });

    it('generates PDF even when image fetch fails', async () => {
      const book = makeBookData(2);
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const buffer = await renderPdf(book, { fetchImage: mockFetch });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      const pdfDoc = await PDFDocument.load(buffer);
      expect(pdfDoc.getPageCount()).toBe(3); // title + 2 content pages
    });

    it('generates only title page when there are no content pages', async () => {
      const book = makeBookData(0);
      const mockFetch = vi.fn();

      const buffer = await renderPdf(book, { fetchImage: mockFetch });
      const pdfDoc = await PDFDocument.load(buffer);

      expect(pdfDoc.getPageCount()).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls fetchImage for each page imageUrl', async () => {
      const book = makeBookData(3);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      await renderPdf(book, { fetchImage: mockFetch });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/page-1.png');
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/page-2.png');
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/page-3.png');
    });

    it('skips image fetch when imageUrl is empty', async () => {
      const book: BookData = {
        id: 'book-1',
        title: 'Test',
        theme: 'adventure',
        pages: [{ pageNumber: 1, text: 'Test text', originalText: 'Test text', imageUrl: '' }],
        profile: { name: 'Taro', age: 5 },
      };
      const mockFetch = vi.fn();

      const buffer = await renderPdf(book, { fetchImage: mockFetch });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('all pages use A4 dimensions', async () => {
      const book = makeBookData(2);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      const buffer = await renderPdf(book, { fetchImage: mockFetch });
      const pdfDoc = await PDFDocument.load(buffer);

      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const page = pdfDoc.getPage(i);
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 0);
        expect(height).toBeCloseTo(841.89, 0);
      }
    });
  });

  describe('renderPdfWithRetry', () => {
    it('succeeds on first attempt without retry', async () => {
      const book = makeBookData(1);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      const buffer = await renderPdfWithRetry(book, { fetchImage: mockFetch });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('returns valid PDF through retry mechanism', async () => {
      const book = makeBookData(1);
      const mockFetch = vi.fn().mockResolvedValue(createMinimalPng());

      const buffer = await renderPdfWithRetry(book, { fetchImage: mockFetch });
      const header = buffer.subarray(0, 5).toString('ascii');
      expect(header).toBe('%PDF-');
    });
  });
});

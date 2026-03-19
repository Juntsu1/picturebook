import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { BookData, PageData } from '@picture-book/shared';

// A4 dimensions in points (72 points per inch)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const MAX_RETRIES = 2;

export interface PDFRendererOptions {
  fetchImage?: (url: string) => Promise<Uint8Array>;
  fontBytes?: Uint8Array;
}

async function defaultFetchImage(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from ${url}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxCharsPerLine) {
      lines.push(remaining);
      break;
    }

    let breakAt = maxCharsPerLine;
    const jpBreak = remaining.lastIndexOf('。', maxCharsPerLine);
    const jpComma = remaining.lastIndexOf('、', maxCharsPerLine);
    const spaceIdx = remaining.lastIndexOf(' ', maxCharsPerLine);

    if (jpBreak > 0 && jpBreak < maxCharsPerLine) {
      breakAt = jpBreak + 1;
    } else if (jpComma > 0 && jpComma < maxCharsPerLine) {
      breakAt = jpComma + 1;
    } else if (spaceIdx > 0) {
      breakAt = spaceIdx + 1;
    }

    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }

  return lines;
}

async function embedImage(pdfDoc: PDFDocument, imageBytes: Uint8Array) {
  try {
    return await pdfDoc.embedPng(imageBytes);
  } catch {
    return await pdfDoc.embedJpg(imageBytes);
  }
}

async function getFont(pdfDoc: PDFDocument, fontBytes?: Uint8Array): Promise<PDFFont> {
  if (fontBytes) {
    pdfDoc.registerFontkit(fontkit);
    return pdfDoc.embedFont(fontBytes);
  }
  return pdfDoc.embedFont(StandardFonts.Helvetica);
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  y: number,
  fontSize: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>
): void {
  let textWidth: number;
  try {
    textWidth = font.widthOfTextAtSize(text, fontSize);
  } catch {
    // If font can't measure the text, estimate width
    textWidth = text.length * fontSize * 0.5;
  }
  const x = (A4_WIDTH - textWidth) / 2;
  try {
    page.drawText(text, { x, y, size: fontSize, font, color });
  } catch {
    // Skip text that can't be encoded by the current font
  }
}

async function renderTitlePage(
  pdfDoc: PDFDocument,
  book: BookData,
  font: PDFFont
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  drawCenteredText(page, book.title, A4_HEIGHT / 2 + 40, 28, font, rgb(0.2, 0.2, 0.2));

  const subtitle = `${book.profile.name} のおはなし`;
  drawCenteredText(page, subtitle, A4_HEIGHT / 2 - 20, 18, font, rgb(0.4, 0.4, 0.4));
}

async function renderContentPage(
  pdfDoc: PDFDocument,
  pageData: PageData,
  font: PDFFont,
  imageBytes: Uint8Array | null
): Promise<void> {
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  const imageAreaTop = A4_HEIGHT - MARGIN;
  const imageAreaHeight = (A4_HEIGHT - MARGIN * 3) * 0.6;

  if (imageBytes) {
    try {
      const image = await embedImage(pdfDoc, imageBytes);
      const imgDims = image.scale(1);
      const scaleX = CONTENT_WIDTH / imgDims.width;
      const scaleY = imageAreaHeight / imgDims.height;
      const scale = Math.min(scaleX, scaleY);
      const scaledWidth = imgDims.width * scale;
      const scaledHeight = imgDims.height * scale;
      const imgX = MARGIN + (CONTENT_WIDTH - scaledWidth) / 2;
      const imgY = imageAreaTop - scaledHeight;

      page.drawImage(image, { x: imgX, y: imgY, width: scaledWidth, height: scaledHeight });
    } catch {
      page.drawRectangle({
        x: MARGIN,
        y: imageAreaTop - imageAreaHeight,
        width: CONTENT_WIDTH,
        height: imageAreaHeight,
        color: rgb(0.95, 0.95, 0.95),
      });
    }
  }

  // Lower portion: text
  const textAreaTop = imageAreaTop - imageAreaHeight - MARGIN;
  const fontSize = 14;
  const lineHeight = fontSize * 1.6;
  const maxCharsPerLine = Math.floor(CONTENT_WIDTH / (fontSize * 0.6));

  const lines = wrapText(pageData.text, maxCharsPerLine);
  let y = textAreaTop;

  for (const line of lines) {
    if (y < MARGIN) break;
    try {
      page.drawText(line, { x: MARGIN, y, size: fontSize, font, color: rgb(0.15, 0.15, 0.15) });
    } catch {
      // Skip lines that can't be encoded
    }
    y -= lineHeight;
  }

  // Page number
  const pageNumText = `${pageData.pageNumber}`;
  drawCenteredText(page, pageNumText, MARGIN / 2, 10, font, rgb(0.6, 0.6, 0.6));
}

export async function renderPdf(
  book: BookData,
  options?: PDFRendererOptions
): Promise<Buffer> {
  const fetchImage = options?.fetchImage ?? defaultFetchImage;

  const pdfDoc = await PDFDocument.create();
  const font = await getFont(pdfDoc, options?.fontBytes);

  await renderTitlePage(pdfDoc, book, font);

  for (const pageData of book.pages) {
    let imageBytes: Uint8Array | null = null;
    if (pageData.imageUrl) {
      try {
        imageBytes = await fetchImage(pageData.imageUrl);
      } catch {
        // Continue without image if fetch fails
      }
    }
    await renderContentPage(pdfDoc, pageData, font, imageBytes);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

export async function renderPdfWithRetry(
  book: BookData,
  options?: PDFRendererOptions
): Promise<Buffer> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await renderPdf(book, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError!;
}

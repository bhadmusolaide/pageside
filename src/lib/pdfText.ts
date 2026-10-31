import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = '';

      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
        else if (!/\s$/.test(item.str)) pageText += ' ';
      }

      const cleaned = pageText
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (cleaned) pages.push(cleaned);
      page.cleanup();
    }

    const text = pages.join('\n\n').trim();
    if (!text) {
      throw new Error('This PDF has no selectable text. It may be a scanned image; paste the text manually or use OCR.');
    }
    return text;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    if (name === 'InvalidPDFException') {
      throw new Error('This file is not a valid PDF.');
    }
    throw err;
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      /* already destroyed */
    }
  }
}

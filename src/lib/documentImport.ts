const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return (await file.text()).trim();
  }

  if (name.endsWith('.docx')) {
    return extractDocx(await file.arrayBuffer());
  }

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdf(await file.arrayBuffer());
  }

  throw new Error('Unsupported file type. Use PDF, DOCX, TXT, or Markdown.');
}

/* ------------------------- DOCX ------------------------- */

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const xmlBytes = await readZipEntry(bytes, 'word/document.xml');
  if (!xmlBytes) {
    throw new Error('Could not find word/document.xml in this DOCX file.');
  }

  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) throw new Error('This DOCX file contains no readable text.');
  return text;
}

async function readZipEntry(bytes: Uint8Array, wantedName: string): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('This file is not a valid DOCX (ZIP) archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === wantedName) {
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
        throw new Error('Corrupt DOCX entry.');
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compression === 0) return compressed;
      if (compression === 8) return inflateRaw(compressed);
      throw new Error(`Unsupported DOCX compression method: ${compression}.`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= min; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------- PDF ------------------------- */

async function extractPdf(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const binary = latin1(bytes);
  const pieces: string[] = [];

  const streamRe = /stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = streamRe.exec(binary)) !== null) {
    const start = match.index + match[0].length;
    const end = binary.indexOf('endstream', start);
    if (end < 0) break;

    const dictionaryStart = Math.max(0, binary.lastIndexOf('<<', match.index));
    const dictionary = binary.slice(dictionaryStart, match.index);
    let streamBytes: Uint8Array | null = null;

    if (/\/FlateDecode/.test(dictionary)) {
      try {
        streamBytes = await inflateRaw(bytes.subarray(start, end));
      } catch {
        streamBytes = null;
      }
    } else if (!/\/Filter/.test(dictionary)) {
      streamBytes = bytes.subarray(start, end);
    }

    if (streamBytes) {
      pieces.push(...extractPdfText(latin1(streamBytes)));
    }
    streamRe.lastIndex = end + 'endstream'.length;
  }

  const text = pieces.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) {
    throw new Error('Could not extract text from this PDF. Scanned PDFs need OCR; paste the text manually instead.');
  }
  return text;
}

function extractPdfText(content: string): string[] {
  const out: string[] = [];
  const tjRe = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  const tjArrayRe = /\[((?:\((?:\\.|[^\\()])*\)|[^\]])*)\]\s*TJ/g;

  let match: RegExpExecArray | null;
  while ((match = tjRe.exec(content)) !== null) {
    const value = decodePdfString(match[0].replace(/\)\s*Tj$/, '').slice(1));
    if (value.trim()) out.push(value);
  }

  while ((match = tjArrayRe.exec(content)) !== null) {
    const strings = match[1].match(/\((?:\\.|[^\\()])*\)/g) ?? [];
    const line = strings.map(s => decodePdfString(s.slice(1, -1))).join('');
    if (line.trim()) out.push(line);
  }

  return out;
}

function decodePdfString(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_all, code: string) => {
    switch (code) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      case '(': return '(';
      case ')': return ')';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(code, 8));
    }
  });
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

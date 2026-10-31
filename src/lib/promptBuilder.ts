import type { VaultItem } from './vault';
import type { PageContext, DetectedField } from './fieldDetector';
import { retrieveByTfIdf, retrieveByEmbeddings, type RetrievalMode } from './retrieval';
import { clampContextBudget, estimateTokens } from './usage';

export function buildSystemPrompt(tone: string, maxLength: number, language: string, emphasis?: string): string {
  const langNote = language !== 'en' ? `\n- Write the answer in the language specified (language code: ${language}).` : '';
  const emphasisNote = emphasis?.trim() ? `\n- Additional requirements: ${emphasis.trim()}` : '';
  return [
    `You are helping a job applicant draft answers to application form questions.`,
    `The "Relevant background information" in the request is the applicant's OWN data (their resume, notes, portfolio, and writing samples). Treat it as the single source of truth about them.`,
    `Rules:`,
    `- Write in FIRST PERSON ("I", "my", "me") as the applicant.`,
    `- Ground every answer in the provided background information. Use the applicant's real roles, projects, skills, and accomplishments from that background.`,
    `- When the question asks about strengths, skills, or experience, DERIVE the answer from the roles, projects, and accomplishments found in the background information. Do not ask for more information when the background already supports an answer.`,
    `- Match the tone: "${tone}".`,
    `- Be concise. Aim for 2-4 sentences (roughly 40-90 words): state the point, give one concrete detail, stop. Go longer only when the question explicitly asks for detail, examples, or a longer statement, and never exceed the hard limit of ${maxLength} words.`,
    `- Use plain, direct language. Prefer concrete verbs: built, led, wrote, fixed, shipped, ran, taught, designed, improved, reduced.`,
    `- If the background includes writing samples (TONE_SAMPLE), mirror their vocabulary, sentence rhythm, and punctuation.`,
    `- Do NOT use corporate-speak or overused AI verbs/adjectives: leverage, utilize, delve, spearhead, foster, facilitate, streamline, optimize, drive, elevate, empower, navigate, showcase, underscore, harness, champion, orchestrate, unlock, unleash, passionate, dynamic, robust, seamless, holistic, synergistic, impactful, innovative, cutting-edge, results-driven, detail-oriented, go-getter, team player, thought leader.`,
    `- Do NOT use clichés or stock phrases: "in today's fast-paced world", "I'm excited to", "I'm thrilled", "aligns perfectly", "perfect fit", "not only ... but also", "it's not just X, it's Y", "at the end of the day", "I believe that", "delve into", "a testament to".`,
    `- Do NOT use em dashes (—) or en dashes (–). Use periods, commas, or parentheses instead.`,
    `- Avoid rhetorical questions, rule-of-three lists, and stacked adjectives. Do not start every sentence with "I".`,
    `- Do NOT use bold, headings, bullet points, or markdown. Write plain prose.`,
    `- Do NOT invent facts. Never state a specific claim (numbers, dates, names, companies, projects) unless it appears in the provided background information.`,
    `- Only output "NEEDS INPUT: <what is missing>" when the provided background information contains nothing that can answer the question. Never output it merely because the background does not restate the question verbatim, and never add commentary about missing information. Keep any NEEDS INPUT marker short, on its own line.`,
    `- Do NOT use placeholder text or brackets like [specific achievement], [X%], [Company Name], or similar. If exact data is unavailable, describe the type of work naturally without fabricating specifics.`,
    `- Do not repeat the question in your answer.`,
    `- Output only the answer text. No preamble like "Here is a draft".`,
    langNote,
    emphasisNote,
  ].filter(Boolean).join('\n');
}

export function buildUserPrompt(
  question: string,
  pageContext: PageContext,
  vaultContext: string,
  previousAnswer?: string,
  historyContext?: string
): string {
  const parts: string[] = [];

  if (pageContext.companyName || pageContext.jobTitle) {
    parts.push('Context:');
    if (pageContext.companyName) parts.push(`Company: ${pageContext.companyName}`);
    if (pageContext.jobTitle) parts.push(`Role: ${pageContext.jobTitle}`);
    parts.push('');
  }

  if (pageContext.jobDescription && pageContext.jobDescription.length > 50) {
    parts.push(`Job description:\n${pageContext.jobDescription.substring(0, 2500)}`);
    parts.push('');
  }

  parts.push(`Question: ${question}`);
  parts.push('');

  if (vaultContext) {
    parts.push('Relevant background information:');
    parts.push(vaultContext);
    parts.push('');
  }

  if (historyContext) {
    parts.push('Your previously accepted answers to similar questions (adapt them if useful, do not copy verbatim):');
    parts.push(historyContext);
    parts.push('');
  }

  if (previousAnswer) {
    parts.push(`Previous version of this answer (make the requested change):\n${previousAnswer}`);
    parts.push('');
  }

  parts.push('Draft an answer to the question using the relevant background information above.');

  return parts.join('\n');
}

function typePriority(type: VaultItem['type']): number {
  switch (type) {
    case 'resume': return 3;
    case 'note': return 2;
    case 'portfolio': return 2;
    default: return 1;
  }
}

export function selectRelevantVaultItems(
  question: string,
  vaultItems: VaultItem[],
  maxTokens: number = 6000,
  mode: RetrievalMode = 'keyword'
): { context: string; usedItems: VaultItem[] } {
  if (!Array.isArray(vaultItems) || vaultItems.length === 0) {
    return { context: '', usedItems: [] };
  }

  if (mode === 'tfidf') {
    const { context, usedItems } = retrieveByTfIdf(question, vaultItems, maxTokens);
    if (usedItems.length > 0) {
      return { context, usedItems: usedItems.map(item => ({ ...item })) };
    }
  }

  if (mode === 'embeddings') {
    const { context, usedItems } = retrieveByEmbeddings(question, vaultItems, maxTokens);
    if (usedItems.length > 0) {
      return { context, usedItems: usedItems.map(item => ({ ...item })) };
    }
  }

  const queryWords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const scored = vaultItems.map((item, index) => ({
    item,
    index,
    score: relevanceScore(question, item) + typePriority(item.type),
  }));

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const budget = clampContextBudget(maxTokens);
  const used: VaultItem[] = [];
  const parts: string[] = [];
  let total = 0;

  for (const { item } of scored) {
    const header = `--- ${item.type.toUpperCase()}: ${item.title} ---`;
    const headerTokens = estimateTokens(header) + 1;
    const remaining = budget - total - headerTokens;
    if (remaining <= 0) continue;

    const content = item.content ?? '';
    const wholeTokens = estimateTokens(content) + 1;

    if (wholeTokens <= remaining) {
      total += headerTokens + wholeTokens;
      used.push(item);
      parts.push(header, content);
      continue;
    }

    const picked = pickChunks(content, queryWords, remaining);
    if (picked.length === 0) continue;

    const chunkText = picked.join('\n...\n');
    total += headerTokens + estimateTokens(chunkText) + 1;
    used.push(item);
    parts.push(header, chunkText);
  }

  return { context: parts.join('\n\n'), usedItems: used };
}

function pickChunks(content: string, queryWords: string[], budgetTokens: number): string[] {
  const chunks = splitChunks(content);
  if (chunks.length === 0) return [];

  const ranked = chunks
    .map((text, index) => ({ text, index, score: chunkScore(text, queryWords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: { text: string; index: number }[] = [];
  let spent = 0;

  for (const chunk of ranked) {
    const chunkTokens = estimateTokens(chunk.text) + 1;
    if (spent + chunkTokens > budgetTokens) continue;
    picked.push(chunk);
    spent += chunkTokens;
    if (spent >= budgetTokens * 0.9) break;
  }

  if (picked.length === 0) {
    const maxChars = Math.max(200, Math.floor(budgetTokens * 3.5));
    const top = ranked[0].text;
    picked.push({ text: top.length > maxChars ? top.substring(0, maxChars) + '…' : top, index: ranked[0].index });
  }

  return picked.sort((a, b) => a.index - b.index).map(c => c.text.trim()).filter(Boolean);
}

function chunkScore(text: string, queryWords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    if (lower.includes(word)) score++;
  }
  return score;
}

function splitChunks(content: string, maxChars = 900): string[] {
  const paragraphs = content.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }
    let buffer = '';
    for (const line of paragraph.split('\n')) {
      if (buffer && buffer.length + line.length + 1 > maxChars) {
        chunks.push(buffer);
        buffer = line;
      } else {
        buffer = buffer ? `${buffer}\n${line}` : line;
      }
    }
    if (buffer) chunks.push(buffer);
  }

  return chunks.length > 0 ? chunks : [content];
}

function relevanceScore(query: string, item: VaultItem): number {
  let score = 0;

  const title = item.title.toLowerCase();
  const content = item.content.toLowerCase();

  const queryWords = query.split(/\s+/).filter(w => w.length > 2);
  for (const word of queryWords) {
    if (title.includes(word)) score += 3;
    if (content.includes(word)) score += 1;
  }

  if (item.type === 'tone_sample') score += 3;
  if (item.type === 'resume' && /\b(experience|background|work|history|career)\b/.test(query)) score += 5;
  if (item.type === 'portfolio' && /\b(portfolio|project|work|sample)\b/.test(query)) score += 5;
  if (item.type === 'tone_sample' && /\b(tone|style|writing|voice)\b/.test(query)) score += 5;

  return score;
}

export function extractEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

export function extractPhone(text: string): string | null {
  const match = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match ? match[0] : null;
}

export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s,;)]+/);
  return match ? match[0] : null;
}

export function extractName(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 3 && trimmed.split(/\s+/).length >= 2 && trimmed.length < 60) {
      const words = trimmed.split(/\s+/);
      if (words.every(w => /^[A-Z][a-z]/.test(w))) return trimmed;
    }
  }
  return null;
}

export { extractNeedsInputFlags, stripNeedsInputMarkers, sanitizeAnswerStyle } from './answerText';

export function findDirectVaultAnswer(question: string, vaultItems: VaultItem[]): VaultItem | null {
  const normalized = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const target = normalized(question);
  if (!target) return null;

  for (const item of vaultItems) {
    if (item.type !== 'note' && item.type !== 'portfolio') continue;
    const title = normalized(item.title);
    if (title && (title === target || target.startsWith(title) || title.startsWith(target))) {
      return item;
    }
  }
  return null;
}

export interface DocumentPrompt {
  system: string;
  user: string;
}

function buildDocumentSystem(kind: 'cover_letter' | 'video_script', tone: string, language: string): string {
  const langNote = language !== 'en' ? `\n- Write in the language with code: ${language}.` : '';
  const intro =
    kind === 'cover_letter'
      ? `You are helping a job applicant write a tailored cover letter for an application.`
      : `You are helping a job applicant script a short self-introduction video for an application.`;
  return [
    intro,
    `The "Relevant background information" is the applicant's OWN data (resume, notes, portfolio, writing samples). Treat it as the single source of truth about them.`,
    `Rules:`,
    `- Write in FIRST PERSON as the applicant.`,
    `- Ground everything in the provided background. Use their real roles, projects, skills, and accomplishments.`,
    `- Match the tone: "${tone}".`,
    `- Be specific and concrete. Name real projects, metrics, and outcomes from the background where available.`,
    `- Do NOT use corporate-speak or overused AI words: leverage, utilize, spearhead, passionate, dynamic, robust, seamless, holistic, synergistic, impactful, innovative, cutting-edge, results-driven, team player, thought leader.`,
    `- Do NOT use em dashes (—) or en dashes (–). Use periods, commas, or parentheses.`,
    `- Do NOT use bold, headings, or markdown. Write plain prose.`,
    `- Do NOT invent facts. Never state a specific claim (numbers, dates, names, companies, projects) unless it appears in the provided background. If key information is missing, write "NEEDS INPUT: <what is missing>" on its own line instead of fabricating.`,
    `- Output only the document text. No preamble.`,
    langNote,
  ].filter(Boolean).join('\n');
}

export function buildCoverLetterPrompt(
  context: PageContext,
  vaultContext: string,
  tone = 'professional',
  language = 'en'
): DocumentPrompt {
  const parts: string[] = [];
  parts.push('Write a concise, tailored cover letter (roughly 150-300 words).');
  if (context.companyName) parts.push(`Address it to ${context.companyName}.`);
  if (context.jobTitle) parts.push(`Target the ${context.jobTitle} role.`);
  if (context.jobDescription && context.jobDescription.length > 50) {
    parts.push(`Role context (use to tailor, do not copy):\n${context.jobDescription.substring(0, 2500)}`);
  }
  parts.push('');
  if (vaultContext) {
    parts.push('Relevant background information:');
    parts.push(vaultContext);
    parts.push('');
  }
  parts.push('Draft the cover letter now.');
  return { system: buildDocumentSystem('cover_letter', tone, language), user: parts.join('\n') };
}

export function buildVideoScriptPrompt(
  context: PageContext,
  vaultContext: string,
  tone = 'professional',
  language = 'en'
): DocumentPrompt {
  const parts: string[] = [];
  parts.push('Write a short self-introduction video script (roughly 60-90 seconds spoken, 120-200 words).');
  parts.push('Format it as natural spoken prose the applicant can read to camera. No stage directions.');
  if (context.companyName) parts.push(`Reference ${context.companyName} naturally.`);
  if (context.jobTitle) parts.push(`Tailor it to the ${context.jobTitle} role.`);
  if (context.jobDescription && context.jobDescription.length > 50) {
    parts.push(`Role context (use to tailor, do not copy):\n${context.jobDescription.substring(0, 2500)}`);
  }
  parts.push('');
  if (vaultContext) {
    parts.push('Relevant background information:');
    parts.push(vaultContext);
    parts.push('');
  }
  parts.push('Draft the video script now.');
  return { system: buildDocumentSystem('video_script', tone, language), user: parts.join('\n') };
}

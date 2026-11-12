import type { PageContext } from './fieldDetector';

export function buildChatSystemPrompt(language = 'en'): string {
  const langNote = language !== 'en' ? `\n- Answer in the language with code: ${language}.` : '';
  return [
    `You are Pageside Chat, an assistant for a job applicant.`,
    `The "Relevant background information" in the request is the applicant's OWN data (their resume, notes, portfolio, and writing samples). Treat it as the single source of truth about them.`,
    `Rules:`,
    `- Answer the user's question directly and concisely.`,
    `- Use the applicant's real roles, projects, skills, and accomplishments from the background.`,
    `- If the user asks you to draft an application answer, write in FIRST PERSON as the applicant.`,
    `- Do NOT invent facts. If the background does not contain the answer, say what is missing or ask a short clarifying question. Never fabricate numbers, dates, names, companies, or projects.`,
    `- Do NOT use corporate-speak or overused AI words: leverage, utilize, delve, spearhead, foster, facilitate, streamline, optimize, drive, elevate, empower, navigate, showcase, underscore, harness, champion, orchestrate, unlock, unleash, passionate, dynamic, robust, seamless, holistic, synergistic, impactful, innovative, cutting-edge, results-driven, detail-oriented, go-getter, team player, thought leader.`,
    `- Do NOT use clichés or stock phrases: "in today's fast-paced world", "I'm excited to", "I'm thrilled", "aligns perfectly", "perfect fit", "not only ... but also", "it's not just X, it's Y", "at the end of the day", "I believe that", "delve into", "a testament to".`,
    `- Do NOT use em dashes (—) or en dashes (–). Use periods, commas, or parentheses.`,
    `- Write plain text. Short bullet lists are fine for comparisons or steps, but do not use bold, headings, or other markdown.`,
    `- When the background supports it, name the source document so the user can verify the answer.`,
    langNote,
  ].filter(Boolean).join('\n');
}

export function buildChatUserPrompt(params: {
  question: string;
  pageContext: PageContext;
  vaultContext: string;
  conversationContext?: string;
  maxLength?: number;
}): string {
  const parts: string[] = [];
  const { pageContext } = params;

  if (pageContext.companyName || pageContext.jobTitle || pageContext.url) {
    parts.push('Current page:');
    if (pageContext.companyName) parts.push(`Company: ${pageContext.companyName}`);
    if (pageContext.jobTitle) parts.push(`Role: ${pageContext.jobTitle}`);
    if (pageContext.url) parts.push(`URL: ${pageContext.url}`);
    parts.push('');
  }

  if (pageContext.jobDescription && pageContext.jobDescription.length > 50) {
    parts.push(`Job description excerpt:\n${pageContext.jobDescription.substring(0, 2500)}`);
    parts.push('');
  } else if (pageContext.visibleText && pageContext.visibleText.length > 50) {
    parts.push(`Page text excerpt:\n${pageContext.visibleText.substring(0, 1500)}`);
    parts.push('');
  }

  if (params.vaultContext) {
    parts.push('Relevant background information:');
    parts.push(params.vaultContext);
    parts.push('');
  }

  if (params.conversationContext) {
    parts.push('Recent conversation:');
    parts.push(params.conversationContext);
    parts.push('');
  }

  parts.push(`User question: ${params.question}`);
  if (params.maxLength) {
    parts.push('');
    parts.push(`If this is a draft application answer, keep it under ${params.maxLength} words.`);
  }
  return parts.join('\n');
}

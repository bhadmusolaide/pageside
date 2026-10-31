const NEEDS_INPUT_RE = /NEEDS\s+INPUT\s*:?\s*[^\n.)]*[.\n)]?/gi;

export function extractNeedsInputFlags(text: string): string[] {
  const flags: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(NEEDS_INPUT_RE.source, 'gi');
  while ((match = re.exec(text)) !== null) {
    const flag = match[0].replace(/^NEEDS\s+INPUT\s*:?\s*/i, '').replace(/[.\n)]+$/, '').trim();
    if (flag) flags.push(flag);
  }
  return [...new Set(flags)];
}

export function stripNeedsInputMarkers(text: string): string {
  return text
    .replace(NEEDS_INPUT_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const EM_DASH_RE = /\s*[—–]\s*/g;
const PREAMBLE_RE = /^(?:here(?:'s| is)\s+(?:a|my|the)\s+(?:draft|answer|response)[^:\n]*:\s*|answer:\s*)/i;
const FILLER_OPENER_RE = /^(?:in today'?s\s+(?:fast-paced|ever-evolving|rapidly changing|modern|digital)\s+(?:world|landscape|environment)[,:]?\s*|in the\s+(?:modern|current|digital)\s+(?:world|landscape|environment)[,:]?\s*)/i;

const AI_VERB_SWAPS: Record<string, string> = {
  utilize: 'use', utilizes: 'uses', utilized: 'used', utilizing: 'using',
  leverage: 'use', leverages: 'uses', leveraged: 'used', leveraging: 'using',
  spearhead: 'lead', spearheads: 'leads', spearheaded: 'led', spearheading: 'leading',
  delve: 'look', delves: 'looks', delved: 'looked', delving: 'looking',
};
const AI_VERB_RE = /\b(utilize|utilizes|utilized|utilizing|leverage|leverages|leveraged|leveraging|spearhead|spearheads|spearheaded|spearheading|delve|delves|delved|delving)\b/gi;

// Deterministic cleanup for style rules the model may still slip on.
export function sanitizeAnswerStyle(text: string): string {
  if (!text) return text;
  let out = text.trim();

  out = out.replace(PREAMBLE_RE, '');
  out = out.replace(FILLER_OPENER_RE, '');

  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*•]\s+/gm, '');

  out = out.replace(AI_VERB_RE, word => {
    const replacement = AI_VERB_SWAPS[word.toLowerCase()];
    if (!replacement) return word;
    return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });

  out = out.replace(EM_DASH_RE, ', ');

  out = out.replace(/,\s*,+/g, ',');
  out = out.replace(/([,;:])\s*([.!?])/g, '$2');
  out = out.replace(/,(\s*[.!?])/g, '$1');
  out = out.replace(/\(\s*,/g, '(');
  out = out.replace(/,\s*\)/g, ')');
  out = out.replace(/\s+([.,;:!?])/g, '$1');
  out = out.replace(/\.{2,}/g, '.');

  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/ *\n */g, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');

  out = out.replace(/^([a-z])/, m => m.toUpperCase());
  return out.trim();
}

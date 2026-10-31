export interface DetectedField {
  id: string;
  type: 'input' | 'textarea' | 'select' | 'contenteditable' | 'richtext';
  inputType?: string;
  label: string | null;
  sectionHeading: string | null;
  placeholder: string | null;
  currentValue: string;
  maxLength: number | null;
  required: boolean;
  selector: string;
  tagName: string;
  name: string | null;
  attributes: Record<string, string>;
}

export interface PageContext {
  title: string;
  url: string;
  visibleText: string;
  companyName: string | null;
  jobTitle: string | null;
  jobDescription: string | null;
}

export type FieldCategory = 'factual' | 'open_ended' | 'unknown';

const FACTUAL_PATTERNS = [
  /first.?name/i, /last.?name/i, /full.?name/i, /^name$/i,
  /email/i, /e-?mail/i,
  /phone/i, /mobile/i, /telephone/i,
  /linkedin/i, /github/i, /portfolio/i, /website/i, /url/i,
  /address/i, /city/i, /state/i, /zip/i, /postal/i, /country/i,
  /current.?(company|employer|role|position|title)/i,
  /start.?date/i, /end.?date/i, /date/i,
  /salary/i, /compensation/i, /pay/i, /rate/i,
  /visa/i, /sponsorship/i,
  /pronoun/i, /gender/i,
  /how.?did.?you.?hear/i, /referral/i,
  /availability/i, /notice.?period/i,
];

const OPEN_ENDED_PATTERNS = [
  /why (do|would|are)/i, /tell (us|me) (about|why)/i,
  /describe/i, /explain/i, /elaborate/i,
  /motivation/i, /passion/i, /interest/i,
  /strength/i, /weakness/i, /improve/i,
  /experience/i, /background/i, /journey/i,
  /challenge/i, /accomplishment/i, /achievement/i,
  /goal/i, /aspiration/i, /career.?objective/i,
  /contribute/i, /add.?value/i,
  /cover.?letter/i, /personal.?statement/i,
  /(?<!(dis|un))qualified?/i,
  /skill/i, /expertise/i, /proficien/i,
  /project/i, /team/i, /leadership/i,
  /conflict/i, /fail/i, /mistake/i, /setback/i,
  /feedback/i, /mentor/i,
  /detail/i, /please (provide|describe|explain|share)/i,
  /diverse/i, /inclusion/i, /belong/i,
  /problem.?solving/i,
  /work.?style/i, /work.?ethic/i,
  /why.?this.?company/i, /why.?this.?role/i, /why.?should.?we/i,
  /what.?makes.?you/i, /what.?do.?you/i,
];

export function buildFieldId(el: Element): string {
  const parts: string[] = [];
  if (el.id) parts.push(`id:${el.id}`);
  if (el.getAttribute('name')) parts.push(`name:${el.getAttribute('name')}`);
  if (parts.length === 0) {
    const label = resolveLabel(el);
    if (label) parts.push(`label:${label.substring(0, 40)}`);
  }
  if (parts.length === 0) {
    parts.push(`pos:${cascadePosition(el)}`);
  }
  return parts.join('|');
}

function cascadePosition(el: Element): string {
  let pos = 0;
  let current: Element = el;
  let next: Element | null = el.parentElement;
  while (next) {
    const children = Array.from(next.children) as Element[];
    pos = children.indexOf(current) + 1;
    current = next;
    next = current.parentElement;
  }
  return `${el.tagName}-${pos}`;
}

export function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let current: Element = el;
  let parent: Element | null = el.parentElement;
  while (parent) {
    const children = Array.from(parent.children) as Element[];
    const siblings = children.filter(s => s.tagName === current.tagName);
    const idx = siblings.indexOf(current) + 1;
    let sel = current.tagName.toLowerCase();
    if (current.className && typeof current.className === 'string') {
      const classes = (current.className as string).split(/\s+/).filter(Boolean);
      sel += classes.map(c => `.${CSS.escape(c)}`).join('');
    }
    if (siblings.length > 1) sel += `:nth-of-type(${idx})`;
    parts.unshift(sel);
    current = parent;
    parent = current.parentElement;
  }
  return parts.join(' > ');
}

function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

export function resolveLabel(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const ref = rootOf(el).getElementById(ariaLabelledby);
    if (ref) return ref.textContent?.trim() ?? ariaLabelledby;
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    const id = el.getAttribute('id');
    if (id) {
      const labelFor = rootOf(el).querySelector(`label[for="${CSS.escape(id)}"]`);
      if (labelFor) return labelFor.textContent?.trim() ?? null;
    }
  }

  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent?.trim() ?? null;

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    const name = el.getAttribute('name');
    if (name) return name.replace(/[-_]/g, ' ').trim();
  }

  const prev = el.previousElementSibling;
  if (prev && prev.tagName !== 'BR') {
    const text = prev.textContent?.trim();
    if (text && text.length > 0 && text.length < 200) return text;
  }

  const parent = el.parentElement;
  if (parent) {
    const parentText = parent.textContent?.trim() ?? '';
    const idx = parentText.indexOf(el.textContent ?? '');
    if (idx > 0) {
      const before = parentText.substring(0, idx).trim();
      if (before.length > 0 && before.length < 200) return before;
    }
  }

  const legend = el.closest('fieldset')?.querySelector('legend');
  if (legend) return legend.textContent?.trim() ?? null;

  return null;
}

export function resolveSectionHeading(el: Element): string | null {
  const fieldset = el.closest('fieldset');
  const legend = fieldset?.querySelector(':scope > legend');
  if (legend?.textContent?.trim()) return legend.textContent.trim();

  let node: Element | null = el;
  while (node) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/i.test(sibling.tagName)) {
        const text = sibling.textContent?.trim();
        if (text) return text.substring(0, 200);
      }
      const heading = sibling.querySelector?.('h1, h2, h3, h4, h5, h6');
      const text = heading?.textContent?.trim();
      if (text) return text.substring(0, 200);
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
    if (!node || node.tagName === 'BODY' || node.tagName === 'HTML') break;
  }

  return null;
}

export function classifyField(field: DetectedField): FieldCategory {
  const label = (field.label ?? '').toLowerCase();
  const placeholder = (field.placeholder ?? '').toLowerCase();
  const name = (field.name ?? '').toLowerCase();
  const combined = `${label} ${placeholder} ${name}`;

  const looksFactual = FACTUAL_PATTERNS.some(p => p.test(combined));
  const looksOpen = OPEN_ENDED_PATTERNS.some(p => p.test(combined));

  // Long-form fields are open-ended unless their label is purely factual.
  if (field.type === 'textarea') {
    if (looksOpen) return 'open_ended';
    if (looksFactual) return 'factual';
    return 'open_ended';
  }

  if (field.type === 'contenteditable' || field.type === 'richtext') {
    return looksFactual && !looksOpen ? 'factual' : 'open_ended';
  }

  if (looksFactual) return 'factual';
  if (looksOpen) return 'open_ended';

  if (field.type === 'select') return 'factual';

  if (field.inputType === 'text' || !field.inputType) {
    if (combined.length > 20) return 'open_ended';
    return 'factual';
  }

  return 'factual';
}

export function scanElement(
  el: Element,
  depth = 0,
  maxDepth = 20,
  elements?: Map<string, HTMLElement>
): DetectedField[] {
  if (depth > maxDepth) return [];
  const results: DetectedField[] = [];

  if (isFormField(el)) {
    try {
      const field = detectField(el);
      if (field) {
        results.push(field);
        if (elements && el instanceof HTMLElement) elements.set(field.id, el);
      }
    } catch { }
  }

  if (el instanceof HTMLElement && el.contentEditable === 'true') {
    try {
      const field = detectContentEditable(el);
      if (field) {
        results.push(field);
        if (elements) elements.set(field.id, el);
      }
    } catch { }
  }

  try {
    const shadow = el.shadowRoot;
    if (shadow) {
      for (const child of shadow.children) {
        results.push(...scanElement(child as Element, depth + 1, maxDepth, elements));
      }
    }
  } catch { }

  for (const child of el.children) {
    results.push(...scanElement(child, depth + 1, maxDepth, elements));
  }

  return results;
}

function isFormField(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return true;
  if (el.hasAttribute('role') && el.getAttribute('role') === 'combobox') return true;
  return false;
}

function detectField(el: Element): DetectedField | null {
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (['hidden', 'submit', 'button', 'reset', 'file', 'image'].includes(type)) return null;
    return {
      id: buildFieldId(el),
      type: 'input',
      inputType: type,
      label: resolveLabel(el),
      sectionHeading: resolveSectionHeading(el),
      placeholder: el.placeholder || null,
      currentValue: el.value || '',
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      required: el.required,
      selector: buildSelector(el),
      tagName: 'input',
      name: el.getAttribute('name'),
      attributes: extractAttributes(el),
    };
  }

  if (el instanceof HTMLTextAreaElement) {
    return {
      id: buildFieldId(el),
      type: 'textarea',
      label: resolveLabel(el),
      sectionHeading: resolveSectionHeading(el),
      placeholder: el.placeholder || null,
      currentValue: el.value || '',
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      required: el.required,
      selector: buildSelector(el),
      tagName: 'textarea',
      name: el.getAttribute('name'),
      attributes: extractAttributes(el),
    };
  }

  if (el instanceof HTMLSelectElement) {
    return {
      id: buildFieldId(el),
      type: 'select',
      label: resolveLabel(el),
      sectionHeading: resolveSectionHeading(el),
      placeholder: null,
      currentValue: el.value || '',
      maxLength: null,
      required: el.required,
      selector: buildSelector(el),
      tagName: 'select',
      name: el.getAttribute('name'),
      attributes: extractAttributes(el),
    };
  }

  return null;
}

function detectContentEditable(el: HTMLElement): DetectedField | null {
  const label = resolveLabel(el);
  const role = el.getAttribute('role')?.toLowerCase();
  const isRichText = role === 'textbox' || el.tagName.toLowerCase() === 'div' || el.tagName.toLowerCase() === 'p';

  return {
    id: buildFieldId(el),
    type: isRichText ? 'richtext' : 'contenteditable',
    label,
    sectionHeading: resolveSectionHeading(el),
    placeholder: el.getAttribute('placeholder') || null,
    currentValue: el.textContent?.trim() || '',
    maxLength: null,
    required: el.hasAttribute('required') || el.hasAttribute('aria-required'),
    selector: buildSelector(el),
    tagName: el.tagName,
    name: el.getAttribute('name'),
    attributes: extractAttributes(el),
  };
}

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of ['autocomplete', 'pattern', 'minlength', 'maxlength', 'readonly', 'disabled', 'aria-label', 'aria-describedby', 'aria-labelledby', 'aria-required']) {
    const v = el.getAttribute(attr);
    if (v !== null) attrs[attr] = v;
  }
  return attrs;
}

export interface StructuredJobPosting {
  title: string | null;
  company: string | null;
  description: string | null;
}

const JOB_DESCRIPTION_KEYWORDS = [
  'responsibilit', 'requirement', 'qualification', 'you will', "you'll",
  'about the role', 'about us', 'what you', 'skills', 'experience',
  'benefits', 'apply', 'hiring', 'team', 'role', 'position', 'salary',
];

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'object',
  'header', 'nav', 'footer', 'aside', 'form',
  '[hidden]', '[aria-hidden="true"]', '[role="navigation"]',
  '[role="banner"]', '[role="contentinfo"]',
].join(',');

export function extractPageContext(doc: Document): PageContext {
  const title = cleanText(doc.title || '');
  const url = doc.location?.href || '';
  const structured = extractStructuredJobPosting(doc);

  const companyName = structured?.company ?? guessCompanyName(doc, title);
  const jobTitle = structured?.title ?? guessJobTitle(doc, title);
  const jobDescription = structured?.description ?? extractJobDescription(doc);
  const visibleText = extractVisibleText(doc, 10000);

  return {
    title,
    url,
    visibleText,
    companyName,
    jobTitle,
    jobDescription,
  };
}

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanOrNull(value: unknown): string | null {
  const text = typeof value === 'string' ? cleanText(value) : '';
  return text || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ---------------------- Structured job data (JSON-LD) ---------------------- */

export function parseStructuredJobPosting(scripts: string[]): StructuredJobPosting | null {
  for (const script of scripts) {
    const data = parseJsonLd(script);
    const posting = findJobPosting(data);
    if (!posting) continue;

    const organization = posting.hiringOrganization as unknown;
    let company: string | null = null;
    if (typeof organization === 'string') {
      company = organization;
    } else if (organization && typeof organization === 'object') {
      company = (organization as Record<string, unknown>).name as string | undefined ?? null;
    }

    const rawDescription = typeof posting.description === 'string' ? posting.description : null;
    return {
      title: cleanOrNull(posting.title),
      company: cleanOrNull(company),
      description: rawDescription ? htmlToText(rawDescription) : null,
    };
  }
  return null;
}

function extractStructuredJobPosting(doc: Document): StructuredJobPosting | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
    .map(script => script.textContent ?? '');
  return parseStructuredJobPosting(scripts);
}

function parseJsonLd(text: string): unknown | null {
  const raw = text.trim().replace(/^\uFEFF/, '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Some sites emit raw newlines/control characters inside JSON strings.
    try {
      return JSON.parse(repairJsonControlChars(raw));
    } catch {
      return null;
    }
  }
}

function repairJsonControlChars(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        out += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        out += char;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        if (char === '\n') out += '\\n';
        else if (char === '\r') out += '\\r';
        else if (char === '\t') out += '\\t';
        else out += ' ';
        continue;
      }
      out += char;
    } else {
      if (char === '"') {
        inString = true;
        out += char;
        continue;
      }
      out += code < 0x20 ? ' ' : char;
    }
  }

  return out;
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobPosting(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) return record;

  for (const child of Object.values(record)) {
    const found = findJobPosting(child);
    if (found) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withBreaks)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“',
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1]?.toLowerCase() === 'x';
      const value = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : all;
    }
    return named[code.toLowerCase()] ?? all;
  });
}

/* ------------------------- Page fallbacks ------------------------- */

function extractVisibleText(doc: Document, maxChars: number): string {
  const root = doc.querySelector('main, article, [role="main"]') ?? doc.body;
  if (!root) return '';
  return normalizeBlockText(root).substring(0, maxChars);
}

function normalizeBlockText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(STRIP_SELECTORS).forEach(node => node.remove());
  clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  clone.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr, section, article')
    .forEach(node => node.append('\n'));

  return ((clone as HTMLElement).textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function guessCompanyName(doc: Document, title: string): string | null {
  const siteName = cleanOrNull(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content'));

  const domSelectors = [
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    '[itemprop="hiringOrganization"]',
    '[class*="company-name" i]',
    '[class*="companyName" i]',
    '[class*="employer" i]',
    '[data-company]',
    'main a[href*="/company/"]',
    'article a[href*="/company/"]',
  ];

  for (const selector of domSelectors) {
    const element = doc.querySelector(selector);
    const raw = element?.getAttribute('data-company') ?? element?.textContent;
    const candidate = cleanOrNull(raw);
    if (!candidate || candidate.length > 80) continue;
    if (/^(company|about|careers?|jobs?|apply|home)$/i.test(candidate)) continue;
    return candidate;
  }

  const titlePatterns: RegExp[] = [
    /\b(?:at|@)\s+([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})/,
    /([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})\s+(?:is hiring|careers|jobs)\b/i,
  ];
  for (const pattern of titlePatterns) {
    const candidate = cleanOrNull(title.match(pattern)?.[1]);
    if (candidate && candidate.length <= 80) return candidate;
  }

  return siteName;
}

function guessJobTitle(doc: Document, title: string): string | null {
  const siteName = cleanOrNull(doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content'));
  const headings = doc.querySelectorAll('h1, [itemprop="title"], [class*="job-title" i], [class*="jobTitle" i]');

  for (const heading of Array.from(headings)) {
    const candidate = cleanOrNull(heading.textContent);
    if (!candidate || candidate.length > 140) continue;
    if (siteName && candidate.toLowerCase() === siteName.toLowerCase()) continue;
    if (/^(jobs?|careers?|home|apply|application)$/i.test(candidate)) continue;
    return candidate.replace(/\s*\((?:remote|hybrid|on-?site)[^)]*\)\s*$/i, '').trim() || candidate;
  }

  let cleaned = title;
  if (siteName) {
    cleaned = cleaned.replace(new RegExp(`\\s*[|—–·]\\s*${escapeRegExp(siteName)}\\s*$`, 'i'), '').trim();
  }
  cleaned = cleaned.replace(/\s*[|—–·]\s*(?:jobs?|careers?|hiring)\s*$/i, '').trim();
  return cleaned.length > 0 && cleaned.length <= 140 ? cleaned : null;
}

function extractJobDescription(doc: Document): string | null {
  const selectorGroups = [
    '[itemprop="description"]',
    '[class*="job-description" i]',
    '[id*="job-description" i]',
    '[class*="jobDescription" i]',
    '[class*="job-details" i]',
    '[class*="jobDetails" i]',
    '[class*="job-content" i]',
    '[class*="jobContent" i]',
    'article',
    'main',
    '[role="main"]',
  ];

  const seen = new Set<Element>();
  let best: { text: string; score: number } | null = null;

  for (const selector of selectorGroups) {
    for (const element of Array.from(doc.querySelectorAll(selector)).slice(0, 8)) {
      if (seen.has(element)) continue;
      seen.add(element);

      const text = normalizeBlockText(element);
      if (text.length < 300 || text.length > 20000) continue;

      const identifier = `${element.className} ${element.id} ${element.getAttribute('role') ?? ''}`;
      if (/(nav|menu|header|footer|sidebar|comment|cookie|banner)/i.test(identifier)) continue;

      const lower = text.toLowerCase();
      const keywordHits = JOB_DESCRIPTION_KEYWORDS.reduce(
        (sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0),
        0
      );
      if (keywordHits < 2 && !/description/i.test(identifier)) continue;

      const structure = Math.min(20, element.querySelectorAll('p, li').length);
      const boost = /description|job|article|main/i.test(identifier) ? 6 : 0;
      const score = keywordHits * 3 + structure + boost + Math.min(8, text.length / 1000);
      if (!best || score > best.score) best = { text, score };
    }
  }

  if (!best && doc.body) {
    const fallback = normalizeBlockText(doc.body);
    if (fallback.length > 300) best = { text: fallback, score: 0 };
  }

  return best ? best.text.substring(0, 8000) : null;
}

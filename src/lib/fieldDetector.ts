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

export function extractPageContext(doc: Document): PageContext {
  const title = doc.title || '';
  const url = doc.location?.href || '';
  const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const visibleText = extractVisibleText(doc.body, 5000);

  const companyName = guessCompanyName(doc, title);
  const jobTitle = guessJobTitle(doc, title);
  const jobDescription = extractJobDescription(doc);

  return {
    title,
    url,
    visibleText: visibleText.substring(0, 10000),
    companyName,
    jobTitle,
    jobDescription,
  };
}

function extractVisibleText(body: HTMLElement | null, maxChars: number): string {
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;

  const selectors = ['script', 'style', 'noscript', 'svg', 'iframe', 'object', '[hidden]', '[aria-hidden="true"]'];
  selectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(n => n.remove());
  });

  let text = clone.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  return text.substring(0, maxChars);
}

function guessCompanyName(doc: Document, title: string): string | null {
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSite) return ogSite;

  const match = title.match(new RegExp('(?:at|@|—|-|–|¦|\\/\\/)\\s*([A-Z][A-Za-z0-9 .&]+?)(?:\\s*(?:—|-|–|\\||¦|\\/\\/| hiring| careers| jobs))?'));
  if (match) return match[1].trim();

  return null;
}

function guessJobTitle(doc: Document, title: string): string | null {
  const patterns = [
    /(?:hiring|recruiting|looking for|position|role|job):?\s*(.+?)(?:\s*(?:at|@|—|-|–|\||¦))?$/im,
    /(.+?)\s*(?:position|role|opening)/i,
    /(?:senior|staff|lead|principal|junior|associate).{0,40}/i,
  ];

  for (const p of patterns) {
    const m = title.match(p);
    if (m) return m[1] || m[0];
  }

  return null;
}

function extractJobDescription(doc: Document): string | null {
  const candidates = doc.querySelectorAll('[class*="description"]:not(meta), [class*="Description"]:not(meta), article, [role="main"], [class*="content"], [class*="body"]');
  for (const el of candidates) {
    const text = el.textContent?.trim() || '';
    if (text.length > 200 && text.length < 10000) return text.substring(0, 8000);
  }
  return null;
}
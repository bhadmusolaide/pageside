import { isLikelyFieldIdentifier, type DetectedField } from '../lib/fieldDetector';
import { formatTokens, formatCost, type GenerationUsage } from '../lib/usage';
import type { AnswerProvenance } from '../lib/messaging';

function fieldDisplayLabel(field: DetectedField): string {
  for (const candidate of [field.label, field.placeholder, field.sectionHeading]) {
    const text = candidate?.trim();
    if (text && !isLikelyFieldIdentifier(text)) return text;
  }
  return '(untitled field)';
}

const TOOLBAR_HTML = `
<style>
  :host { all: initial; }
  #__sr-toolbar {
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    font: 13px/1.4 system-ui, sans-serif; color: #111;
    display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
    user-select: none; pointer-events: auto; touch-action: none;
  }
  #__sr-toolbar.menu-below { flex-direction: column-reverse; }
  #__sr-toolbar.align-left { align-items: flex-start; }
  #__sr-toggle {
    width: 44px; height: 44px; border-radius: 50%; border: 0;
    background: #2563eb; color: #fff; font-size: 16px; font-weight: 700;
    cursor: grab; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: transform .15s;
  }
  #__sr-toggle:hover { transform: scale(1.08); }
  #__sr-toggle:active { cursor: grabbing; transform: scale(0.98); }
  #__sr-menu {
    background: #fff; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    padding: 8px 12px; display: none; min-width: 160px;
    max-height: calc(100vh - 88px); overflow-y: auto;
  }
  #__sr-menu.open { display: block; }
  #__sr-menu button {
    display: block; width: 100%; min-height: 36px; text-align: left; padding: 8px;
    border: 0; border-radius: 4px; background: transparent; font: inherit;
    cursor: pointer; margin-bottom: 2px;
  }
  #__sr-menu button:hover { background: #f0f4ff; }
  #__sr-menu .sep { height: 1px; background: #e5e7eb; margin: 4px 0; }
  #__sr-menu .label { font-size: 12px; color: #4b5563; padding: 2px 8px; }
  #__sr-menu select {
    width: 100%; min-height: 36px; box-sizing: border-box; font: inherit; font-size: 12px;
    padding: 6px 8px; margin: 2px 0 4px; border: 1px solid #6b7280;
    border-radius: 4px; background: #fff; color: #111; cursor: pointer;
  }
  #__sr-menu button:focus-visible, #__sr-menu select:focus-visible, #__sr-toggle:focus-visible {
    outline: 2px solid #1d4ed8; outline-offset: 2px;
  }
  #__sr-badge {
    position: fixed; top: 0; left: 0; z-index: 2147483646;
    pointer-events: none; font: 12px/1.3 system-ui, sans-serif;
    background: #3b82f6; color: #fff; padding: 1px 5px; border-radius: 3px;
    opacity: 0.85;
  }
  :host([data-sr-dark]) #__sr-menu {background: #111827; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-menu button {color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-menu button:hover {background: #1f2937; }
  :host([data-sr-dark]) #__sr-menu select {background: #0f172a; color: #e5e7eb; border-color: #4b5563; }
  :host([data-sr-dark]) #__sr-menu .sep {background: #374151; }
  :host([data-sr-dark]) #__sr-menu .label {color: #9ca3af; }
</style>
<div id="__sr-toolbar">
  <div id="__sr-menu">
    <div class="label">Pageside</div>
    <div class="label">Vault profile</div>
    <select id="__sr-vault-profile"></select>
    <div class="sep"></div>
    <button id="__sr-scan">Scan Page</button>
    <button id="__sr-answer-all">Draft Open-Ended…</button>
    <button id="__sr-read-selection">Read Selection</button>
    <div class="sep"></div>
    <button id="__sr-cover-letter">Cover Letter</button>
    <button id="__sr-video-script">Video Script</button>
    <div class="sep"></div>
    <button id="__sr-toggle-enable" style="color:#666">Disable on this site</button>
  </div>
  <button id="__sr-toggle" aria-label="Pageside" title="Pageside">PS</button>
</div>
`;

const CARD_HTML = `
<style>
  :host { all: initial; }
  #__sr-card {
    position: fixed; z-index: 2147483647;
    font: 13px/1.4 system-ui, sans-serif; color: #111;
    background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.18);
    padding: 10px 14px; min-width: 260px; max-width: 420px;
    pointer-events: auto;
  }
  #__sr-card .field-label {
    font-size: 12px; color: #4b5563; font-weight: 600; margin-bottom: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #__sr-card .status-badge {
    display: inline-block; font-size: 11px; padding: 1px 6px;
    border-radius: 3px; margin-left: 4px;
  }
  #__sr-card .status-draft { background: #dbeafe; color: #1e40af; }
  #__sr-card .status-inserted { background: #dcfce7; color: #166534; }
  #__sr-card .status-skipped { background: #f3f4f6; color: #6b7280; }
  #__sr-card .status-error { background: #fee2e2; color: #991b1b; }
  #__sr-card .source-chip {
    display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 3px;
    margin-left: 4px; background: #fef3c7; color: #92400e;
  }
  #__sr-card .source-chip.source-llm { background: #e0e7ff; color: #3730a3; }
  #__sr-card .field-context { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  #__sr-card .approve-row {
    display: flex; align-items: center; gap: 6px; font-size: 12px;
    color: #374151; margin: 0 0 6px;
  }
  #__sr-card .approve-row input { width: 16px; height: 16px; }
  #__sr-card .actions button:disabled { opacity: .45; cursor: not-allowed; }
  #__sr-card .answer-text {
    display: block; width: 100%; box-sizing: border-box;
    font: inherit; font-size: 13px; line-height: 1.5; margin: 6px 0 8px;
    border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px;
    background: #fff; color: #111; resize: vertical;
    min-height: 64px; max-height: 200px;
  }
  #__sr-card .answer-text.loading { color: #4b5563; background: #f9fafb; }
  #__sr-card .actions { display: flex; gap: 4px; flex-wrap: wrap; }
  #__sr-card .actions button {
    font-size: 12px; min-height: 32px; padding: 5px 10px; border: 0; border-radius: 4px;
    cursor: pointer; background: #f3f4f6; color: #374151;
    white-space: nowrap;
  }
  #__sr-card .actions button:focus-visible, #__sr-card .close-btn:focus-visible, #__sr-card .answer-text:focus-visible {
    outline: 2px solid #1d4ed8; outline-offset: 2px;
  }
  #__sr-card .actions button:hover { background: #e5e7eb; }
  #__sr-card .actions button.primary { background: #3b82f6; color: #fff; }
  #__sr-card .actions button.primary:hover { background: #2563eb; }
  #__sr-card .actions button.danger { background: #ef4444; color: #fff; }
  #__sr-card .sources { font-size: 11px; color: #4b5563; margin-top: 4px; }
  #__sr-card .sources span { cursor: pointer; text-decoration: underline; }
  #__sr-card .usage { font-size: 11px; color: #4b5563; margin-top: 2px; }
  #__sr-card .flags { margin-top: 4px; font-size: 11px; }
  #__sr-card .flags .flag {
    display: block; background: #fef2f2; color: #b91c1c;
    border: 1px solid #fecaca; border-radius: 4px; padding: 3px 6px; margin-top: 3px;
  }
  #__sr-card .flags .flag-title {
    font-weight: 700; margin-bottom: 1px;
  }
  #__sr-card .close-btn {
    position: absolute; top: 6px; right: 8px; font-size: 14px;
    border: 0; background: transparent; cursor: pointer; color: #4b5563;
    line-height: 1; padding: 2px;
  }
  :host([data-sr-dark]) #__sr-card {background: #111827; color: #e5e7eb; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
  :host([data-sr-dark]) #__sr-card .field-label, :host([data-sr-dark]) #__sr-card .field-context, :host([data-sr-dark]) #__sr-card .sources, :host([data-sr-dark]) #__sr-card .usage {color: #9ca3af; }
  :host([data-sr-dark]) #__sr-card .answer-text {background: #0f172a; color: #e5e7eb; border-color: #4b5563; }
  :host([data-sr-dark]) #__sr-card .answer-text.loading {background: #1f2937; color: #9ca3af; }
  :host([data-sr-dark]) #__sr-card .actions button {background: #1f2937; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-card .actions button:hover {background: #374151; }
  :host([data-sr-dark]) #__sr-card .actions button.primary {background: #2563eb; color: #fff; }
  :host([data-sr-dark]) #__sr-card .close-btn {color: #9ca3af; }
  :host([data-sr-dark]) #__sr-card .status-draft {background: #172554; color: #93c5fd; }
  :host([data-sr-dark]) #__sr-card .status-inserted {background: #052e1b; color: #86efac; }
  :host([data-sr-dark]) #__sr-card .status-skipped {background: #1f2937; color: #9ca3af; }
  :host([data-sr-dark]) #__sr-card .status-error {background: #3f1d1d; color: #fca5a5; }
  :host([data-sr-dark]) #__sr-card .source-chip {background: #3b2a06; color: #fcd34d; }
  :host([data-sr-dark]) #__sr-card .source-chip.source-llm {background: #312e81; color: #c7d2fe; }
  :host([data-sr-dark]) #__sr-card .flags .flag {background: #3f1d1d; color: #fca5a5; border-color: #7f1d1d; }
</style>
<div id="__sr-card">
  <button class="close-btn" id="__sr-card-close">&times;</button>
  <div>
    <span class="field-label" id="__sr-card-label"></span>
    <span class="status-badge status-draft" id="__sr-card-status">Drafting...</span>
    <span class="source-chip" id="__sr-card-source" style="display:none"></span>
  </div>
  <div class="field-context" id="__sr-card-context"></div>
  <textarea class="answer-text loading" id="__sr-card-answer" rows="4" spellcheck="false"></textarea>
  <div class="approve-row">
    <input type="checkbox" id="__sr-card-approve">
    <label for="__sr-card-approve">Approve for insert</label>
  </div>
  <div class="actions" id="__sr-card-actions">
    <button class="primary" id="__sr-card-insert" disabled>Insert</button>
    <button class="danger" id="__sr-card-stop" style="display:none">Stop</button>
    <button id="__sr-card-undo">Undo</button>
    <button id="__sr-card-copy">Copy</button>
    <button id="__sr-card-regenerate">Regenerate</button>
    <button id="__sr-card-shorter">Shorter</button>
    <button id="__sr-card-longer">Longer</button>
    <button id="__sr-card-casual">Casual</button>
    <button id="__sr-card-formal">Formal</button>
  </div>
  <div class="flags" id="__sr-card-flags"></div>
  <div class="sources" id="__sr-card-sources"></div>
  <div class="usage" id="__sr-card-usage"></div>
</div>
`;

const DOC_HTML = `
<style>
  :host { all: initial; }
  #__sr-doc-backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(15,23,42,0.35); display: flex;
    align-items: center; justify-content: center; padding: 24px;
    font: 14px/1.5 system-ui, sans-serif;
  }
  #__sr-doc {
    background: #fff; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.25);
    width: min(640px, 100%); max-height: 80vh; display: flex; flex-direction: column;
    pointer-events: auto; color: #111;
  }
  #__sr-doc .doc-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
  }
  #__sr-doc .doc-title { font-size: 15px; font-weight: 700; }
  #__sr-doc .doc-close {
    border: 0; background: transparent; cursor: pointer; font-size: 20px; color: #4b5563; line-height: 1;
  }
  #__sr-doc .doc-body {
    padding: 16px; overflow-y: auto; white-space: pre-wrap;
    font-size: 13px; line-height: 1.6; color: #1f2937; flex: 1;
  }
  #__sr-doc .doc-body.loading { color: #4b5563; }
  #__sr-doc .doc-foot {
    display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #e5e7eb; flex-wrap: wrap;
  }
  #__sr-doc .doc-foot button {
    font-size: 13px; min-height: 40px; padding: 8px 14px; border: 0; border-radius: 6px;
    cursor: pointer; background: #f3f4f6; color: #374151;
  }
  #__sr-doc .doc-foot button:focus-visible, #__sr-doc .doc-close:focus-visible {
    outline: 2px solid #1d4ed8; outline-offset: 2px;
  }
  #__sr-doc .doc-foot button:hover { background: #e5e7eb; }
  #__sr-doc .doc-foot button.primary { background: #3b82f6; color: #fff; }
  #__sr-doc .doc-foot button.primary:hover { background: #2563eb; }
  #__sr-doc .doc-note { font-size: 12px; color: #4b5563; margin-left: auto; align-self: center; }
  :host([data-sr-dark]) #__sr-doc {background: #111827; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-doc .doc-head, :host([data-sr-dark]) #__sr-doc .doc-foot {border-color: #1f2937; }
  :host([data-sr-dark]) #__sr-doc .doc-body {color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-doc .doc-body.loading, :host([data-sr-dark]) #__sr-doc .doc-note {color: #9ca3af; }
  :host([data-sr-dark]) #__sr-doc .doc-foot button {background: #1f2937; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-doc .doc-foot button:hover {background: #374151; }
  :host([data-sr-dark]) #__sr-doc .doc-foot button.primary {background: #2563eb; color: #fff; }
</style>
<div id="__sr-doc-backdrop">
  <div id="__sr-doc">
    <div class="doc-head">
      <span class="doc-title" id="__sr-doc-title">Generating…</span>
      <button class="doc-close" id="__sr-doc-close">&times;</button>
    </div>
    <div class="doc-body loading" id="__sr-doc-body">Generating…</div>
    <div class="doc-foot">
      <button class="primary" id="__sr-doc-copy">Copy</button>
      <button id="__sr-doc-download">Download .txt</button>
      <button id="__sr-doc-save-vault">Save to Vault</button>
      <button id="__sr-doc-retry">Try Again</button>
      <span class="doc-note" id="__sr-doc-note"></span>
    </div>
  </div>
</div>
`;

let toolbarRoot: ShadowRoot | null = null;
let toolbarEl: HTMLElement | null = null;
let containerEl: HTMLElement | null = null;
let menuEl: HTMLElement | null = null;

type ThemeMode = 'light' | 'dark' | 'system';
let themeMode: ThemeMode = 'system';
let themeListenersReady = false;

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function themeIsDark(): boolean {
  return themeMode === 'dark' || (themeMode === 'system' && prefersDark());
}

function applyThemeToHost(host: HTMLElement): void {
  host.toggleAttribute('data-sr-dark', themeIsDark());
}

function refreshThemeHosts(): void {
  document.querySelectorAll<HTMLElement>('[data-sr-ui-host]').forEach(applyThemeToHost);
}

function registerThemeHost(host: HTMLElement): void {
  host.setAttribute('data-sr-ui-host', '');
  applyThemeToHost(host);
}

async function initContentTheme(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('sr-theme');
    themeMode = isThemeMode(stored['sr-theme']) ? stored['sr-theme'] : 'system';
  } catch {
    themeMode = 'system';
  }
  refreshThemeHosts();

  if (themeListenersReady) return;
  themeListenersReady = true;

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['sr-theme']) return;
      const next = changes['sr-theme'].newValue;
      themeMode = isThemeMode(next) ? next : 'system';
      refreshThemeHosts();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode === 'system') refreshThemeHosts();
    });
  } catch {
    /* extension context may be gone */
  }
}

const TOOLBAR_POSITION_KEY = 'sr-toolbar-position';
const TOOLBAR_MARGIN = 8;
let suppressToggleClick = false;
let positionLoaded = false;
let toolbarAnchor: { left: number; top: number } | null = null;

function toggleSize(): { width: number; height: number } {
  return {
    width: toolbarEl?.offsetWidth || 44,
    height: toolbarEl?.offsetHeight || 44,
  };
}

function clampToolbar(left: number, top: number): { left: number; top: number } {
  const { width, height } = toggleSize();
  const maxLeft = Math.max(TOOLBAR_MARGIN, window.innerWidth - width - TOOLBAR_MARGIN);
  const maxTop = Math.max(TOOLBAR_MARGIN, window.innerHeight - height - TOOLBAR_MARGIN);
  return {
    left: Math.min(maxLeft, Math.max(TOOLBAR_MARGIN, left)),
    top: Math.min(maxTop, Math.max(TOOLBAR_MARGIN, top)),
  };
}

/*
 * The container is anchored by the toggle's corner, not its own top-left.
 * When the menu opens above, the container is bottom-anchored so it grows
 * upward; when it opens below, it is top-anchored and grows downward. The
 * horizontal anchor follows the nearer viewport edge so the menu expands
 * into free space instead of off-screen.
 */
function positionToolbar(): void {
  if (!containerEl || !toolbarEl || !toolbarAnchor) return;
  const { width, height } = toggleSize();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const menuOpen = Boolean(menuEl?.classList.contains('open'));
  const openBelow = menuOpen && containerEl.classList.contains('menu-below');
  const anchorRight = toolbarAnchor.left + width / 2 > viewportWidth / 2;

  containerEl.classList.toggle('align-left', !anchorRight);
  if (anchorRight) {
    containerEl.style.left = 'auto';
    containerEl.style.right = `${Math.max(0, viewportWidth - (toolbarAnchor.left + width))}px`;
  } else {
    containerEl.style.right = 'auto';
    containerEl.style.left = `${toolbarAnchor.left}px`;
  }

  if (openBelow) {
    containerEl.style.bottom = 'auto';
    containerEl.style.top = `${toolbarAnchor.top}px`;
  } else {
    containerEl.style.top = 'auto';
    containerEl.style.bottom = `${Math.max(0, viewportHeight - (toolbarAnchor.top + height))}px`;
  }
}

function applyToolbarPosition(left: number, top: number): void {
  if (!containerEl || !toolbarEl) return;
  toolbarAnchor = clampToolbar(left, top);
  positionToolbar();
}

function persistToolbarPosition(): void {
  if (!toolbarAnchor) return;
  try {
    void chrome.storage.local.set({
      [TOOLBAR_POSITION_KEY]: {
        left: Math.round(toolbarAnchor.left),
        top: Math.round(toolbarAnchor.top),
      },
    });
  } catch {
    /* extension context may be gone */
  }
}

async function restoreToolbarPosition(): Promise<void> {
  if (!containerEl || positionLoaded) return;
  positionLoaded = true;
  try {
    const stored = await chrome.storage.local.get(TOOLBAR_POSITION_KEY);
    const value = stored[TOOLBAR_POSITION_KEY] as { left?: number; top?: number } | undefined;
    if (typeof value?.left === 'number' && typeof value?.top === 'number') {
      applyToolbarPosition(value.left, value.top);
    }
  } catch {
    /* keep default corner */
  }
}

function updateMenuDirection(): void {
  if (!containerEl || !toolbarEl || !menuEl) return;
  const top = toolbarAnchor?.top ?? toolbarEl.getBoundingClientRect().top;
  const height = toggleSize().height;
  const menuHeight = menuEl.scrollHeight || 260;
  const spaceAbove = top;
  const spaceBelow = window.innerHeight - (top + height);

  let openBelow: boolean;
  if (spaceAbove >= menuHeight + TOOLBAR_MARGIN) {
    openBelow = false;
  } else if (spaceBelow >= menuHeight + TOOLBAR_MARGIN) {
    openBelow = true;
  } else {
    openBelow = spaceBelow > spaceAbove;
  }

  containerEl.classList.toggle('menu-below', openBelow);
  positionToolbar();
}

function wireToolbarDrag(): void {
  if (!toolbarEl || !containerEl) return;
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null = null;

  toolbarEl.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const rect = toolbarEl!.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
    try { toolbarEl!.setPointerCapture(event.pointerId); } catch { /* noop */ }
  });

  toolbarEl.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    hideToolbar();
    applyToolbarPosition(drag.originLeft + dx, drag.originTop + dy);
  });

  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    try { toolbarEl!.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    if (moved) {
      suppressToggleClick = true;
      persistToolbarPosition();
    }
  };

  toolbarEl.addEventListener('pointerup', endDrag);
  toolbarEl.addEventListener('pointercancel', endDrag);
}

let activeCard: { el: HTMLElement; root: ShadowRoot; fieldId: string } | null = null;
let fieldClickHandlers: Map<string, (fieldId: string) => void> = new Map();

export function initToolbar(): void {
  if (toolbarRoot) return;
  void initContentTheme();
  if (document.documentElement?.querySelector('#__sr-root')) return;

  const host = document.createElement('div');
  host.id = '__sr-root';
  registerThemeHost(host);
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none';
  toolbarRoot = host.attachShadow({ mode: 'open' });
  toolbarRoot.innerHTML = TOOLBAR_HTML;

  document.documentElement?.appendChild(host);

  toolbarEl = toolbarRoot.getElementById('__sr-toggle') as HTMLElement;
  containerEl = toolbarRoot.getElementById('__sr-toolbar') as HTMLElement;
  menuEl = toolbarRoot.getElementById('__sr-menu') as HTMLElement;

  toolbarEl.addEventListener('click', () => {
    if (suppressToggleClick) {
      suppressToggleClick = false;
      return;
    }
    if (menuEl) {
      menuEl.classList.toggle('open');
      updateMenuDirection();
    }
  });

  wireToolbarDrag();
  void restoreToolbarPosition();
  window.addEventListener('resize', () => {
    if (!containerEl || !toolbarEl) return;
    if (toolbarAnchor) {
      toolbarAnchor = clampToolbar(toolbarAnchor.left, toolbarAnchor.top);
      positionToolbar();
    } else {
      const rect = toolbarEl.getBoundingClientRect();
      applyToolbarPosition(rect.left, rect.top);
    }
  });
}

export function onToolbarButton(buttonId: string, handler: () => void): void {
  if (!toolbarRoot) return;
  const btn = toolbarRoot.getElementById(buttonId);
  btn?.addEventListener('click', handler);
}

export function setVaultProfileOptions(
  profiles: { id: string; name: string }[],
  selectedId: string | null,
  autoLabel: string
): void {
  const select = toolbarRoot?.getElementById('__sr-vault-profile') as HTMLSelectElement | null;
  if (!select) return;

  const previous = select.value;
  select.innerHTML = '';

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = autoLabel;
  select.appendChild(auto);

  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  }

  if (selectedId !== null && profiles.some(profile => profile.id === selectedId)) {
    select.value = selectedId;
  } else if (previous === '') {
    select.value = '';
  } else {
    select.value = '';
  }
}

export function onVaultProfileChange(handler: (profileId: string) => void): void {
  const select = toolbarRoot?.getElementById('__sr-vault-profile') as HTMLSelectElement | null;
  select?.addEventListener('change', () => handler(select.value));
}

export function hideToolbar(): void {
  if (menuEl) menuEl.classList.remove('open');
}

export function destroyToolbar(): void {
  closeAnswerCard();
  closeDocModal();
  if (toolbarRoot) {
    toolbarRoot.host.remove();
    toolbarRoot = null;
    toolbarEl = null;
    containerEl = null;
    menuEl = null;
    toolbarAnchor = null;
    positionLoaded = false;
  }
}

const highlightedFields = new Set<HTMLElement>();

export function highlightField(el: HTMLElement): void {
  highlightedFields.add(el);
  el.style.outline = '2px solid #3b82f6';
  el.style.outlineOffset = '1px';
}

export function unhighlightField(el: HTMLElement): void {
  highlightedFields.delete(el);
  el.style.outline = '';
  el.style.outlineOffset = '';
}

export function clearHighlights(): void {
  for (const el of highlightedFields) {
    el.style.outline = '';
    el.style.outlineOffset = '';
  }
  highlightedFields.clear();

  const highlighted = document.documentElement?.querySelectorAll('[style*="outline"]') ?? [];
  highlighted.forEach(el => {
    if (el instanceof HTMLElement && el.style.outline.includes('#3b82f6')) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  });
}

export function showAnswerCard(
  field: DetectedField,
  fieldEl: Element,
  callbacks: {
    onApprove: (approved: boolean) => void;
    onInsert: () => void;
    onUndo: () => void;
    onCopy: () => void;
    onRegenerate: () => void;
    onShorter: () => void;
    onLonger: () => void;
    onCasual: () => void;
    onFormal: () => void;
    onStop: () => void;
    onClose: () => void;
  }
): void {
  closeAnswerCard();

  const host = document.createElement('div');
  host.id = '__sr-card-root';
  registerThemeHost(host);
  host.style.cssText = 'all:initial';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = CARD_HTML;

  const rect = fieldEl.getBoundingClientRect();
  const cardDiv = shadow.getElementById('__sr-card') as HTMLElement;
  cardDiv.style.left = Math.min(rect.right + 8, window.innerWidth - 300) + 'px';
  cardDiv.style.top = Math.min(rect.top, window.innerHeight - 250) + 'px';
  if (rect.top < 100) cardDiv.style.top = (rect.bottom + 8) + 'px';

  (shadow.getElementById('__sr-card-label') as HTMLElement).textContent = fieldDisplayLabel(field);
  const contextParts: string[] = [];
  if (field.sectionHeading) contextParts.push(field.sectionHeading);
  if (field.currentValue) contextParts.push(`Current: ${field.currentValue.substring(0, 80)}`);
  contextParts.push(field.type === 'textarea' || field.type === 'richtext' ? 'Long text' : 'Short text');
  const contextEl = shadow.getElementById('__sr-card-context') as HTMLElement;
  contextEl.textContent = contextParts.join(' · ');
  contextEl.title = field.selector;

  const answerEl = shadow.getElementById('__sr-card-answer') as HTMLTextAreaElement;
  answerEl.value = '';
  answerEl.readOnly = true;
  answerEl.classList.remove('loading');

  const approveEl = shadow.getElementById('__sr-card-approve') as HTMLInputElement;
  const insertEl = shadow.getElementById('__sr-card-insert') as HTMLButtonElement;
  approveEl.addEventListener('change', () => {
    insertEl.disabled = !approveEl.checked;
    callbacks.onApprove(approveEl.checked);
  });
  shadow.getElementById('__sr-card-insert')?.addEventListener('click', callbacks.onInsert);
  shadow.getElementById('__sr-card-stop')?.addEventListener('click', callbacks.onStop);
  shadow.getElementById('__sr-card-undo')?.addEventListener('click', callbacks.onUndo);
  shadow.getElementById('__sr-card-copy')?.addEventListener('click', callbacks.onCopy);
  shadow.getElementById('__sr-card-regenerate')?.addEventListener('click', callbacks.onRegenerate);
  shadow.getElementById('__sr-card-shorter')?.addEventListener('click', callbacks.onShorter);
  shadow.getElementById('__sr-card-longer')?.addEventListener('click', callbacks.onLonger);
  shadow.getElementById('__sr-card-casual')?.addEventListener('click', callbacks.onCasual);
  shadow.getElementById('__sr-card-formal')?.addEventListener('click', callbacks.onFormal);
  shadow.getElementById('__sr-card-close')?.addEventListener('click', () => {
    closeAnswerCard();
    callbacks.onClose();
  });

  document.documentElement?.appendChild(host);

  activeCard = { el: host, root: shadow, fieldId: field.id };
}

export function updateAnswerCard(
  answer: string,
  sources: string[],
  status?: string,
  flags?: string[],
  streaming?: boolean,
  usage?: GenerationUsage,
  source?: AnswerProvenance | null
): void {
  if (!activeCard) return;
  const answerEl = activeCard.root.getElementById('__sr-card-answer') as HTMLTextAreaElement | null;
  if (answerEl) {
    answerEl.value = answer;
    answerEl.readOnly = Boolean(streaming);
    if (streaming) {
      answerEl.classList.add('loading');
    } else {
      answerEl.classList.remove('loading');
    }
  }

  const stopEl = activeCard.root.getElementById('__sr-card-stop') as HTMLElement | null;
  if (stopEl) stopEl.style.display = streaming ? '' : 'none';

  const flagsEl = activeCard.root.getElementById('__sr-card-flags') as HTMLElement;
  if (flagsEl) {
    flagsEl.textContent = '';
    if (flags && flags.length > 0) {
      const title = document.createElement('div');
      title.className = 'flag-title';
      title.textContent = 'Missing information (NEEDS INPUT)';
      flagsEl.appendChild(title);
      for (const flag of flags) {
        const el = document.createElement('div');
        el.className = 'flag';
        el.textContent = flag;
        flagsEl.appendChild(el);
      }
    }
  }

  const sourcesEl = activeCard.root.getElementById('__sr-card-sources') as HTMLElement;
  sourcesEl.textContent = sources && sources.length > 0 ? 'Sources: ' + sources.join(', ') : '';

  const usageEl = activeCard.root.getElementById('__sr-card-usage') as HTMLElement | null;
  if (usageEl) {
    if (usage) {
      const cost = usage.costUsd !== undefined ? ` · Est. ${formatCost(usage.costUsd)}` : '';
      usageEl.textContent = `${usage.estimated ? '~' : ''}${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out${cost}`;
    } else {
      usageEl.textContent = '';
    }
  }
  const sourceEl = activeCard.root.getElementById('__sr-card-source') as HTMLElement | null;
  if (sourceEl) {
    if (source) {
      sourceEl.style.display = '';
      sourceEl.className = source === 'llm' ? 'source-chip source-llm' : 'source-chip';
      sourceEl.textContent = source === 'vault' ? 'Vault' : source === 'history' ? 'History' : 'LLM';
    } else {
      sourceEl.style.display = 'none';
    }
  }
  if (status) {
    const statusEl = activeCard.root.getElementById('__sr-card-status') as HTMLElement;
    statusEl.textContent = status;
    statusEl.className = '';
    const cls =
      status === 'Inserted' ? 'status-inserted' :
      status === 'Skipped' || status === 'Cancelled' ? 'status-skipped' :
      status === 'Error' ? 'status-error' :
      'status-draft';
    statusEl.classList.add('status-badge', cls);
  }
}

export function closeAnswerCard(): void {
  if (activeCard) {
    activeCard.el.remove();
    activeCard = null;
  }
}

export function getActiveCardFieldId(): string | null {
  return activeCard?.fieldId ?? null;
}

export function getCardAnswerText(): string {
  const el = activeCard?.root.getElementById('__sr-card-answer') as HTMLTextAreaElement | null;
  return el?.value ?? '';
}

export function setCardAnswerText(text: string): void {
  const el = activeCard?.root.getElementById('__sr-card-answer') as HTMLTextAreaElement | null;
  if (el && el.value !== text) el.value = text;
}

export function setCardApproved(approved: boolean): void {
  const checkbox = activeCard?.root.getElementById('__sr-card-approve') as HTMLInputElement | null;
  const insert = activeCard?.root.getElementById('__sr-card-insert') as HTMLButtonElement | null;
  if (checkbox) checkbox.checked = approved;
  if (insert) insert.disabled = !approved;
}

export function isUITarget(el: Element): boolean {
  if (el.id === '__sr-root' || el.id === '__sr-card-root' || el.id === '__sr-doc-backdrop') return true;
  const parent = el.closest('#__sr-root, #__sr-card-root, #__sr-doc-backdrop');
  return parent !== null;
}

/* ------------------------- Document modal (cover letter / video script) ------------------------- */

export interface DocModalHandle {
  setTitle(title: string): void;
  update(text: string, streaming: boolean): void;
  setNote(note: string): void;
  getText(): string;
  close(): void;
}

export function showDocModal(
  title: string,
  onCopy: (text: string) => void,
  onDownload: (text: string) => void,
  onSaveVault: (text: string) => void,
  onRetry: () => void,
  onClose: () => void
): DocModalHandle {
  closeDocModal();

  const host = document.createElement('div');
  host.id = '__sr-doc-root';
  registerThemeHost(host);
  host.style.cssText = 'all:initial';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = DOC_HTML;

  const titleEl = shadow.getElementById('__sr-doc-title') as HTMLElement;
  const bodyEl = shadow.getElementById('__sr-doc-body') as HTMLElement;
  const noteEl = shadow.getElementById('__sr-doc-note') as HTMLElement;

  titleEl.textContent = title;
  bodyEl.textContent = 'Generating…';
  bodyEl.classList.add('loading');

  shadow.getElementById('__sr-doc-close')?.addEventListener('click', () => {
    closeDocModal();
    onClose();
  });
  shadow.getElementById('__sr-doc-copy')?.addEventListener('click', () => onCopy(bodyEl.textContent ?? ''));
  shadow.getElementById('__sr-doc-download')?.addEventListener('click', () => onDownload(bodyEl.textContent ?? ''));
  shadow.getElementById('__sr-doc-save-vault')?.addEventListener('click', () => onSaveVault(bodyEl.textContent ?? ''));
  shadow.getElementById('__sr-doc-retry')?.addEventListener('click', () => onRetry());

  document.documentElement?.appendChild(host);

  return {
    setTitle: t => { titleEl.textContent = t; },
    update: (text, streaming) => {
      bodyEl.textContent = text;
      if (streaming) bodyEl.classList.add('loading');
      else bodyEl.classList.remove('loading');
    },
    setNote: n => { noteEl.textContent = n; },
    getText: () => bodyEl.textContent ?? '',
    close: () => closeDocModal(),
  };
}

export function closeDocModal(): void {
  document.documentElement?.querySelector('#__sr-doc-root')?.remove();
}

const TRIAGE_HTML = `
<style>
  :host { all: initial; }
  #__sr-triage-backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(15,23,42,0.35); display: flex;
    align-items: center; justify-content: center; padding: 24px;
    font: 14px/1.5 system-ui, sans-serif;
  }
  #__sr-triage {
    background: #fff; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.25);
    width: min(560px, 100%); max-height: 80vh; display: flex; flex-direction: column;
    color: #111;
  }
  #__sr-triage .triage-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
  }
  #__sr-triage .triage-title { font-size: 15px; font-weight: 700; }
  #__sr-triage .triage-close {
    border: 0; background: transparent; cursor: pointer; font-size: 20px; color: #4b5563; line-height: 1;
  }
  #__sr-triage .triage-summary {
    padding: 10px 16px; font-size: 13px; color: #374151; border-bottom: 1px solid #e5e7eb;
  }
  #__sr-triage .triage-list { overflow-y: auto; padding: 6px 16px; }
  #__sr-triage .triage-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 8px 0; border-bottom: 1px solid #f3f4f6;
  }
  #__sr-triage .triage-item:last-child { border-bottom: 0; }
  #__sr-triage .triage-item input { width: 18px; height: 18px; margin-top: 2px; }
  #__sr-triage .triage-label { font-size: 13px; font-weight: 600; }
  #__sr-triage .triage-meta { font-size: 12px; color: #4b5563; }
  #__sr-triage .triage-foot {
    display: flex; gap: 8px; justify-content: flex-end;
    padding: 12px 16px; border-top: 1px solid #e5e7eb;
  }
  #__sr-triage .triage-foot button {
    font-size: 13px; min-height: 40px; padding: 8px 14px; border: 0; border-radius: 6px;
    cursor: pointer; background: #f3f4f6; color: #374151;
  }
  #__sr-triage .triage-foot button.primary { background: #2563eb; color: #fff; }
  #__sr-triage .triage-foot button.primary:disabled { background: #9ca3af; cursor: not-allowed; }
  #__sr-triage .triage-close:focus-visible,
  #__sr-triage .triage-foot button:focus-visible,
  #__sr-triage .triage-item input:focus-visible {
    outline: 2px solid #1d4ed8; outline-offset: 2px;
  }
  :host([data-sr-dark]) #__sr-triage {background: #111827; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-triage .triage-head, :host([data-sr-dark]) #__sr-triage .triage-summary, :host([data-sr-dark]) #__sr-triage .triage-foot {border-color: #1f2937; }
  :host([data-sr-dark]) #__sr-triage .triage-summary, :host([data-sr-dark]) #__sr-triage .triage-meta {color: #9ca3af; }
  :host([data-sr-dark]) #__sr-triage .triage-item {border-color: #1f2937; }
  :host([data-sr-dark]) #__sr-triage .triage-foot button {background: #1f2937; color: #e5e7eb; }
  :host([data-sr-dark]) #__sr-triage .triage-foot button.primary {background: #2563eb; color: #fff; }
  :host([data-sr-dark]) #__sr-triage .triage-close {color: #9ca3af; }
</style>
<div id="__sr-triage-backdrop">
  <div id="__sr-triage" role="dialog" aria-modal="true" aria-labelledby="__sr-triage-title">
    <div class="triage-head">
      <span class="triage-title" id="__sr-triage-title">Draft open-ended questions</span>
      <button class="triage-close" id="__sr-triage-close" aria-label="Close">&times;</button>
    </div>
    <div class="triage-summary" id="__sr-triage-summary" aria-live="polite"></div>
    <div class="triage-list" id="__sr-triage-list"></div>
    <div class="triage-foot">
      <button id="__sr-triage-cancel">Cancel</button>
      <button class="primary" id="__sr-triage-draft">Draft selected</button>
    </div>
  </div>
</div>
`;

export interface TriageItem {
  id: string;
  label: string;
  estimateTokens: number;
}

export function showTriageModal(
  items: TriageItem[],
  onDraft: (ids: string[]) => void
): void {
  document.documentElement?.querySelector('#__sr-triage-root')?.remove();

  const host = document.createElement('div');
  host.id = '__sr-triage-root';
  registerThemeHost(host);
  host.style.cssText = 'all:initial';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = TRIAGE_HTML;

  const listEl = shadow.getElementById('__sr-triage-list') as HTMLElement;
  const summaryEl = shadow.getElementById('__sr-triage-summary') as HTMLElement;
  const draftBtn = shadow.getElementById('__sr-triage-draft') as HTMLButtonElement;
  const selected = new Set(items.map(item => item.id));
  const checkboxes: HTMLInputElement[] = [];
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusable = () => Array.from(
    shadow.querySelectorAll<HTMLElement>('input, button:not([disabled])')
  ).filter(element => element.offsetParent !== null);

  const updateSummary = () => {
    const count = selected.size;
    const tokens = items
      .filter(item => selected.has(item.id))
      .reduce((sum, item) => sum + item.estimateTokens, 0);
    summaryEl.textContent = count === 0
      ? 'No questions selected.'
      : `${count} selected · ~${formatTokens(tokens)} input tokens, one request each.`;
    draftBtn.disabled = count === 0;
    draftBtn.textContent = count === 0 ? 'Draft selected' : `Draft ${count} selected`;
  };

  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'triage-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(item.id);
      else selected.delete(item.id);
      updateSummary();
    });
    checkboxes.push(checkbox);

    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'triage-label';
    title.textContent = item.label || '(untitled field)';
    const meta = document.createElement('span');
    meta.className = 'triage-meta';
    meta.textContent = `~${formatTokens(item.estimateTokens)} input tokens`;
    text.appendChild(title);
    text.appendChild(document.createElement('br'));
    text.appendChild(meta);

    label.appendChild(checkbox);
    label.appendChild(text);
    listEl.appendChild(label);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusable();
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close(): void {
    document.removeEventListener('keydown', onKeyDown);
    host.remove();
    previousFocus?.focus();
  }

  shadow.getElementById('__sr-triage-close')?.addEventListener('click', close);
  shadow.getElementById('__sr-triage-cancel')?.addEventListener('click', close);
  draftBtn.addEventListener('click', () => {
    const ids = [...selected];
    close();
    if (ids.length > 0) onDraft(ids);
  });
  shadow.getElementById('__sr-triage-backdrop')?.addEventListener('mousedown', event => {
    if (event.target === shadow.getElementById('__sr-triage-backdrop')) close();
  });

  document.addEventListener('keydown', onKeyDown);
  document.documentElement?.appendChild(host);
  updateSummary();
  checkboxes[0]?.focus();
}

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)?.set;

const NATIVE_TEXTAREA_SETTER = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
)?.set;

const NATIVE_SELECT_SETTER = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype, 'value'
)?.set;

interface FillResult {
  previousValue: string;
  success: boolean;
}

const undoStack = new Map<string, string>();

export function getUndoValue(selector: string): string | null {
  return undoStack.get(selector) ?? null;
}

export function clearUndo(selector: string): void {
  undoStack.delete(selector);
}

export function fillField(el: HTMLElement, value: string): FillResult | null {
  if (!el) return null;

  if (el instanceof HTMLInputElement) {
    return fillInput(el, value);
  }

  if (el instanceof HTMLTextAreaElement) {
    return fillTextArea(el, value);
  }

  if (el instanceof HTMLSelectElement) {
    return fillSelect(el, value);
  }

  if (el.contentEditable === 'true') {
    return fillContentEditable(el, value);
  }

  return null;
}

export function fillInput(el: HTMLInputElement, value: string): FillResult {
  const previousValue = el.value;
  const readonly = el.readOnly || el.disabled;

  if (!readonly && NATIVE_VALUE_SETTER) {
    NATIVE_VALUE_SETTER.call(el, value);
  } else {
    el.value = value;
  }

  if (el.maxLength > 0 && value.length > el.maxLength) {
    if (!readonly && NATIVE_VALUE_SETTER) {
      NATIVE_VALUE_SETTER.call(el, value.substring(0, el.maxLength));
    } else {
      el.value = value.substring(0, el.maxLength);
    }
  }

  dispatchEvents(el, previousValue);

  if (previousValue !== el.value) {
    const selector = buildDataSelector(el);
    if (selector) undoStack.set(selector, previousValue);
  }

  return { previousValue, success: true };
}

export function fillTextArea(el: HTMLTextAreaElement, value: string): FillResult {
  const previousValue = el.value;

  if (NATIVE_TEXTAREA_SETTER) {
    NATIVE_TEXTAREA_SETTER.call(el, value);
  } else {
    el.value = value;
  }

  if (el.maxLength > 0 && value.length > el.maxLength) {
    if (NATIVE_TEXTAREA_SETTER) {
      NATIVE_TEXTAREA_SETTER.call(el, value.substring(0, el.maxLength));
    } else {
      el.value = value.substring(0, el.maxLength);
    }
  }

  dispatchEvents(el, previousValue);

  if (previousValue !== el.value) {
    const selector = buildDataSelector(el);
    if (selector) undoStack.set(selector, previousValue);
  }

  return { previousValue, success: true };
}

export function fillContentEditable(el: HTMLElement, value: string): FillResult {
  const previousValue = el.textContent ?? '';

  el.focus();
  el.textContent = value;

  dispatchEvents(el, previousValue);

  const selector = buildDataSelector(el);
  if (selector) undoStack.set(selector, previousValue);

  return { previousValue, success: true };
}

export function fillSelect(el: HTMLSelectElement, value: string): FillResult {
  const previousValue = el.value;
  const option = findOption(el, value);

  if (!option) return { previousValue, success: false };

  if (NATIVE_SELECT_SETTER) {
    NATIVE_SELECT_SETTER.call(el, option.value);
  } else {
    el.value = option.value;
  }

  dispatchEvents(el, previousValue);

  if (previousValue !== el.value) {
    const selector = buildDataSelector(el);
    if (selector) undoStack.set(selector, previousValue);
  }

  return { previousValue, success: true };
}

function findOption(el: HTMLSelectElement, value: string): HTMLOptionElement | null {
  const target = value.trim().toLowerCase();
  if (!target) return null;

  const options = Array.from(el.options).filter(o => !o.disabled && o.value !== '');
  const textOf = (o: HTMLOptionElement) => (o.textContent ?? '').trim().toLowerCase();

  const matches: Array<(o: HTMLOptionElement) => boolean> = [
    o => o.value.toLowerCase() === target,
    o => textOf(o) === target,
    o => o.value.toLowerCase().includes(target),
    o => textOf(o).includes(target),
    o => target.includes(textOf(o)) && textOf(o).length > 2,
  ];

  for (const match of matches) {
    const found = options.find(match);
    if (found) return found;
  }

  if (/\b(h-?1b|h-?4|l-?1|f-?1|opt|tn|e-?3|j-?1|o-?1|visa|sponsor)/i.test(target)) {
    return options.find(o => /\bvisa|sponsor/i.test(textOf(o) + ' ' + o.value)) ?? null;
  }

  return null;
}

export function undoFill(el: HTMLElement): FillResult | null {
  if (!el) return null;
  const selector = buildDataSelector(el);
  if (!selector) return null;
  const previousValue = undoStack.get(selector);
  if (previousValue === undefined) return null;

  undoStack.delete(selector);
  return fillField(el, previousValue);
}

function dispatchEvents(el: HTMLElement, previousValue: string): void {
  const inputEvent = new Event('input', { bubbles: true, cancelable: true });
  el.dispatchEvent(inputEvent);

  const changeEvent = new Event('change', { bubbles: true, cancelable: true });
  el.dispatchEvent(changeEvent);
}

function buildDataSelector(el: HTMLElement): string | null {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const name = el.getAttribute('name');
  if (name) return `[name="${CSS.escape(name)}"]`;
  return null;
}
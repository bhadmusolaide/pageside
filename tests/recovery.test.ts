import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintFieldValue,
  isRecoveredDraftStale,
  normalizeRecoveryChat,
  normalizeRecoveryDrafts,
  pageRecoveryStorageKey,
  type RecoveredDraft,
} from '../src/lib/recovery.ts';

function draft(overrides: Partial<RecoveredDraft> = {}): RecoveredDraft {
  return {
    frameId: 0,
    fieldId: 'id:why-us',
    fieldType: 'textarea',
    label: 'Why do you want this role?',
    selector: '#why-us',
    valueFingerprint: fingerprintFieldValue(''),
    draft: 'A grounded answer',
    source: 'llm',
    sources: ['Resume'],
    sourceDetails: [{ id: 1, title: 'Resume', type: 'resume', excerpt: 'Grounded evidence.' }],
    flags: [],
    usage: null,
    updatedAt: 1,
    ...overrides,
  };
}

test('page recovery keys distinguish query-specific application pages without storing URLs', () => {
  const first = pageRecoveryStorageKey('https://jobs.example/apply?id=one#form');
  const second = pageRecoveryStorageKey('https://jobs.example/apply?id=two#form');
  assert.notEqual(first, second);
  assert.equal(first.startsWith('sr-page-recovery-'), true);
  assert.equal(first.includes('jobs.example'), false);
});

test('field fingerprints are stable and change with field values', () => {
  assert.equal(fingerprintFieldValue('current answer'), fingerprintFieldValue('current answer'));
  assert.notEqual(fingerprintFieldValue('current answer'), fingerprintFieldValue('changed answer'));
});

test('recovered drafts are stale when value, selector, label, or type changes', () => {
  const saved = draft();
  const current = {
    type: 'textarea' as const,
    label: saved.label,
    placeholder: null,
    selector: saved.selector,
    currentValue: '',
  };
  assert.equal(isRecoveredDraftStale(saved, current), false);
  assert.equal(isRecoveredDraftStale(saved, { ...current, currentValue: 'new value' }), true);
  assert.equal(isRecoveredDraftStale(saved, { ...current, selector: '#moved' }), true);
  assert.equal(isRecoveredDraftStale(saved, { ...current, label: 'Updated question' }), true);
  assert.equal(isRecoveredDraftStale(saved, { ...current, type: 'input' }), true);
});

test('saved drafts are deduplicated and bounded', () => {
  const deduplicated = normalizeRecoveryDrafts([
    draft({ draft: 'older', updatedAt: 1 }),
    draft({ draft: 'newer', updatedAt: 2 }),
  ]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].draft, 'newer');
  assert.equal(normalizeRecoveryDrafts(
    Array.from({ length: 110 }, (_, index) => draft({
      fieldId: `field-${index}`,
      updatedAt: index,
    }))
  ).length, 100);
});

test('chat normalization caps history and marks interrupted assistant output', () => {
  const normalized = normalizeRecoveryChat([
    { id: 'user', role: 'user', text: 'Question', sources: [] },
    { id: 'assistant', role: 'assistant', text: 'Partial response', sources: [], pending: true },
  ]);
  assert.equal(normalized[1].pending, undefined);
  assert.equal(normalized[1].stopped, true);
  assert.match(normalized[1].error ?? '', /interrupted/i);
  assert.equal(normalizeRecoveryChat(
    Array.from({ length: 70 }, (_, index) => ({
      id: String(index),
      role: 'user' as const,
      text: `Message ${index}`,
      sources: [],
    }))
  ).length, 60);
});

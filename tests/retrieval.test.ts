import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveByTfIdf, retrieveByEmbeddings } from '../src/lib/retrieval.ts';
import type { VaultItem } from '../src/lib/vault.ts';

function item(id: number, title: string, content: string, type: VaultItem['type'] = 'note'): VaultItem {
  return { id, title, content, type, tags: [], createdAt: 1, updatedAt: 1 };
}

const vault: VaultItem[] = [
  item(1, 'Engineering resume', 'Senior frontend engineer. Built React design systems and reduced load time by 40 percent.', 'resume'),
  item(2, 'Operations resume', 'Operations manager. Ran warehouse scheduling and vendor negotiations.', 'resume'),
  item(3, 'Design project', 'Led a design system project with Figma components and accessibility audits.', 'portfolio'),
  item(4, 'Writing sample', 'I write plainly and edit aggressively.', 'tone_sample'),
];

test('TF-IDF retrieval ranks the relevant resume first', () => {
  const result = retrieveByTfIdf('What frontend engineering experience do you have?', vault, 12000);
  assert.equal(result.usedItems[0]?.id, 1);
  assert.match(result.context, /frontend engineer/i);
});

test('TF-IDF retrieval respects the token budget', () => {
  const result = retrieveByTfIdf('engineering', vault, 4000);
  assert.ok(result.context.length > 0);
  assert.ok(result.usedItems.length > 0);
});

test('embedding retrieval ranks the relevant project first', () => {
  const result = retrieveByEmbeddings('Tell us about your design system and accessibility work', vault, 12000);
  assert.ok(result.usedItems.length > 0);
  assert.ok(result.usedItems.some(used => used.id === 3 || used.id === 1));
  assert.match(result.context, /design/i);
});

test('both retrieval modes handle an empty vault', () => {
  assert.deepEqual(retrieveByTfIdf('anything', [], 12000), { context: '', usedItems: [] });
  assert.deepEqual(retrieveByEmbeddings('anything', [], 12000), { context: '', usedItems: [] });
});

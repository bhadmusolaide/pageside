import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTextFromFile } from '../src/lib/documentImport.ts';

test('extracts plain text files', async () => {
  const file = new File(['Jane Doe\nSenior Engineer'], 'resume.txt', { type: 'text/plain' });
  const text = await extractTextFromFile(file);
  assert.equal(text, 'Jane Doe\nSenior Engineer');
});

test('rejects unsupported file types', async () => {
  const file = new File(['binary'], 'resume.doc', { type: 'application/msword' });
  await assert.rejects(() => extractTextFromFile(file), /Unsupported file type/);
});

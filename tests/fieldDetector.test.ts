import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredJobPosting } from '../src/lib/fieldDetector.ts';

test('extracts company, title, and description from JSON-LD @graph', () => {
  const scripts = [
    JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'BreadcrumbList' }] }),
    JSON.stringify({
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title: 'Support Engineer ',
      hiringOrganization: { '@type': 'Organization', name: 'Supabase' },
      description: '<p>The role of a Support Engineer at Supabase</p><p>We are seeking engineers.</p>',
    }),
  ];

  const result = parseStructuredJobPosting(scripts);
  assert.equal(result?.title, 'Support Engineer');
  assert.equal(result?.company, 'Supabase');
  assert.match(result?.description ?? '', /Support Engineer at Supabase/);
  assert.match(result?.description ?? '', /We are seeking engineers/);
  assert.ok((result?.description ?? '').includes('\n'));
});

test('tolerates raw control characters inside JSON-LD strings', () => {
  const invalid = `{"@type":"JobPosting","title":"Support Engineer","hiringOrganization":"Acme","description":"line one
line two &amp; more"}`;

  const result = parseStructuredJobPosting([invalid]);
  assert.equal(result?.company, 'Acme');
  assert.match(result?.description ?? '', /line one\nline two & more/);
});

test('returns null when no JobPosting is present', () => {
  const result = parseStructuredJobPosting([
    JSON.stringify({ '@type': 'Organization', name: 'Remote Career' }),
  ]);
  assert.equal(result, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyField, type DetectedField, type PageContext } from '../src/lib/fieldDetector.ts';
import {
  buildSystemPrompt,
  buildUserPrompt,
  extractSourceExcerpt,
  selectRelevantVaultItems,
} from '../src/lib/promptBuilder.ts';
import { PROVIDERS } from '../src/lib/provider.ts';
import { outputBudgetFor } from '../src/lib/usage.ts';
import { extractNeedsInputFlags, sanitizeAnswerStyle } from '../src/lib/answerText.ts';
import type { VaultItem } from '../src/lib/vault.ts';

const pageContext: PageContext = {
  title: 'Customer Success Engineer at ExampleCo',
  url: 'https://jobs.example/apply',
  visibleText: '',
  companyName: 'ExampleCo',
  jobTitle: 'Customer Success Engineer',
  jobDescription: 'Help customers adopt the product and improve their onboarding experience.',
};

const syntheticVault: VaultItem[] = [
  {
    id: 1,
    type: 'portfolio',
    title: 'Onboarding refresh',
    content: 'I redesigned the onboarding checklist and reduced setup time from two days to four hours.',
    tags: ['onboarding', 'customer success'],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 2,
    type: 'note',
    title: 'Volunteer interests',
    content: 'I volunteer at a neighborhood garden on weekends.',
    tags: ['volunteer'],
    createdAt: 1,
    updatedAt: 1,
  },
];

const baseField: DetectedField = {
  id: 'id:experience',
  type: 'textarea',
  inputType: undefined,
  label: 'Describe a project that improved customer onboarding',
  sectionHeading: null,
  placeholder: null,
  currentValue: '',
  maxLength: 500,
  required: true,
  selector: '#experience',
  tagName: 'textarea',
  name: 'experience',
  attributes: {},
};

test('grounding scenario selects synthetic evidence and includes anti-fabrication rules', () => {
  const { context, usedItems } = selectRelevantVaultItems(
    'Describe a project that improved customer onboarding',
    syntheticVault,
    1000,
    'keyword'
  );
  const system = buildSystemPrompt('professional', 120, 'en');
  const user = buildUserPrompt(baseField.label!, pageContext, context);

  assert.equal(usedItems[0].id, 1);
  assert.match(context, /reduced setup time from two days to four hours/i);
  assert.match(extractSourceExcerpt('improved customer onboarding', syntheticVault[0].content), /reduced setup time/i);
  assert.match(system, /Do NOT invent facts/i);
  assert.match(system, /NEEDS INPUT/i);
  assert.match(user, /Question: Describe a project/i);
  assert.match(user, /Relevant background information/);
});

test('source excerpts select relevant passages and stay within the display limit', () => {
  const content = [
    'I enjoy learning new tools and collaborating with colleagues.',
    'I redesigned the onboarding checklist and reduced setup time from two days to four hours.',
    'I am also interested in mentoring new teammates.',
  ].join('\n\n');
  const excerpt = extractSourceExcerpt('project that improved customer onboarding', content, 70);

  assert.match(excerpt, /redesigned the onboarding checklist/i);
  assert.ok(excerpt.length <= 70);
  assert.ok(excerpt.endsWith('…'));
});

test('partially supported answers identify each missing fact separately', () => {
  const system = buildSystemPrompt('professional', 120, 'en');
  const answer = sanitizeAnswerStyle(
    'I improved onboarding with a clearer checklist. NEEDS INPUT: the number of users affected.\nNEEDS INPUT: the project date.'
  );
  const flags = extractNeedsInputFlags(answer);
  assert.match(system, /answer part of the question but a specific requested fact is missing/i);
  assert.deepEqual(flags, ['the number of users affected', 'the project date']);
});

test('missing-information scenario never supplies fabricated personal facts', () => {
  const { context, usedItems } = selectRelevantVaultItems(
    'What salary do you expect?',
    [],
    1000,
    'keyword'
  );
  const system = buildSystemPrompt('professional', 80, 'en');
  const user = buildUserPrompt('What salary do you expect?', pageContext, context);

  assert.equal(context, '');
  assert.deepEqual(usedItems, []);
  assert.match(system, /NEEDS INPUT: <what is missing>/);
  assert.match(user, /Question: What salary do you expect/);
  assert.doesNotMatch(user, /\$[\d,]+/);
});

test('factual and open-ended field classification scenario remains distinct', () => {
  assert.equal(classifyField({ ...baseField, type: 'input', label: 'Email address', inputType: 'email' }), 'factual');
  assert.equal(classifyField(baseField), 'open_ended');
});

test('all provider request builders accept the same bounded synthetic answer scenario', () => {
  const system = buildSystemPrompt('professional', 120, 'en');
  const user = buildUserPrompt(baseField.label!, pageContext, 'Synthetic evidence: setup time fell from two days to four hours.');
  const maxTokens = outputBudgetFor(120);

  for (const [providerName, provider] of Object.entries(PROVIDERS)) {
    const body = provider.buildBody({
      model: providerName === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4o-mini',
      maxTokens,
      stream: true,
      system,
      messages: [{ role: 'user', content: user }],
    }) as Record<string, unknown>;

    assert.equal(body.stream, true, `${providerName} stream setting`);
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.ok(Array.isArray(messages) && messages.length > 0, `${providerName} messages`);
    assert.ok(
      messages.some(message => message.content.includes('Synthetic evidence')),
      `${providerName} receives the same grounded scenario`
    );
    assert.equal(
      body.max_tokens ?? body.max_completion_tokens,
      maxTokens,
      `${providerName} output budget`
    );
    if (providerName === 'anthropic') {
      assert.equal(body.system, system);
    } else {
      assert.ok(messages.some(message => message.role === 'system' && message.content === system));
    }
  }
});

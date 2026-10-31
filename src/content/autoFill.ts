import type { VaultItem } from '../lib/vault';
import type { DetectedField } from '../lib/fieldDetector';
import { extractEmail, extractPhone, extractUrl, extractName } from '../lib/promptBuilder';

export function findValueForField(field: DetectedField, vaultItems: VaultItem[]): string | null {
  const label = (field.label ?? '').toLowerCase();
  const placeholder = (field.placeholder ?? '').toLowerCase();
  const name = (field.name ?? '').toLowerCase();
  const combined = `${label} ${placeholder} ${name}`;

  const allText = vaultItems.map(i => i.content).join('\n\n');

  if (/\bemail\b/.test(combined) || /\be-?mail\b/.test(combined)) {
    const email = extractEmail(allText);
    if (email) return email;
  }

  if (/\bphone\b/.test(combined) || /\bmobile\b/.test(combined) || /\btel(e?phone)?\b/.test(combined)) {
    const phone = extractPhone(allText);
    if (phone) return phone;
  }

  if (/\blinkedin\b/.test(combined)) {
    const linkedin = findUrl(allText, 'linkedin');
    if (linkedin) return linkedin;
  }

  if (/\bgithub\b/.test(combined)) {
    const github = findUrl(allText, 'github');
    if (github) return github;
  }

  if (/\bportfolio\b/.test(combined) || /\bwebsite\b/.test(combined) || /\burl\b/.test(combined)) {
    const url = extractUrl(allText);
    if (url) return url;
  }

  if (/\b(name|full.?name|first.?name|last.?name)\b/.test(combined)) {
    const name = extractName(allText);
    if (name) return name;
  }

  if (/\b(company|employer|current.?company)\b/.test(combined)) {
    const company = findCompany(vaultItems);
    if (company) return company;
  }

  if (/\b(title|role|position|job.?title)\b/.test(combined) && !/\bwhy\b/.test(combined) && !/\bdescribe\b/.test(combined)) {
    const title = findJobTitle(vaultItems);
    if (title) return title;
  }

  if (/\b(visa|sponsor|work.?authorization|work.?permit)\b/.test(combined)) {
    const visa = findVisaStatus(allText);
    if (visa) return visa;
  }

  if (/\b(pronoun|gender)\b/.test(combined)) {
    const pronoun = findPronoun(allText);
    if (pronoun) return pronoun;
  }

  if (/\b(hear|referral|found)\b/.test(combined) && /\b(about|how|where)\b/.test(combined)) {
    return null;
  }

  return null;
}

function findUrl(text: string, domain: string): string | null {
  const pattern = new RegExp(`https?://(www\\.)?${domain}[^\\s,;)]+`, 'i');
  const match = text.match(pattern);
  return match ? match[0] : null;
}

function findCompany(items: VaultItem[]): string | null {
  for (const item of items) {
    if (item.type === 'resume') {
      const lines = item.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 3 && trimmed.length < 80 && /\b(engineer|developer|manager|designer|analyst|scientist|intern|director|lead|head)\b/i.test(trimmed)) {
          const parts = trimmed.split(/\s{2,}|—|-|–\|/);
          return parts.length > 1 ? parts[parts.length - 1].trim() : null;
        }
      }
    }
  }
  return null;
}

function findJobTitle(items: VaultItem[]): string | null {
  for (const item of items) {
    if (item.type === 'resume') {
      const lines = item.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 3 && trimmed.length < 100 && /\b(engineer|developer|manager|designer|scientist|analyst|intern|director|lead|head|architect)\b/i.test(trimmed)) {
          return trimmed;
        }
      }
    }
  }
  return null;
}

function findVisaStatus(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bus citizen\b/.test(lower)) return 'US Citizen';
  if (/\bgreen card\b/.test(lower) || /\bpermanent resident\b/.test(lower)) return 'Permanent Resident';
  if (/\b(need|require|requires|requiring|seeking)\b[^.\n]{0,30}\bsponsor(ship)?\b/.test(lower)) return 'Need sponsorship';
  if (/\bvisa\b/.test(lower)) {
    const types = ['H-1B', 'L-1', 'F-1', 'OPT', 'TN', 'E-3', 'J-1', 'O-1'];
    for (const t of types) {
      if (text.includes(t)) return t;
    }
    return 'Visa holder';
  }
  return null;
}

function findPronoun(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bshe\/her\b/.test(lower)) return 'She/Her';
  if (/\bhe\/him\b/.test(lower)) return 'He/Him';
  if (/\bthey\/them\b/.test(lower)) return 'They/Them';
  return null;
}
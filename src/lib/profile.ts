import type { PageContext } from './fieldDetector';

export type ProfileMatchType = 'url' | 'company' | 'title';

export interface SiteProfile {
  id: string;
  name: string;
  matchType: ProfileMatchType;
  matchValue: string;
  tone?: string;
  maxLength?: number;
  language?: string;
  emphasis?: string;
  vaultProfileId?: string;
}

export function findMatchingProfile(
  profiles: SiteProfile[],
  context: Pick<PageContext, 'url' | 'companyName' | 'jobTitle'>
): SiteProfile | null {
  for (const profile of profiles) {
    if (matchesProfile(profile, context)) return profile;
  }
  return null;
}

export function matchesProfile(
  profile: SiteProfile,
  context: Pick<PageContext, 'url' | 'companyName' | 'jobTitle'>
): boolean {
  const value = profile.matchValue.trim();
  if (!value) return false;

  switch (profile.matchType) {
    case 'url':
      return context.url.toLowerCase().includes(value.toLowerCase());
    case 'company':
      return (context.companyName ?? '').toLowerCase().includes(value.toLowerCase());
    case 'title':
      return (context.jobTitle ?? '').toLowerCase().includes(value.toLowerCase());
    default:
      return false;
  }
}
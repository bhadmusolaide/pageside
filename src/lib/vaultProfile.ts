const PROFILES_KEY = 'sr-vault-profiles';
const ACTIVE_KEY = 'sr-active-vault-profile';
const DEFAULT_ID = 'default';

export interface VaultProfile {
  id: string;
  name: string;
}

export function defaultVaultProfile(): VaultProfile {
  return { id: DEFAULT_ID, name: 'Default' };
}

export async function getVaultProfiles(): Promise<VaultProfile[]> {
  if (typeof chrome === 'undefined' || !chrome.storage) return [defaultVaultProfile()];
  const data = await chrome.storage.local.get(PROFILES_KEY);
  const list = (data[PROFILES_KEY] as VaultProfile[]) ?? [];
  if (list.length === 0) return [defaultVaultProfile()];
  return list.some(p => p.id === DEFAULT_ID) ? list : [defaultVaultProfile(), ...list];
}

export async function getActiveVaultProfileId(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage) return DEFAULT_ID;
  const data = await chrome.storage.local.get({ [PROFILES_KEY]: [], [ACTIVE_KEY]: DEFAULT_ID });
  const list = (data[PROFILES_KEY] as VaultProfile[]) ?? [];
  const active = data[ACTIVE_KEY] as string;
  if (list.length === 0) return DEFAULT_ID;
  if (!list.some(p => p.id === active)) return list[0].id;
  return active;
}

export async function setActiveVaultProfileId(id: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  await chrome.storage.local.set({ [ACTIVE_KEY]: id });
}

export async function addVaultProfile(name: string): Promise<VaultProfile> {
  const list = await getVaultProfiles();
  const profile: VaultProfile = { id: crypto.randomUUID(), name: name.trim() || 'Untitled' };
  await chrome.storage.local.set({ [PROFILES_KEY]: [...list, profile] });
  return profile;
}

export async function renameVaultProfile(id: string, name: string): Promise<void> {
  if (id === DEFAULT_ID) return;
  const list = await getVaultProfiles();
  const next = list.map(p => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
  await chrome.storage.local.set({ [PROFILES_KEY]: next });
}

export async function deleteVaultProfile(id: string): Promise<void> {
  if (id === DEFAULT_ID) return;
  const list = await getVaultProfiles();
  const next = list.filter(p => p.id !== id);
  const data: Record<string, unknown> = { [PROFILES_KEY]: next };
  const active = await getActiveVaultProfileId();
  if (active === id) data[ACTIVE_KEY] = DEFAULT_ID;
  await chrome.storage.local.set(data);
}

const OVERRIDES_KEY = 'sr-vault-profile-overrides';

export async function getVaultProfileOverrides(): Promise<Record<string, string>> {
  if (typeof chrome === 'undefined' || !chrome.storage) return {};
  const data = await chrome.storage.local.get(OVERRIDES_KEY);
  return (data[OVERRIDES_KEY] as Record<string, string>) ?? {};
}

export async function getVaultProfileOverride(origin: string): Promise<string | null> {
  const overrides = await getVaultProfileOverrides();
  return overrides[origin] ?? null;
}

export async function setVaultProfileOverride(origin: string, profileId: string | null): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  const overrides = await getVaultProfileOverrides();
  if (profileId) {
    overrides[origin] = profileId;
  } else {
    delete overrides[origin];
  }
  await chrome.storage.local.set({ [OVERRIDES_KEY]: overrides });
}

export async function resolveVaultProfileId(
  origin: string,
  preferredId?: string | null
): Promise<string> {
  const profiles = await getVaultProfiles();
  const ids = new Set(profiles.map(profile => profile.id));

  const override = await getVaultProfileOverride(origin);
  if (override && ids.has(override)) return override;
  if (preferredId && ids.has(preferredId)) return preferredId;

  return getActiveVaultProfileId();
}

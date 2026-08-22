const CROWDIN_OTA_URL = (import.meta as any).env?.VITE_CROWDIN_OTA_URL || '';

export interface CrowdinTranslation {
  id: string;
  locale: string;
  key: string;
  value: string;
}

export class CrowdinIntegration {
  private distributionHash: string;

  constructor(distributionHash: string) {
    this.distributionHash = distributionHash;
  }

  async fetchTranslations(locale: string): Promise<Record<string, string>> {
    if (!CROWDIN_OTA_URL || !this.distributionHash) return {};
    try {
      const res = await fetch(
        `${CROWDIN_OTA_URL}/${this.distributionHash}/translations/${locale}.json`
      );
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  async fetchLanguages(): Promise<string[]> {
    if (!CROWDIN_OTA_URL || !this.distributionHash) return [];
    try {
      const res = await fetch(
        `${CROWDIN_OTA_URL}/${this.distributionHash}/languages.json`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.languages || [];
    } catch {
      return [];
    }
  }
}

export const crowdinClient = new CrowdinIntegration(
  (import.meta as any).env?.VITE_CROWDIN_DISTRIBUTION_HASH || ''
);

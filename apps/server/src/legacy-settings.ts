import fs from 'node:fs';
import path from 'node:path';
import { llmProviderSchema, httpUrlSchema } from '@what-if-history/contracts';
import type { Repository } from './db/repository.js';

export function importLegacySettings(repository: Repository, dataDirectory: string) {
  const filePath = path.join(dataDirectory, 'llm_settings.json');
  if (!fs.existsSync(filePath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const provider = llmProviderSchema.parse(raw.provider);
    const apiUrl = httpUrlSchema.parse(raw.apiUrl);
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
    const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'default';
    return repository.importLegacyLlmSettings({ provider, apiUrl, apiKey, model });
  } catch {
    return false;
  }
}

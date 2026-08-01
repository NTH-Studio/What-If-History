import type { LlmProviderName } from '@what-if-history/contracts';
import styles from '../../styles/App.module.css';

export const providers: LlmProviderName[] = [
  'lm-studio',
  'llama.cpp',
  'ollama',
  'vllm',
  'openai',
  'google',
  'anthropic',
];

export function Message({
  message,
  tone = 'error',
}: {
  message: string | undefined;
  tone?: 'error' | 'success' | undefined;
}) {
  return message ? (
    <p className={tone === 'error' ? styles.errorMessage : styles.successMessage} role="status">
      {message}
    </p>
  ) : null;
}

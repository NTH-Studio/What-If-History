import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LlmProviderName, LlmSettingsInput } from '@what-if-history/contracts';
import { api, ApiError } from '../../api';
import { Modal } from '../../components/Dialogs';
import { Message, providers } from './shared';
import styles from '../../styles/App.module.css';

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['llm-settings'],
    queryFn: api.llmSettings,
    enabled: open,
  });
  const [status, setStatus] = useState<{ text: string; tone: 'error' | 'success' }>();
  const saveMutation = useMutation({
    mutationFn: api.saveLlmSettings,
    onSuccess: async () => {
      setStatus({ text: t('settings.saved'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['llm-settings'] });
    },
    onError: () => setStatus({ text: t('common.error'), tone: 'error' }),
  });
  const testMutation = useMutation({
    mutationFn: api.testLlmSettings,
    onSuccess: () => setStatus({ text: t('settings.testSuccess'), tone: 'success' }),
    onError: (caught) =>
      setStatus({
        text: caught instanceof ApiError ? caught.problem.detail : t('common.error'),
        tone: 'error',
      }),
  });

  const submit = (element: HTMLFormElement, mode: 'save' | 'test') => {
    const form = new FormData(element);
    const apiKey = String(form.get('apiKey')).trim();
    const input: LlmSettingsInput = {
      provider: form.get('provider') as LlmProviderName,
      apiUrl: String(form.get('apiUrl')),
      model: String(form.get('model')),
      ...(apiKey ? { apiKey } : {}),
      clearApiKey: form.get('clearApiKey') === 'on',
    };
    if (mode === 'save') saveMutation.mutate(input);
    else testMutation.mutate(input);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      description={t('settings.description')}
    >
      {settings.data ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget, 'save');
          }}
        >
          {!settings.data.editable ? <Message message={t('settings.localOnly')} /> : null}
          <p className={styles.muted}>
            {t('settings.structuredOutput', {
              mode: t(`settings.structuredOutputModes.${settings.data.structuredOutputMode}`),
            })}
          </p>
          <label>
            <span>{t('settings.provider')}</span>
            <select
              name="provider"
              defaultValue={settings.data.provider}
              disabled={!settings.data.editable}
            >
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('settings.endpoint')}</span>
            <input
              name="apiUrl"
              type="url"
              defaultValue={settings.data.apiUrl}
              disabled={!settings.data.editable}
              required
            />
          </label>
          <label>
            <span>{t('settings.model')}</span>
            <input
              name="model"
              defaultValue={settings.data.model}
              disabled={!settings.data.editable}
              required
            />
          </label>
          <label>
            <span>{t('settings.apiKey')}</span>
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={settings.data.hasApiKey ? t('settings.keepKey') : ''}
              disabled={!settings.data.editable}
            />
          </label>
          {settings.data.hasApiKey ? (
            <label className={styles.checkLabel}>
              <input type="checkbox" name="clearApiKey" disabled={!settings.data.editable} />
              <span>{t('settings.clearKey')}</span>
            </label>
          ) : null}
          <Message message={status?.text} tone={status?.tone} />
          <footer className={styles.dialogActions}>
            <button
              type="button"
              className={styles.button}
              disabled={!settings.data.editable || testMutation.isPending}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (form) submit(form, 'test');
              }}
            >
              {t('settings.test')}
            </button>
            <button
              className={styles.primaryButton}
              disabled={!settings.data.editable || saveMutation.isPending}
            >
              {t('common.save')}
            </button>
          </footer>
        </form>
      ) : (
        <p>{t('common.loading')}</p>
      )}
    </Modal>
  );
}

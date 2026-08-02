import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CreatePresetInput } from '@what-if-history/contracts';
import { api } from '../../api';
import { Modal } from '../../components/Dialogs';
import styles from '../../styles/App.module.css';

export function NewPresetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (preset: Awaited<ReturnType<typeof api.createPreset>>) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api.createPreset({
        title: String(data.get('title')),
        summary: String(data.get('summary')),
        category: data.get('category') as CreatePresetInput['category'],
        tags: [],
        startDate: String(data.get('startDate')),
        worldContext: String(data.get('worldContext')),
        simulationRules: String(data.get('simulationRules')),
        recommendedDifficulty: 'normal',
        playableNationCodes: ['FRA'],
        aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
        prompts: [],
        helpers: [],
      });
    },
    onSuccess: async (preset) => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['presets'] });
      onCreated(preset);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('presets.createTitle')}
      description={t('presets.createDescription')}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(event.currentTarget);
        }}
      >
        <label>
          <span>{t('presets.title')}</span>
          <input name="title" maxLength={120} required autoFocus />
        </label>
        <label>
          <span>{t('presets.summary')}</span>
          <textarea name="summary" rows={3} maxLength={1_000} />
        </label>
        <div className={styles.formRow}>
          <label>
            <span>{t('presets.category')}</span>
            <select name="category" defaultValue="alternate_history">
              {(
                ['historical', 'alternate_history', 'fantasy', 'science_fiction', 'custom'] as const
              ).map((category) => (
                <option key={category} value={category}>
                  {t(`presets.categories.${category}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('presets.date')}</span>
            <input
              name="startDate"
              type="date"
              lang={i18n.resolvedLanguage ?? i18n.language}
              defaultValue="1936-01-01"
              required
            />
          </label>
        </div>
        <label>
          <span>{t('presets.context')}</span>
          <textarea
            name="worldContext"
            rows={6}
            maxLength={20_000}
            placeholder={t('presets.contextPlaceholder')}
            required
          />
        </label>
        <label>
          <span>{t('presets.rules')}</span>
          <textarea
            name="simulationRules"
            rows={4}
            maxLength={20_000}
            defaultValue={t('presets.defaultRules')}
            required
          />
        </label>
        <footer className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button className={styles.primaryButton} disabled={mutation.isPending}>
            {t('presets.openStudio')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

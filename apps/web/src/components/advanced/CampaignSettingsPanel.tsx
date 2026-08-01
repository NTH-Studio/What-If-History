import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Save, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Difficulty, Game, GameAiModels } from '@what-if-history/contracts';
import { api } from '../../api';
import { difficulties, PageHeader } from './shared';
import styles from '../../styles/App.module.css';

export function CampaignSettingsPanel({ game }: { game: Game }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (input: {
      difficulty: Difficulty;
      simulationRules: string;
      aiModels: GameAiModels;
    }) => api.updateGameConfig(game.id, input),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['game', game.id] });
    },
  });

  return (
    <div className={styles.pageStack}>
      <PageHeader
        eyebrow="CAMPAIGN · CONTROL"
        title={t('campaignSettings.title')}
        description={t('campaignSettings.description')}
      />
      <form
        className={`${styles.panel} ${styles.advancedForm}`}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          mutation.mutate({
            difficulty: data.get('difficulty') as Difficulty,
            simulationRules: String(data.get('simulationRules')),
            aiModels: {
              actions: String(data.get('actionsModel')).trim() || null,
              advisor: String(data.get('advisorModel')).trim() || null,
              diplomacy: String(data.get('diplomacyModel')).trim() || null,
              turns: String(data.get('turnsModel')).trim() || null,
            },
          });
        }}
      >
        <div className={styles.advancedGrid}>
          <section>
            <div className={styles.subsectionTitle}>
              <Settings2 size={18} />
              <h2>{t('campaignSettings.simulation')}</h2>
            </div>
            <label>
              <span>{t('campaignSettings.difficulty')}</span>
              <select name="difficulty" defaultValue={game.difficulty}>
                {difficulties.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {t(`difficulty.${difficulty}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('campaignSettings.rules')}</span>
              <textarea
                name="simulationRules"
                defaultValue={game.simulationRules}
                rows={12}
                maxLength={20_000}
                required
              />
              <small>{t('campaignSettings.rulesHelp')}</small>
            </label>
          </section>
          <section>
            <div className={styles.subsectionTitle}>
              <BrainCircuit size={18} />
              <h2>{t('campaignSettings.models')}</h2>
            </div>
            <p className={styles.muted}>{t('campaignSettings.modelsHelp')}</p>
            {(['actions', 'advisor', 'diplomacy', 'turns'] as const).map((mechanic) => (
              <label key={mechanic}>
                <span>{t(`campaignSettings.${mechanic}`)}</span>
                <input
                  name={`${mechanic}Model`}
                  defaultValue={game.aiModels[mechanic] ?? ''}
                  placeholder={t('campaignSettings.defaultModel')}
                  maxLength={200}
                />
              </label>
            ))}
          </section>
        </div>
        <footer className={styles.stickyActions}>
          {saved ? <span className={styles.savedState}>{t('common.saved')}</span> : null}
          <button className={styles.primaryButton} disabled={mutation.isPending}>
            <Save size={17} />
            {t('common.save')}
          </button>
        </footer>
      </form>
    </div>
  );
}

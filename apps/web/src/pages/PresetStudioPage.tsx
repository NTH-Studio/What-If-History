import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Braces,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Plus,
  Rocket,
  Save,
  Shield,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useParams } from 'react-router-dom';
import type {
  Difficulty,
  PresetDetail,
  PresetHelper,
  PromptMechanic,
  UpdatePresetInput,
} from '@what-if-history/contracts';
import { Preferences } from '../App';
import { api } from '../api';
import { ConfirmDialog } from '../components/Dialogs';
import { BrandMark } from '../components/BrandMark';
import styles from '../styles/App.module.css';

const mechanics: PromptMechanic[] = ['actions', 'advisor', 'diplomacy', 'turns', 'consolidation'];
const sources: PresetHelper['source'][] = [
  'game.date',
  'game.turn',
  'game.player',
  'game.world',
  'game.rules',
];

const studioSections = ['identity', 'world', 'nations', 'models', 'prompts', 'helpers'] as const;
type StudioSection = (typeof studioSections)[number];

export function PresetStudioPage() {
  const { presetId = '' } = useParams<{ presetId: string }>();
  const { t } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
  const preset = useQuery({
    queryKey: ['preset', presetId],
    queryFn: () => api.preset(presetId),
  });
  const nations = useQuery({ queryKey: ['nations'], queryFn: api.nations });
  const [draft, setDraft] = useState<PresetDetail>();
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.presetPreview>>>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<StudioSection>('identity');

  useEffect(() => {
    if (preset.data) setDraft(structuredClone(preset.data));
  }, [preset.data]);

  const saveMutation = useMutation({
    mutationFn: (input: UpdatePresetInput) => api.updatePreset(presetId, input),
    onSuccess: async (updated) => {
      setDraft(updated);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['presets'] });
    },
  });
  const publishMutation = useMutation({
    mutationFn: () => api.publishPreset(presetId),
    onSuccess: async (updated) => {
      setDraft(updated);
      await queryClient.invalidateQueries({ queryKey: ['presets'] });
    },
  });
  const duplicateMutation = useMutation({
    mutationFn: () => api.duplicatePreset(presetId),
    onSuccess: (copy) => history.push(`/presets/${copy.id}`),
  });
  const archiveMutation = useMutation({
    mutationFn: () => api.archivePreset(presetId),
    onSuccess: () => history.push('/'),
  });

  if (preset.isLoading || !draft) {
    return <main className={styles.loadingScreen}>{t('common.loading')}</main>;
  }

  const set = <K extends keyof PresetDetail>(key: K, value: PresetDetail[K]) => {
    setSaved(false);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const updatePrompt = (mechanic: PromptMechanic, template: string) => {
    const current = draft.prompts.find((prompt) => prompt.mechanic === mechanic);
    const next = draft.prompts.filter((prompt) => prompt.mechanic !== mechanic);
    if (template.trim()) next.push({ mechanic, mode: 'custom', template });
    else if (current?.mode === 'default') next.push(current);
    set('prompts', next);
  };
  const save = () =>
    saveMutation.mutate({
      title: draft.title,
      summary: draft.summary,
      category: draft.category,
      tags: draft.tags,
      startDate: draft.startDate,
      worldContext: draft.worldContext,
      simulationRules: draft.simulationRules,
      recommendedDifficulty: draft.recommendedDifficulty,
      playableNationCodes: draft.playableNationCodes,
      aiModels: draft.aiModels,
      prompts: draft.prompts,
      helpers: draft.helpers,
    });

  return (
    <main className={styles.studioShell}>
      <header className={styles.studioHeader}>
        <Link to="/" className={styles.gameBrand}>
          <BrandMark size={27} />
          <span>WHAT IF: HISTORY</span>
        </Link>
        <div className={styles.studioIdentity}>
          <span data-status={draft.status}>{t(`presets.status.${draft.status}`)}</span>
          <strong>{draft.title}</strong>
          <small>v{draft.currentVersion}</small>
        </div>
        <Preferences />
      </header>
      <aside className={styles.studioRail}>
        <Link to="/">
          <ArrowLeft size={17} />
          {t('common.back')}
        </Link>
        {studioSections.map((id, index) => (
          <button
            type="button"
            key={id}
            data-active={activeSection === id}
            onClick={() => setActiveSection(id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {t(`presets.${id}`)}
          </button>
        ))}
      </aside>
      <section className={styles.studioWorkspace}>
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>PRESET · STUDIO</p>
            <h1>{t('presets.studio')}</h1>
            <p>{t('presets.studioDescription')}</p>
          </div>
          <div className={styles.commandActions}>
            <button
              className={styles.button}
              onClick={async () => setPreview(await api.presetPreview(presetId))}
            >
              <Eye size={17} />
              {t('presets.preview')}
            </button>
            <button
              className={styles.primaryButton}
              onClick={save}
              disabled={saveMutation.isPending}
            >
              <Save size={17} />
              {t('common.save')}
            </button>
          </div>
        </header>

        <section id="identity" className={styles.studioCard} hidden={activeSection !== 'identity'}>
          <div className={styles.studioCardTitle}>
            <Sparkles size={19} />
            <div>
              <h2>{t('presets.identity')}</h2>
              <p>{t('presets.identityHelp')}</p>
            </div>
          </div>
          <div className={styles.form}>
            <label>
              <span>{t('presets.title')}</span>
              <input value={draft.title} onChange={(event) => set('title', event.target.value)} />
            </label>
            <label>
              <span>{t('presets.summary')}</span>
              <textarea
                rows={4}
                value={draft.summary}
                onChange={(event) => set('summary', event.target.value)}
              />
            </label>
            <div className={styles.formRow}>
              <label>
                <span>{t('presets.category')}</span>
                <select
                  value={draft.category}
                  onChange={(event) =>
                    set('category', event.target.value as PresetDetail['category'])
                  }
                >
                  {(
                    [
                      'historical',
                      'alternate_history',
                      'fantasy',
                      'science_fiction',
                      'custom',
                    ] as const
                  ).map((category) => (
                    <option key={category} value={category}>
                      {t(`presets.categories.${category}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('presets.tags')}</span>
                <input
                  value={draft.tags.join(', ')}
                  onChange={(event) =>
                    set(
                      'tags',
                      event.target.value
                        .split(',')
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .slice(0, 20),
                    )
                  }
                />
              </label>
              <label>
                <span>{t('presets.date')}</span>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => set('startDate', event.target.value)}
                />
              </label>
            </div>
          </div>
        </section>

        <section id="world" className={styles.studioCard} hidden={activeSection !== 'world'}>
          <div className={styles.studioCardTitle}>
            <Rocket size={19} />
            <div>
              <h2>{t('presets.world')}</h2>
              <p>{t('presets.worldHelp')}</p>
            </div>
          </div>
          <div className={styles.form}>
            <label>
              <span>{t('presets.context')}</span>
              <textarea
                rows={12}
                value={draft.worldContext}
                onChange={(event) => set('worldContext', event.target.value)}
              />
            </label>
            <label>
              <span>{t('presets.rules')}</span>
              <textarea
                rows={10}
                value={draft.simulationRules}
                onChange={(event) => set('simulationRules', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section id="nations" className={styles.studioCard} hidden={activeSection !== 'nations'}>
          <div className={styles.studioCardTitle}>
            <Shield size={19} />
            <div>
              <h2>{t('presets.nations')}</h2>
              <p>{t('presets.nationsHelp')}</p>
            </div>
          </div>
          <div className={styles.selectionGrid}>
            {nations.data?.map((nation) => (
              <label
                key={nation.code}
                data-selected={draft.playableNationCodes.includes(nation.code)}
              >
                <input
                  type="checkbox"
                  checked={draft.playableNationCodes.includes(nation.code)}
                  onChange={() =>
                    set(
                      'playableNationCodes',
                      draft.playableNationCodes.includes(nation.code)
                        ? draft.playableNationCodes.filter((code) => code !== nation.code)
                        : [...draft.playableNationCodes, nation.code],
                    )
                  }
                />
                <span>{nation.name}</span>
                <strong>{nation.code}</strong>
              </label>
            ))}
          </div>
        </section>

        <section id="models" className={styles.studioCard} hidden={activeSection !== 'models'}>
          <div className={styles.studioCardTitle}>
            <Braces size={19} />
            <div>
              <h2>{t('presets.models')}</h2>
              <p>{t('presets.modelsHelp')}</p>
            </div>
          </div>
          <div className={styles.modelGrid}>
            <label>
              <span>{t('campaignSettings.difficulty')}</span>
              <select
                value={draft.recommendedDifficulty}
                onChange={(event) => set('recommendedDifficulty', event.target.value as Difficulty)}
              >
                {(['very_easy', 'easy', 'normal', 'hard', 'impossible'] as const).map((value) => (
                  <option value={value} key={value}>
                    {t(`difficulty.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {(['actions', 'advisor', 'diplomacy', 'turns'] as const).map((mechanic) => (
              <label key={mechanic}>
                <span>{t(`campaignSettings.${mechanic}`)}</span>
                <input
                  value={draft.aiModels[mechanic] ?? ''}
                  placeholder={t('campaignSettings.defaultModel')}
                  onChange={(event) =>
                    set('aiModels', {
                      ...draft.aiModels,
                      [mechanic]: event.target.value.trim() || null,
                    })
                  }
                />
              </label>
            ))}
          </div>
        </section>

        <section id="prompts" className={styles.studioCard} hidden={activeSection !== 'prompts'}>
          <div className={styles.studioCardTitle}>
            <Braces size={19} />
            <div>
              <h2>{t('presets.prompts')}</h2>
              <p>{t('presets.promptsHelp')}</p>
            </div>
          </div>
          <div className={styles.promptEditor}>
            {mechanics.map((mechanic) => (
              <label key={mechanic}>
                <span>{t(`presets.mechanics.${mechanic}`)}</span>
                <textarea
                  rows={7}
                  value={
                    draft.prompts.find((prompt) => prompt.mechanic === mechanic)?.template ?? ''
                  }
                  placeholder={t('presets.defaultPrompt')}
                  onChange={(event) => updatePrompt(mechanic, event.target.value)}
                />
              </label>
            ))}
          </div>
        </section>

        <section id="helpers" className={styles.studioCard} hidden={activeSection !== 'helpers'}>
          <div className={styles.studioCardTitle}>
            <Braces size={19} />
            <div>
              <h2>{t('presets.helpers')}</h2>
              <p>{t('presets.helpersHelp')}</p>
            </div>
            <button
              className={styles.button}
              onClick={() =>
                set('helpers', [
                  ...draft.helpers,
                  {
                    key: `HELPER_${draft.helpers.length + 1}`,
                    label: t('presets.newHelper'),
                    source: 'game.date',
                    format: 'text',
                  },
                ])
              }
            >
              <Plus size={16} />
              {t('common.add')}
            </button>
          </div>
          <div className={styles.helperList}>
            {draft.helpers.map((helper, index) => (
              <div key={`${helper.key}-${index}`}>
                <input
                  aria-label={t('presets.helperKey')}
                  value={helper.key}
                  onChange={(event) => {
                    const next = [...draft.helpers];
                    next[index] = { ...helper, key: event.target.value.toUpperCase() };
                    set('helpers', next);
                  }}
                />
                <input
                  aria-label={t('presets.helperLabel')}
                  value={helper.label}
                  onChange={(event) => {
                    const next = [...draft.helpers];
                    next[index] = { ...helper, label: event.target.value };
                    set('helpers', next);
                  }}
                />
                <select
                  aria-label={t('presets.helperSource')}
                  value={helper.source}
                  onChange={(event) => {
                    const next = [...draft.helpers];
                    next[index] = {
                      ...helper,
                      source: event.target.value as PresetHelper['source'],
                    };
                    set('helpers', next);
                  }}
                >
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.iconButton}
                  aria-label={t('common.delete')}
                  onClick={() =>
                    set(
                      'helpers',
                      draft.helpers.filter((_, helperIndex) => helperIndex !== index),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {preview ? (
          <section className={styles.previewPanel}>
            <header>
              <h2>{t('presets.preview')}</h2>
              <button
                className={styles.iconButton}
                aria-label={t('common.close')}
                onClick={() => setPreview(undefined)}
              >
                <X size={18} />
              </button>
            </header>
            <pre>{JSON.stringify(preview, null, 2)}</pre>
          </section>
        ) : null}
      </section>
      <footer className={styles.studioCommandBar}>
        <div className={styles.studioStepNavigation}>
          <button
            type="button"
            className={styles.button}
            disabled={activeSection === studioSections[0]}
            onClick={() =>
              setActiveSection(
                studioSections[Math.max(0, studioSections.indexOf(activeSection) - 1)]!,
              )
            }
          >
            <ChevronLeft size={16} />
            {t('common.previous')}
          </button>
          <span>
            {studioSections.indexOf(activeSection) + 1}/{studioSections.length}
          </span>
          <button
            type="button"
            className={styles.button}
            disabled={activeSection === studioSections.at(-1)}
            onClick={() =>
              setActiveSection(
                studioSections[
                  Math.min(studioSections.length - 1, studioSections.indexOf(activeSection) + 1)
                ]!,
              )
            }
          >
            {t('common.next')}
            <ChevronRight size={16} />
          </button>
        </div>
        <span className={styles.studioSaveStatus}>
          {saved ? t('common.saved') : t('presets.unsaved')}
        </span>
        <div>
          <button className={styles.button} onClick={() => duplicateMutation.mutate()}>
            <Copy size={16} />
            {t('presets.duplicate')}
          </button>
          <button
            className={styles.button}
            onClick={async () => {
              const data = await api.exportPreset(presetId);
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const anchor = globalThis.document.createElement('a');
              anchor.href = url;
              anchor.download = `${draft.title.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={16} />
            {t('presets.export')}
          </button>
          <button className={styles.button} onClick={() => setArchiveOpen(true)}>
            <Archive size={16} />
            {t('presets.archive')}
          </button>
          <button
            className={styles.primaryButton}
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
          >
            <Rocket size={16} />
            {t('presets.publish')}
          </button>
        </div>
      </footer>
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('presets.archiveTitle')}
        description={t('presets.archiveDescription')}
        confirmLabel={t('presets.archive')}
        onConfirm={async () => archiveMutation.mutateAsync()}
      />
    </main>
  );
}

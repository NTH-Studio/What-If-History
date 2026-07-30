import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  BookTemplate,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  FileUp,
  Pencil,
  Rocket,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import type {
  CreatePresetInput,
  LlmProviderName,
  LlmSettingsInput,
  Preset,
  ScenarioMode,
} from '@what-if-history/contracts';
import { api, ApiError } from '../api';
import { ConfirmDialog, Modal } from '../components/Dialogs';
import { BrandMark } from '../components/BrandMark';
import { LlmActivityIndicator } from '../components/LlmActivity';
import { Preferences } from '../App';
import styles from '../styles/App.module.css';

const providers: LlmProviderName[] = [
  'lm-studio',
  'llama.cpp',
  'ollama',
  'vllm',
  'openai',
  'google',
  'anthropic',
];

function Message({
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

export function HomePage() {
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
  const games = useQuery({ queryKey: ['games'], queryFn: api.games });
  const nations = useQuery({ queryKey: ['nations'], queryFn: api.nations });
  const presets = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [newPresetOpen, setNewPresetOpen] = useState(false);
  const [playPreset, setPlayPreset] = useState<Preset>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const deleteMutation = useMutation({
    mutationFn: api.deleteGame,
    onSuccess: async () => {
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['games'] });
    },
  });
  const playPresetMutation = useMutation({
    mutationFn: ({ presetId, nationCode }: { presetId: string; nationCode: string }) =>
      api.playPreset(presetId, { nationCode }),
    onSuccess: async (game) => {
      await queryClient.invalidateQueries({ queryKey: ['games'] });
      history.push(`/game/${game.id}/dashboard`);
    },
  });

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }),
    [i18n.language],
  );

  return (
    <main className={styles.home}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.homeHeader}>
        <a href="#campaigns" className={styles.brand}>
          <BrandMark size={30} />
          <span>WHAT IF: HISTORY</span>
        </a>
        <div className={styles.headerTools}>
          <LlmActivityIndicator />
          <Preferences />
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>{t('home.eyebrow')}</p>
        <h1>{t('home.title')}</h1>
        <p>{t('home.subtitle')}</p>
        <div className={styles.heroActions}>
          <button className={styles.primaryButton} onClick={() => setNewGameOpen(true)}>
            <Plus size={19} />
            {t('home.newGame')}
          </button>
          <button className={styles.button} onClick={() => setSettingsOpen(true)}>
            <Settings size={18} />
            {t('home.settings')}
          </button>
        </div>
      </section>

      <section id="campaigns" className={styles.campaignSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>01 · COMMAND</p>
            <h2>{t('home.campaigns')}</h2>
          </div>
          <span className={styles.countBadge}>{games.data?.length ?? 0}</span>
        </div>
        {games.isLoading ? <p>{t('common.loading')}</p> : null}
        {games.isError ? <Message message={t('common.error')} /> : null}
        <div className={styles.campaignGrid}>
          {games.data?.map((game) => (
            <article className={styles.campaignCard} key={game.id}>
              <div className={styles.cardTopline}>
                <span>{game.playerNationCode}</span>
                <span className={styles.scenarioBadge} data-mode={game.scenarioMode}>
                  {t(`newGame.${game.scenarioMode}`)}
                </span>
                <span>{t('game.turn', { turn: game.turnNumber })}</span>
              </div>
              <h3>{game.name}</h3>
              <p>{game.playerNationName}</p>
              <time>{dateFormatter.format(new Date(`${game.currentDate}T00:00:00`))}</time>
              <footer>
                <button
                  className={styles.iconButton}
                  aria-label={t('common.delete')}
                  onClick={() => setDeleteId(game.id)}
                >
                  <Trash2 size={17} />
                </button>
                <button
                  className={styles.cardLink}
                  onClick={() => history.push(`/game/${game.id}/dashboard`)}
                >
                  {t('home.continue')}
                  <ChevronRight size={17} />
                </button>
              </footer>
            </article>
          ))}
        </div>
        {!games.isLoading && games.data?.length === 0 ? (
          <div className={styles.emptyState}>
            <Bot size={34} />
            <p>{t('home.noGames')}</p>
          </div>
        ) : null}
      </section>

      <section className={`${styles.campaignSection} ${styles.presetSection}`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>02 · SCENARIO LAB</p>
            <h2>{t('presets.library')}</h2>
            <p className={styles.sectionDescription}>{t('presets.libraryDescription')}</p>
          </div>
          <div className={styles.commandActions}>
            <label className={styles.fileButton}>
              <FileUp size={17} />
              {t('presets.import')}
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    const input = JSON.parse(await file.text()) as CreatePresetInput;
                    const imported = await api.importPreset(input);
                    await queryClient.invalidateQueries({ queryKey: ['presets'] });
                    history.push(`/presets/${imported.id}`);
                  } catch (caught) {
                    setError(
                      caught instanceof ApiError ? caught.problem.detail : t('common.error'),
                    );
                  }
                  event.target.value = '';
                }}
              />
            </label>
            <button className={styles.primaryButton} onClick={() => setNewPresetOpen(true)}>
              <Plus size={17} />
              {t('presets.create')}
            </button>
          </div>
        </div>
        <div className={styles.presetGrid}>
          {presets.data?.map((preset) => (
            <article className={styles.presetCard} key={preset.id}>
              <header>
                <span>{t(`presets.categories.${preset.category}`)}</span>
                <span data-status={preset.status}>{t(`presets.status.${preset.status}`)}</span>
              </header>
              <div className={styles.presetGlyph}>
                <BookTemplate size={28} />
              </div>
              <h3>{preset.title}</h3>
              <p>{preset.summary || t('presets.noSummary')}</p>
              <div className={styles.tagList}>
                {preset.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <footer>
                <button
                  className={styles.button}
                  onClick={() => history.push(`/presets/${preset.id}`)}
                >
                  <Pencil size={15} />
                  {t('presets.edit')}
                </button>
                <button className={styles.primaryButton} onClick={() => setPlayPreset(preset)}>
                  <Rocket size={15} />
                  {t('presets.play')}
                </button>
              </footer>
            </article>
          ))}
        </div>
        {!presets.isLoading && presets.data?.length === 0 ? (
          <div className={styles.emptyState}>
            <BookTemplate size={34} />
            <p>{t('presets.empty')}</p>
          </div>
        ) : null}
      </section>

      <NewGameDialog
        open={newGameOpen}
        onOpenChange={setNewGameOpen}
        nations={nations.data ?? []}
        onError={(value) => setError(value)}
      />
      <NewPresetDialog
        open={newPresetOpen}
        onOpenChange={setNewPresetOpen}
        onCreated={(preset) => history.push(`/presets/${preset.id}`)}
      />
      <Modal
        open={Boolean(playPreset)}
        onOpenChange={(open) => !open && setPlayPreset(undefined)}
        title={t('presets.playTitle')}
        description={t('presets.playDescription')}
      >
        {playPreset ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              playPresetMutation.mutate({
                presetId: playPreset.id,
                nationCode: String(data.get('nationCode')),
              });
            }}
          >
            <label>
              <span>{t('newGame.nation')}</span>
              <select name="nationCode" required defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {nations.data
                  ?.filter((nation) => playPreset.playableNationCodes.includes(nation.code))
                  .map((nation) => (
                    <option key={nation.code} value={nation.code}>
                      {nation.name}
                    </option>
                  ))}
              </select>
            </label>
            <footer className={styles.dialogActions}>
              <button className={styles.primaryButton} disabled={playPresetMutation.isPending}>
                <Rocket size={16} />
                {t('presets.play')}
              </button>
            </footer>
          </form>
        ) : null}
      </Modal>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={t('home.deleteTitle')}
        description={t('home.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteId) await deleteMutation.mutateAsync(deleteId);
        }}
      />
      <Message message={error} />
    </main>
  );
}

function NewPresetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (preset: Awaited<ReturnType<typeof api.createPreset>>) => void;
}) {
  const { t } = useTranslation();
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
            <input name="startDate" type="date" defaultValue="1936-01-01" required />
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

function NewGameDialog({
  open,
  onOpenChange,
  nations,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nations: Awaited<ReturnType<typeof api.nations>>;
  onError: (message?: string) => void;
}) {
  const { t } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
  const [nationCode, setNationCode] = useState('');
  const [nationQuery, setNationQuery] = useState('');
  const [nationListOpen, setNationListOpen] = useState(false);
  const [activeNationIndex, setActiveNationIndex] = useState(0);
  const nationOptionsRef = useRef<HTMLUListElement>(null);
  const [startDate, setStartDate] = useState('1936-01-01');
  const [difficulty, setDifficulty] = useState<
    'very_easy' | 'easy' | 'normal' | 'hard' | 'impossible'
  >('normal');
  const [name, setName] = useState('');
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>('historical');
  const [scenarioPremise, setScenarioPremise] = useState('');
  const mutation = useMutation({
    mutationFn: api.createGame,
    onSuccess: async (game) => {
      await queryClient.invalidateQueries({ queryKey: ['games'] });
      onOpenChange(false);
      history.push(`/game/${game.id}/dashboard`);
    },
    onError: (caught) => {
      onError(caught instanceof ApiError ? caught.problem.detail : t('common.error'));
    },
  });
  const normalizeSearch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase()
      .trim();
  const selectedNation = nations.find((nation) => nation.code === nationCode);
  const selectedNationLabel = selectedNation
    ? `${selectedNation.name} · ${selectedNation.code}`
    : undefined;
  const normalizedNationQuery =
    selectedNationLabel === nationQuery ? '' : normalizeSearch(nationQuery);
  const nationMatchScore = (nation: (typeof nations)[number]) => {
    const normalizedCode = normalizeSearch(nation.code);
    const normalizedName = normalizeSearch(nation.name);
    const words = normalizedName.split(/\s+/);
    if (normalizedCode === normalizedNationQuery) return 0;
    if (normalizedCode.startsWith(normalizedNationQuery)) return 1;
    if (normalizedName.startsWith(normalizedNationQuery)) return 2;
    if (words.some((word) => word.startsWith(normalizedNationQuery))) return 3;
    return 4;
  };
  const filteredNations = normalizedNationQuery
    ? nations
        .filter((nation) =>
          normalizeSearch(`${nation.name} ${nation.code}`).includes(normalizedNationQuery),
        )
        .sort(
          (left, right) =>
            nationMatchScore(left) - nationMatchScore(right) || left.name.localeCompare(right.name),
        )
    : nations;
  const activeNationCode = filteredNations[activeNationIndex]?.code;
  const selectNation = (nation: (typeof nations)[number]) => {
    setNationCode(nation.code);
    setNationQuery(`${nation.name} · ${nation.code}`);
    setNationListOpen(false);
  };
  useEffect(() => {
    if (!nationListOpen || !activeNationCode) return;
    nationOptionsRef.current
      ?.querySelector<HTMLElement>(`#nation-option-${activeNationCode}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeNationCode, nationListOpen]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('newGame.title')}
      description={t('newGame.description')}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({
            nationCode,
            startDate,
            difficulty,
            ...(name.trim() ? { name: name.trim() } : {}),
            scenario:
              scenarioMode === 'custom'
                ? { mode: 'custom', premise: scenarioPremise.trim() }
                : { mode: 'historical' },
          });
        }}
      >
        <div className={styles.nationField}>
          <label htmlFor="nation-search">
            <span>{t('newGame.nation')}</span>
          </label>
          <div
            className={styles.nationCombobox}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setNationListOpen(false);
              }
            }}
          >
            <Search size={17} aria-hidden="true" />
            <input
              id="nation-search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={nationListOpen}
              aria-controls="nation-options"
              aria-activedescendant={
                nationListOpen && filteredNations[activeNationIndex]
                  ? `nation-option-${filteredNations[activeNationIndex].code}`
                  : undefined
              }
              autoComplete="off"
              placeholder={t('newGame.search')}
              value={nationQuery}
              onFocus={() => {
                setActiveNationIndex(
                  Math.max(
                    0,
                    filteredNations.findIndex((nation) => nation.code === nationCode),
                  ),
                );
                setNationListOpen(true);
              }}
              onChange={(event) => {
                setNationQuery(event.target.value);
                setNationCode('');
                setActiveNationIndex(0);
                setNationListOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setNationListOpen(true);
                  setActiveNationIndex((index) =>
                    Math.max(0, Math.min(index + 1, filteredNations.length - 1)),
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveNationIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter' && nationListOpen) {
                  const nation = filteredNations[activeNationIndex];
                  if (nation) {
                    event.preventDefault();
                    selectNation(nation);
                  }
                } else if (event.key === 'Escape') {
                  setNationListOpen(false);
                }
              }}
            />
            {selectedNation ? (
              <Check className={styles.nationSelectedIcon} size={17} aria-hidden="true" />
            ) : (
              <ChevronDown className={styles.nationChevron} size={17} aria-hidden="true" />
            )}
            {nationListOpen ? (
              <ul
                ref={nationOptionsRef}
                id="nation-options"
                className={styles.nationOptions}
                role="listbox"
              >
                {filteredNations.length > 0 ? (
                  filteredNations.map((nation, index) => (
                    <li
                      id={`nation-option-${nation.code}`}
                      key={nation.code}
                      role="option"
                      aria-selected={nation.code === nationCode}
                      data-active={index === activeNationIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveNationIndex(index)}
                      onClick={() => selectNation(nation)}
                    >
                      <span>{nation.name}</span>
                      <strong>{nation.code}</strong>
                    </li>
                  ))
                ) : (
                  <li
                    className={styles.nationNoResults}
                    role="option"
                    aria-disabled="true"
                    aria-selected="false"
                  >
                    {t('newGame.noNationResults')}
                  </li>
                )}
              </ul>
            ) : null}
          </div>
        </div>
        <div className={styles.formRow}>
          <label>
            <span>{t('newGame.date')}</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>
          <label>
            <span>
              {t('newGame.name')} · {t('newGame.optional')}
            </span>
            <input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t('campaignSettings.difficulty')}</span>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
            >
              {(['very_easy', 'easy', 'normal', 'hard', 'impossible'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`difficulty.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className={styles.scenarioFieldset}>
          <legend>{t('newGame.scenario')}</legend>
          <div className={styles.scenarioChoices}>
            {(['historical', 'custom'] as const).map((mode) => (
              <label key={mode} data-selected={scenarioMode === mode}>
                <input
                  type="radio"
                  name="scenarioMode"
                  value={mode}
                  checked={scenarioMode === mode}
                  onChange={() => setScenarioMode(mode)}
                />
                <span>
                  <strong>{t(`newGame.${mode}`)}</strong>
                  <small>{t(`newGame.${mode}Description`)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {scenarioMode === 'custom' ? (
          <label>
            <span>{t('newGame.premise')}</span>
            <textarea
              value={scenarioPremise}
              onChange={(event) => setScenarioPremise(event.target.value)}
              placeholder={t('newGame.premisePlaceholder')}
              maxLength={4_000}
              rows={5}
              required
              aria-describedby="scenario-guidance scenario-count"
            />
            <small id="scenario-guidance">{t('newGame.premiseGuidance')}</small>
            <small id="scenario-count" className={styles.characterCount}>
              {scenarioPremise.length.toLocaleString()} / 4 000
            </small>
          </label>
        ) : null}
        <footer className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className={styles.primaryButton}
            disabled={
              mutation.isPending ||
              !nationCode ||
              (scenarioMode === 'custom' && !scenarioPremise.trim())
            }
          >
            {mutation.isPending ? t('common.loading') : t('newGame.create')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function SettingsDialog({
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
    onError: () => setStatus({ text: t('common.error'), tone: 'error' }),
  });

  const submit = (element: HTMLFormElement, mode: 'save' | 'test') => {
    const form = new FormData(element);
    const input: LlmSettingsInput = {
      provider: form.get('provider') as LlmProviderName,
      apiUrl: String(form.get('apiUrl')),
      model: String(form.get('model')),
      apiKey: String(form.get('apiKey')),
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

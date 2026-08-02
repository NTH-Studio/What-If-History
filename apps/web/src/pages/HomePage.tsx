import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  BookTemplate,
  ChevronRight,
  FileUp,
  Pencil,
  Plus,
  Rocket,
  Settings,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import type { CreatePresetInput, Preset } from '@what-if-history/contracts';
import { api, ApiError } from '../api';
import { Preferences } from '../App';
import { BrandMark } from '../components/BrandMark';
import { ConfirmDialog, Modal } from '../components/Dialogs';
import { LlmActivityIndicator } from '../components/LlmActivity';
import { StudioSupport } from '../components/StudioSupport';
import { queueEventPlayback } from '../eventPlayback';
import { formatCalendarDate } from '../dateFormatting';
import { NewGameDialog } from './home/NewGameDialog';
import { NewPresetDialog } from './home/NewPresetDialog';
import { Message } from './home/shared';
import { SettingsDialog } from './home/SettingsDialog';
import styles from '../styles/App.module.css';

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
    onSuccess: async ({ game, openingTurn }) => {
      queueEventPlayback(game.id, openingTurn.events);
      await queryClient.invalidateQueries({ queryKey: ['games'] });
      history.push(`/game/${game.id}/map`);
    },
  });

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
              <time dateTime={game.currentDate}>
                {formatCalendarDate(game.currentDate, i18n.language)}
              </time>
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

      <StudioSupport />

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
                {playPresetMutation.isPending ? t('newGame.simulatingFirstDay') : t('presets.play')}
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

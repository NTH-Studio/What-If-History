import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  BrainCircuit,
  Database,
  Flag,
  History,
  MapPin,
  Plus,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Consolidation,
  Difficulty,
  Game,
  GameAiModels,
  GameRegion,
  Nation,
} from '@what-if-history/contracts';
import { api } from '../api';
import { ConfirmDialog, Modal } from './Dialogs';
import styles from '../styles/App.module.css';

const difficulties: Difficulty[] = ['very_easy', 'easy', 'normal', 'hard', 'impossible'];
const regionTypes: GameRegion['regionType'][] = ['land', 'coastal', 'ocean', 'strait'];

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className={styles.workspaceHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

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

export function MemoryPanel({ gameId }: { gameId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const snapshots = useQuery({
    queryKey: ['snapshots', gameId],
    queryFn: () => api.snapshots(gameId),
  });
  const consolidations = useQuery({
    queryKey: ['consolidations', gameId],
    queryFn: () => api.consolidations(gameId),
  });
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [restoreId, setRestoreId] = useState<string>();
  const [deleteConsolidation, setDeleteConsolidation] = useState<string>();
  const createSnapshot = useMutation({
    mutationFn: () => api.createSnapshot(gameId, snapshotLabel),
    onSuccess: async () => {
      setSnapshotLabel('');
      setSnapshotOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['snapshots', gameId] });
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.restoreSnapshot(gameId, id),
    onSuccess: async () => {
      setRestoreId(undefined);
      await queryClient.invalidateQueries();
    },
  });
  const settingsMutation = useMutation({
    mutationFn: (settings: { startRound: number; chunkSize: number }) =>
      api.updateConsolidationSettings(gameId, settings),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
  });
  const updateConsolidation = useMutation({
    mutationFn: ({ id, summary }: { id: string; summary: string }) =>
      api.updateConsolidation(gameId, id, summary),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
  });
  const removeConsolidation = useMutation({
    mutationFn: (id: string) => api.deleteConsolidation(gameId, id),
    onSuccess: async () => {
      setDeleteConsolidation(undefined);
      await queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] });
    },
  });

  return (
    <div className={styles.pageStack}>
      <PageHeader
        eyebrow="MEMORY · CHECKPOINTS"
        title={t('memory.title')}
        description={t('memory.description')}
        action={
          <button className={styles.primaryButton} onClick={() => setSnapshotOpen(true)}>
            <Plus size={17} />
            {t('memory.snapshot')}
          </button>
        }
      />
      <div className={styles.advancedGrid}>
        <section className={styles.panel}>
          <div className={styles.subsectionTitle}>
            <ArchiveRestore size={18} />
            <h2>{t('memory.snapshots')}</h2>
          </div>
          <div className={styles.recordList}>
            {snapshots.data?.map((snapshot) => (
              <article key={snapshot.id}>
                <div>
                  <strong>{snapshot.label}</strong>
                  <span>
                    {snapshot.gameDate} · {t('game.turn', { turn: snapshot.turnNumber })}
                  </span>
                </div>
                <button className={styles.button} onClick={() => setRestoreId(snapshot.id)}>
                  <History size={15} />
                  {t('memory.restore')}
                </button>
              </article>
            ))}
            {!snapshots.isLoading && snapshots.data?.length === 0 ? (
              <p className={styles.muted}>{t('memory.noSnapshots')}</p>
            ) : null}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.subsectionTitle}>
            <Database size={18} />
            <h2>{t('memory.consolidations')}</h2>
          </div>
          {consolidations.data ? (
            <form
              className={styles.inlineSettings}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                settingsMutation.mutate({
                  startRound: Number(data.get('startRound')),
                  chunkSize: Number(data.get('chunkSize')),
                });
              }}
            >
              <label>
                <span>{t('memory.startRound')}</span>
                <input
                  name="startRound"
                  type="number"
                  min={2}
                  max={200}
                  defaultValue={consolidations.data.settings.startRound}
                />
              </label>
              <label>
                <span>{t('memory.chunkSize')}</span>
                <input
                  name="chunkSize"
                  type="number"
                  min={2}
                  max={50}
                  defaultValue={consolidations.data.settings.chunkSize}
                />
              </label>
              <button className={styles.button}>{t('common.save')}</button>
            </form>
          ) : null}
          <div className={styles.recordList}>
            {consolidations.data?.items.map((item) => (
              <ConsolidationCard
                key={item.id}
                item={item}
                onSave={(summary) => updateConsolidation.mutate({ id: item.id, summary })}
                onDelete={() => setDeleteConsolidation(item.id)}
              />
            ))}
            {consolidations.data?.items.length === 0 ? (
              <p className={styles.muted}>{t('memory.noConsolidations')}</p>
            ) : null}
          </div>
        </section>
      </div>
      <Modal
        open={snapshotOpen}
        onOpenChange={setSnapshotOpen}
        title={t('memory.snapshotTitle')}
        description={t('memory.snapshotDescription')}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createSnapshot.mutate();
          }}
        >
          <label>
            <span>{t('memory.label')}</span>
            <input
              value={snapshotLabel}
              onChange={(event) => setSnapshotLabel(event.target.value)}
              maxLength={120}
              required
              autoFocus
            />
          </label>
          <footer className={styles.dialogActions}>
            <button className={styles.primaryButton} disabled={!snapshotLabel.trim()}>
              {t('memory.snapshot')}
            </button>
          </footer>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(restoreId)}
        onOpenChange={(open) => !open && setRestoreId(undefined)}
        title={t('memory.restoreTitle')}
        description={t('memory.restoreDescription')}
        confirmLabel={t('memory.restore')}
        onConfirm={async () => {
          if (restoreId) await restore.mutateAsync(restoreId);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteConsolidation)}
        onOpenChange={(open) => !open && setDeleteConsolidation(undefined)}
        title={t('memory.deleteTitle')}
        description={t('memory.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteConsolidation) {
            await removeConsolidation.mutateAsync(deleteConsolidation);
          }
        }}
      />
    </div>
  );
}

function ConsolidationCard({
  item,
  onSave,
  onDelete,
}: {
  item: Consolidation;
  onSave: (summary: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(item.summary);
  return (
    <article className={styles.consolidationCard}>
      <header>
        <div>
          <strong>{t('memory.turnRange', { start: item.startTurn, end: item.endTurn })}</strong>
          <span data-status={item.status}>{t(`memory.${item.status}`)}</span>
        </div>
        <button className={styles.iconButton} aria-label={t('common.delete')} onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </header>
      <textarea
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        rows={7}
        maxLength={20_000}
      />
      <button className={styles.button} onClick={() => onSave(summary)} disabled={!summary.trim()}>
        <Save size={15} />
        {t('common.save')}
      </button>
    </article>
  );
}

export function WorldPanel({ gameId, nations }: { gameId: string; nations: Nation[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const regions = useQuery({
    queryKey: ['game-regions', gameId],
    queryFn: () => api.gameRegions(gameId),
  });
  const features = useQuery({
    queryKey: ['map-features', gameId],
    queryFn: () => api.mapFeatures(gameId),
  });
  const history = useQuery({
    queryKey: ['world-history', gameId],
    queryFn: () => api.worldHistory(gameId),
  });
  const [featureOpen, setFeatureOpen] = useState(false);
  const [deleteFeature, setDeleteFeature] = useState<string>();
  const updateRegion = useMutation({
    mutationFn: ({
      regionId,
      input,
    }: {
      regionId: string;
      input: { ownerNationCode?: string | null; regionType?: GameRegion['regionType'] };
    }) => api.updateGameRegion(gameId, regionId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game-regions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
      ]);
    },
  });
  const createFeature = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      return api.createMapFeature(gameId, {
        name: String(data.get('name')),
        featureType: data.get('featureType') as 'city' | 'capital' | 'battalion' | 'custom',
        nationCode: String(data.get('nationCode')) || null,
        regionId: String(data.get('regionId')),
        coords: [Number(data.get('x')), Number(data.get('y'))],
        symbol: String(data.get('symbol')) || '•',
        color: String(data.get('color')),
      });
    },
    onSuccess: async () => {
      setFeatureOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['map-features', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
      ]);
    },
  });
  const removeFeature = useMutation({
    mutationFn: (id: string) => api.deleteMapFeature(gameId, id),
    onSuccess: async () => {
      setDeleteFeature(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['map-features', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
      ]);
    },
  });
  const nationNames = useMemo(
    () => new Map(nations.map((nation) => [nation.code, nation.name])),
    [nations],
  );

  return (
    <div className={styles.pageStack}>
      <PageHeader
        eyebrow="WORLD · EDITOR"
        title={t('world.title')}
        description={t('world.description')}
        action={
          <button className={styles.primaryButton} onClick={() => setFeatureOpen(true)}>
            <Plus size={17} />
            {t('world.addFeature')}
          </button>
        }
      />
      <div className={styles.worldSummary}>
        <article>
          <MapPin size={19} />
          <strong>{features.data?.length ?? 0}</strong>
          <span>{t('world.features')}</span>
        </article>
        <article>
          <Flag size={19} />
          <strong>{regions.data?.length ?? 0}</strong>
          <span>{t('world.regions')}</span>
        </article>
        <article>
          <History size={19} />
          <strong>{history.data?.length ?? 0}</strong>
          <span>{t('world.mutations')}</span>
        </article>
      </div>
      <section className={styles.panel}>
        <div className={styles.subsectionTitle}>
          <Flag size={18} />
          <h2>{t('world.regions')}</h2>
        </div>
        <div className={styles.dataTable}>
          <div className={styles.dataTableHead}>
            <span>{t('world.region')}</span>
            <span>{t('world.owner')}</span>
            <span>{t('world.type')}</span>
          </div>
          {regions.data?.map((region) => (
            <div key={region.regionId}>
              <strong>{region.name}</strong>
              <select
                value={region.ownerNationCode ?? ''}
                aria-label={`${t('world.owner')}: ${region.name}`}
                onChange={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: { ownerNationCode: event.target.value || null },
                  })
                }
              >
                <option value="">—</option>
                {nations.map((nation) => (
                  <option key={nation.code} value={nation.code}>
                    {nation.name}
                  </option>
                ))}
              </select>
              <select
                value={region.regionType}
                aria-label={`${t('world.type')}: ${region.name}`}
                onChange={(event) =>
                  updateRegion.mutate({
                    regionId: region.regionId,
                    input: { regionType: event.target.value as GameRegion['regionType'] },
                  })
                }
              >
                {regionTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`world.regionTypes.${type}`)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.subsectionTitle}>
          <MapPin size={18} />
          <h2>{t('world.features')}</h2>
        </div>
        <div className={styles.featureGrid}>
          {features.data?.map((feature) => (
            <article key={feature.id}>
              <span style={{ color: feature.color }}>{feature.symbol}</span>
              <div>
                <strong>{feature.name}</strong>
                <small>
                  {t(`world.featureTypes.${feature.featureType}`)}
                  {feature.nationCode
                    ? ` · ${nationNames.get(feature.nationCode) ?? feature.nationCode}`
                    : ''}
                </small>
              </div>
              <button
                className={styles.iconButton}
                aria-label={t('common.delete')}
                onClick={() => setDeleteFeature(feature.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <Modal
        open={featureOpen}
        onOpenChange={setFeatureOpen}
        title={t('world.addFeature')}
        description={t('world.addFeatureDescription')}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createFeature.mutate(event.currentTarget);
          }}
        >
          <label>
            <span>{t('world.name')}</span>
            <input name="name" maxLength={120} required autoFocus />
          </label>
          <div className={styles.formRow}>
            <label>
              <span>{t('world.type')}</span>
              <select name="featureType" defaultValue="custom">
                {(['city', 'capital', 'battalion', 'custom'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`world.featureTypes.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('world.nation')}</span>
              <select name="nationCode" defaultValue="">
                <option value="">—</option>
                {nations.map((nation) => (
                  <option key={nation.code} value={nation.code}>
                    {nation.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>{t('world.region')}</span>
            <select name="regionId" defaultValue="" required>
              <option value="">—</option>
              {regions.data?.map((region) => (
                <option key={region.regionId} value={region.regionId}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.formRow}>
            <label>
              <span>X</span>
              <input name="x" type="number" min={0} max={1440} defaultValue={720} required />
            </label>
            <label>
              <span>Y</span>
              <input name="y" type="number" min={0} max={650} defaultValue={325} required />
            </label>
            <label>
              <span>{t('world.symbol')}</span>
              <input name="symbol" defaultValue="◆" maxLength={8} required />
            </label>
            <label>
              <span>{t('world.color')}</span>
              <input name="color" type="color" defaultValue="#f0c56a" required />
            </label>
          </div>
          <footer className={styles.dialogActions}>
            <button className={styles.primaryButton} disabled={createFeature.isPending}>
              {t('common.create')}
            </button>
          </footer>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteFeature)}
        onOpenChange={(open) => !open && setDeleteFeature(undefined)}
        title={t('world.deleteFeatureTitle')}
        description={t('world.deleteFeatureDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteFeature) await removeFeature.mutateAsync(deleteFeature);
        }}
      />
    </div>
  );
}

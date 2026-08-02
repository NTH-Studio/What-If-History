import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, Database, History, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Consolidation } from '@what-if-history/contracts';
import { api } from '../../api';
import { formatCalendarDate } from '../../dateFormatting';
import { ConfirmDialog, Modal } from '../Dialogs';
import { PageHeader } from './shared';
import styles from '../../styles/App.module.css';

export function MemoryPanel({ gameId }: { gameId: string }) {
  const { t, i18n } = useTranslation();
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
                    <time dateTime={snapshot.gameDate}>
                      {formatCalendarDate(snapshot.gameDate, i18n.language, 'medium')}
                    </time>{' '}
                    · {t('game.turn', { turn: snapshot.turnNumber })}
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

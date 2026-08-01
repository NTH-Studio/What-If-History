import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Trash2, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AppliedMutation,
  EventLocation,
  GameEvent,
  TimelineEntry,
} from '@what-if-history/contracts';
import { api } from '../../api';
import { ConfirmDialog, Modal } from '../../components/Dialogs';
import { TimelineReplayButton } from '../../components/StrategicTimeline';
import { TurnMutationSummary } from './TurnMutationSummary';
import styles from '../../styles/App.module.css';

export function EventsPanel({
  gameId,
  events,
  timeline,
  mutations,
  onReplay,
  onReplayTimeline,
  onFocusMutation,
  onClose,
}: {
  gameId: string;
  events: Awaited<ReturnType<typeof api.events>>;
  timeline: TimelineEntry[];
  mutations: AppliedMutation[];
  onReplay: (event: GameEvent) => void;
  onReplayTimeline: (entry: TimelineEntry) => void;
  onFocusMutation: (mutation: AppliedMutation) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<(typeof events)[number]>();
  const [editLocationKind, setEditLocationKind] = useState<'region' | 'nation' | 'global'>(
    'global',
  );
  const [editLocationId, setEditLocationId] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const regions = useQuery({
    queryKey: ['game-regions', gameId],
    queryFn: () => api.gameRegions(gameId),
  });
  const nations = useQuery({ queryKey: ['nations'], queryFn: api.nations });
  const turnDetails = useMemo(() => {
    const result = new Map<number, AppliedMutation[]>();
    for (const mutation of mutations) {
      const turnMutations = result.get(mutation.turnNumber) ?? [];
      turnMutations.push(mutation);
      result.set(mutation.turnNumber, turnMutations);
    }
    return result;
  }, [mutations]);
  const lastEntryByTurn = useMemo(() => {
    const result = new Map<number, TimelineEntry>();
    for (const entry of timeline) {
      const current = result.get(entry.turnNumber);
      if (!current || entry.sequence > current.sequence) result.set(entry.turnNumber, entry);
    }
    return new Map([...result].map(([turnNumber, entry]) => [turnNumber, entry.id]));
  }, [timeline]);
  const beginEditing = (event: (typeof events)[number]) => {
    const location =
      event.map_cue.locations.find((item) => item.role === 'primary') ?? event.map_cue.locations[0];
    if (location?.kind === 'region') {
      setEditLocationKind('region');
      setEditLocationId(location.region_id);
    } else if (location?.kind === 'nation') {
      setEditLocationKind('nation');
      setEditLocationId(location.nation_code);
    } else {
      setEditLocationKind('global');
      setEditLocationId('');
    }
    setEditing(event);
  };
  const updateMutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form);
      const primaryLocation: EventLocation =
        editLocationKind === 'region'
          ? { kind: 'region', role: 'primary', region_id: editLocationId }
          : editLocationKind === 'nation'
            ? { kind: 'nation', role: 'primary', nation_code: editLocationId }
            : { kind: 'global', role: 'primary' };
      return api.updateEvent(gameId, editing!.id, {
        title: String(data.get('title')),
        description: String(data.get('description')),
        event_type: data.get('eventType') as GameEvent['event_type'],
        severity: data.get('severity') as GameEvent['severity'],
        map_cue: {
          camera: editLocationKind === 'global' ? 'world' : 'auto',
          locations: [
            primaryLocation,
            ...editing!.map_cue.locations
              .filter((location) => location.role === 'secondary')
              .map((location) => ({ ...location, role: 'secondary' as const })),
          ],
        },
      });
    },
    onSuccess: async () => {
      setEditing(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteEvent(gameId, id),
    onSuccess: async () => {
      setDeleting(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
      ]);
    },
  });
  return (
    <div className={styles.pageStack}>
      <header className={`${styles.workspaceHeader} ${styles.surfaceHeader}`}>
        <div>
          <p className={styles.eyebrow}>WORLD · FEED</p>
          <h1>{t('events.title')}</h1>
        </div>
        <div className={styles.surfaceHeaderActions}>
          <button
            type="button"
            className={styles.surfaceClose}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      {timeline.length ? (
        <section className={styles.strategicJournal} aria-labelledby="strategic-journal-title">
          <header>
            <div>
              <p className={styles.eyebrow}>WORLD · OPERATIONS</p>
              <h2 id="strategic-journal-title">{t('strategic.timeline.journal')}</h2>
            </div>
            <span>{timeline.length}</span>
          </header>
          <div>
            {timeline.map((entry) => {
              const details = turnDetails.get(entry.turnNumber) ?? [];
              const showsTurnDetails = lastEntryByTurn.get(entry.turnNumber) === entry.id;
              return (
                <Fragment key={entry.id}>
                  <article data-kind={entry.kind}>
                    <span>{entry.gameDate}</span>
                    <div>
                      <small>{t(`strategic.timeline.kinds.${entry.kind}`)}</small>
                      <h3>{entry.title}</h3>
                      <p>{entry.description}</p>
                    </div>
                    <TimelineReplayButton entry={entry} onReplay={() => onReplayTimeline(entry)} />
                  </article>
                  {showsTurnDetails && details.length ? (
                    <details className={styles.strategicTurnDetails}>
                      <summary>
                        <span>{t('turnSummary.details')}</span>
                        <small>{t('turnSummary.changes', { count: details.length })}</small>
                      </summary>
                      <TurnMutationSummary mutations={details} onFocus={onFocusMutation} />
                    </details>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </section>
      ) : null}
      <div className={styles.eventTimeline}>
        {events.map((event) => (
          <article key={event.id}>
            <div className={styles.timelineRail}>
              <span data-severity={event.severity} />
            </div>
            <div>
              <header>
                <span>{event.gameDate}</span>
                <span>{event.event_type}</span>
                <span>{event.severity}</span>
              </header>
              <h2>{event.title}</h2>
              <p>{event.description}</p>
              {event.affected_nations.length ? (
                <small>
                  {t('events.affected')}: {event.affected_nations.join(', ')}
                </small>
              ) : null}
              <div className={styles.cardActions}>
                <button className={styles.primaryButton} onClick={() => onReplay(event)}>
                  <MapPin size={15} />
                  {t('events.showOnMap')}
                </button>
                <button className={styles.button} onClick={() => beginEditing(event)}>
                  <Pencil size={15} />
                  {t('common.edit')}
                </button>
                <button className={styles.textDanger} onClick={() => setDeleting(event.id)}>
                  <Trash2 size={15} />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </article>
        ))}
        {events.length === 0 ? <p className={styles.muted}>{t('game.noEvents')}</p> : null}
      </div>
      <Modal
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={t('events.editTitle')}
        description={t('events.editDescription')}
      >
        {editing ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              updateMutation.mutate(event.currentTarget);
            }}
          >
            <label>
              <span>{t('events.eventTitle')}</span>
              <input name="title" defaultValue={editing.title} maxLength={180} required />
            </label>
            <label>
              <span>{t('events.description')}</span>
              <textarea
                name="description"
                defaultValue={editing.description}
                rows={8}
                maxLength={4_000}
                required
              />
            </label>
            <div className={styles.formRow}>
              <label>
                <span>{t('events.type')}</span>
                <select name="eventType" defaultValue={editing.event_type}>
                  {(['military', 'political', 'economic', 'diplomatic', 'social'] as const).map(
                    (value) => (
                      <option value={value} key={value}>
                        {t(`events.types.${value}`)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span>{t('events.severity')}</span>
                <select name="severity" defaultValue={editing.severity}>
                  {(['minor', 'moderate', 'major', 'critical'] as const).map((value) => (
                    <option value={value} key={value}>
                      {t(`events.severities.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.formRow}>
              <label>
                <span>{t('events.locationType')}</span>
                <select
                  value={editLocationKind}
                  onChange={(event) => {
                    const kind = event.target.value as typeof editLocationKind;
                    setEditLocationKind(kind);
                    setEditLocationId(
                      kind === 'region'
                        ? (regions.data?.[0]?.regionId ?? '')
                        : kind === 'nation'
                          ? (nations.data?.[0]?.code ?? '')
                          : '',
                    );
                  }}
                >
                  <option value="region">{t('events.locationRegion')}</option>
                  <option value="nation">{t('events.locationNation')}</option>
                  <option value="global">{t('events.locationGlobal')}</option>
                </select>
              </label>
              {editLocationKind === 'region' ? (
                <label>
                  <span>{t('events.location')}</span>
                  <select
                    value={editLocationId}
                    onChange={(event) => setEditLocationId(event.target.value)}
                    required
                  >
                    {regions.data?.map((region) => (
                      <option key={region.regionId} value={region.regionId}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {editLocationKind === 'nation' ? (
                <label>
                  <span>{t('events.location')}</span>
                  <select
                    value={editLocationId}
                    onChange={(event) => setEditLocationId(event.target.value)}
                    required
                  >
                    {nations.data?.map((nation) => (
                      <option key={nation.code} value={nation.code}>
                        {nation.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <footer className={styles.dialogActions}>
              <button className={styles.primaryButton}>{t('common.save')}</button>
            </footer>
          </form>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={t('events.deleteTitle')}
        description={t('events.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleting) await deleteMutation.mutateAsync(deleting);
        }}
      />
    </div>
  );
}

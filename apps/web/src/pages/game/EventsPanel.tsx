import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AppliedMutation,
  EventLocation,
  GameEvent,
  TimelineEntry,
} from '@what-if-history/contracts';
import { api } from '../../api';
import { formatCalendarDate } from '../../dateFormatting';
import { ConfirmDialog, Modal } from '../../components/Dialogs';
import { TimelineReplayButton } from '../../components/StrategicTimeline';
import { TurnMutationSummary } from './TurnMutationSummary';
import styles from '../../styles/App.module.css';

type JournalTab = 'news' | 'operations';
type JournalSelection = { kind: 'event'; id: string } | { kind: 'operation'; id: string };

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
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<JournalTab>('news');
  const [selection, setSelection] = useState<JournalSelection>();
  const [editing, setEditing] = useState<(typeof events)[number]>();
  const [editLocationKind, setEditLocationKind] = useState<'region' | 'nation' | 'global'>(
    'global',
  );
  const [editLocationId, setEditLocationId] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const entryRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusKeyRef = useRef<string | undefined>(undefined);
  const shouldRestoreFocusRef = useRef(false);
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
  const selectedEvent =
    selection?.kind === 'event' ? events.find((event) => event.id === selection.id) : undefined;
  const selectedOperation =
    selection?.kind === 'operation'
      ? timeline.find((entry) => entry.id === selection.id)
      : undefined;

  useEffect(() => {
    if (selection) {
      detailHeadingRef.current?.focus();
      return;
    }
    if (!shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    const key = returnFocusKeyRef.current;
    if (key) entryRefs.current.get(key)?.focus();
  }, [selection]);

  const selectTab = (tab: JournalTab) => {
    setActiveTab(tab);
    setSelection(undefined);
    shouldRestoreFocusRef.current = false;
  };
  const openEntry = (nextSelection: JournalSelection) => {
    returnFocusKeyRef.current = `${nextSelection.kind}:${nextSelection.id}`;
    setSelection(nextSelection);
  };
  const returnToList = () => {
    shouldRestoreFocusRef.current = true;
    setSelection(undefined);
  };
  const registerEntry = (key: string, element: HTMLButtonElement | null) => {
    if (element) entryRefs.current.set(key, element);
    else entryRefs.current.delete(key);
  };
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
      setSelection(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
      ]);
    },
  });
  return (
    <div className={`${styles.pageStack} ${styles.worldJournal}`}>
      <div className={styles.journalTopbar}>
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
        <div
          className={styles.journalTabs}
          role="tablist"
          aria-label={t('events.tabsLabel')}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const nextTab = activeTab === 'news' ? 'operations' : 'news';
            selectTab(nextTab);
            globalThis.document.getElementById(`journal-tab-${nextTab}`)?.focus();
          }}
        >
          {(['news', 'operations'] as const).map((tab) => {
            const count = tab === 'news' ? events.length : timeline.length;
            return (
              <button
                type="button"
                role="tab"
                id={`journal-tab-${tab}`}
                key={tab}
                aria-selected={activeTab === tab}
                aria-controls={`journal-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => selectTab(tab)}
              >
                <span>{t(`events.tabs.${tab}`)}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <section
        className={styles.journalContent}
        role="tabpanel"
        id={`journal-panel-${activeTab}`}
        aria-labelledby={`journal-tab-${activeTab}`}
        data-testid="journal-content"
      >
        {selectedEvent ? (
          <article className={styles.journalDetail} data-testid="journal-detail">
            <button type="button" className={styles.journalBack} onClick={returnToList}>
              <ChevronLeft size={17} />
              {t('common.back')}
            </button>
            <div className={styles.journalDetailMeta}>
              <time dateTime={selectedEvent.gameDate}>
                {formatCalendarDate(selectedEvent.gameDate, i18n.language, 'long')}
              </time>
              <span>{t(`events.types.${selectedEvent.event_type}`)}</span>
              <span data-severity={selectedEvent.severity}>
                {t(`events.severities.${selectedEvent.severity}`)}
              </span>
            </div>
            <h2 ref={detailHeadingRef} tabIndex={-1}>
              {selectedEvent.title}
            </h2>
            <p>{selectedEvent.description}</p>
            {selectedEvent.affected_nations.length ? (
              <div className={styles.journalAffected}>
                <span>{t('events.affected')}</span>
                <strong>{selectedEvent.affected_nations.join(', ')}</strong>
              </div>
            ) : null}
            <div className={styles.journalDetailActions}>
              <button className={styles.primaryButton} onClick={() => onReplay(selectedEvent)}>
                <MapPin size={15} />
                {t('events.showOnMap')}
              </button>
              <button className={styles.button} onClick={() => beginEditing(selectedEvent)}>
                <Pencil size={15} />
                {t('common.edit')}
              </button>
              <button className={styles.textDanger} onClick={() => setDeleting(selectedEvent.id)}>
                <Trash2 size={15} />
                {t('common.delete')}
              </button>
            </div>
          </article>
        ) : selectedOperation ? (
          <article className={styles.journalDetail} data-testid="journal-detail">
            <button type="button" className={styles.journalBack} onClick={returnToList}>
              <ChevronLeft size={17} />
              {t('common.back')}
            </button>
            <div className={styles.journalDetailMeta}>
              <time dateTime={selectedOperation.gameDate}>
                {formatCalendarDate(selectedOperation.gameDate, i18n.language, 'long')}
              </time>
              <span>{t(`strategic.timeline.kinds.${selectedOperation.kind}`)}</span>
            </div>
            <h2 ref={detailHeadingRef} tabIndex={-1}>
              {selectedOperation.title}
            </h2>
            <p>{selectedOperation.description}</p>
            <div className={styles.journalDetailActions}>
              <TimelineReplayButton
                entry={selectedOperation}
                onReplay={() => onReplayTimeline(selectedOperation)}
              />
            </div>
            {(turnDetails.get(selectedOperation.turnNumber)?.length ?? 0) > 0 ? (
              <section className={styles.journalChanges} aria-labelledby="journal-changes-title">
                <header>
                  <h3 id="journal-changes-title">{t('turnSummary.details')}</h3>
                  <span>
                    {t('turnSummary.changes', {
                      count: turnDetails.get(selectedOperation.turnNumber)?.length ?? 0,
                    })}
                  </span>
                </header>
                <TurnMutationSummary
                  mutations={turnDetails.get(selectedOperation.turnNumber) ?? []}
                  onFocus={onFocusMutation}
                />
              </section>
            ) : null}
          </article>
        ) : activeTab === 'news' ? (
          events.length ? (
            <ul className={styles.journalList} aria-label={t('events.tabs.news')}>
              {events.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    ref={(element) => registerEntry(`event:${event.id}`, element)}
                    data-journal-entry="event"
                    onClick={() => openEntry({ kind: 'event', id: event.id })}
                    aria-label={t('events.openEntry', { title: event.title })}
                  >
                    <span className={styles.journalSeverity} data-severity={event.severity} />
                    <span className={styles.journalEntryCopy}>
                      <span className={styles.journalEntryMeta}>
                        <time dateTime={event.gameDate}>
                          {formatCalendarDate(event.gameDate, i18n.language, 'medium')}
                        </time>
                        <span>{t(`events.types.${event.event_type}`)}</span>
                        <span>{t(`events.severities.${event.severity}`)}</span>
                      </span>
                      <strong>{event.title}</strong>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.journalEmpty}>{t('game.noEvents')}</p>
          )
        ) : timeline.length ? (
          <ul className={styles.journalList} aria-label={t('events.tabs.operations')}>
            {timeline.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  ref={(element) => registerEntry(`operation:${entry.id}`, element)}
                  data-journal-entry="operation"
                  data-kind={entry.kind}
                  data-has-changes={
                    (turnDetails.get(entry.turnNumber)?.length ?? 0) > 0 ? 'true' : 'false'
                  }
                  onClick={() => openEntry({ kind: 'operation', id: entry.id })}
                  aria-label={t('events.openEntry', { title: entry.title })}
                >
                  <span className={styles.journalOperationMarker} />
                  <span className={styles.journalEntryCopy}>
                    <span className={styles.journalEntryMeta}>
                      <time dateTime={entry.gameDate}>
                        {formatCalendarDate(entry.gameDate, i18n.language, 'medium')}
                      </time>
                      <span>{t(`strategic.timeline.kinds.${entry.kind}`)}</span>
                    </span>
                    <strong>{entry.title}</strong>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.journalEmpty}>{t('events.noOperations')}</p>
        )}
      </section>
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

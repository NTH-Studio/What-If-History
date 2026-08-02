import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Clock3,
  Command,
  Database,
  FastForward,
  Flag,
  Globe2,
  Home,
  History,
  Landmark,
  LayoutDashboard,
  Menu,
  Settings2,
  Swords,
  Users,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useParams } from 'react-router-dom';
import {
  uuidSchema,
  type EventMapCue,
  type GameEvent,
  type Nation,
  type TimelineEntry,
} from '@what-if-history/contracts';
import { api } from '../api';
import { Preferences } from '../App';
import { ConfirmDialog } from '../components/Dialogs';
import { BrandMark } from '../components/BrandMark';
import { CountriesPanel } from '../components/CountriesPanel';
import { CampaignSettingsPanel, MemoryPanel, WorldPanel } from '../components/AdvancedPanels';
import { LlmActivityIndicator } from '../components/LlmActivity';
import {
  SimulationHistoryPanel,
  TimeAdvanceDialog,
  type TimeJumpDraft,
} from '../components/CampaignSurfaces';
import type { MapSelection } from '../components/MapView';
import { StrategicAudioControl, StrategicTimelineTheater } from '../components/StrategicTimeline';
import { ActionsPanel } from './game/ActionsPanel';
import { AdvisorPanel } from './game/AdvisorPanel';
import { Dashboard } from './game/Dashboard';
import { DiplomacyPanel } from './game/DiplomacyPanel';
import { EventsPanel } from './game/EventsPanel';
import { EventTheater } from './game/EventTheater';
import { eventPlaybackStorageKey, queueEventPlayback } from '../eventPlayback';
import { formatCalendarDate } from '../dateFormatting';
import styles from '../styles/App.module.css';

const primarySections = [
  ['map', Globe2, 'game.map'],
  ['actions', Swords, 'game.actions'],
  ['diplomacy', Users, 'game.diplomacy'],
  ['advisor', Bot, 'game.advisor'],
  ['events', Landmark, 'game.events'],
  ['countries', Flag, 'game.countries'],
] as const;

const commandSections = [
  ['history', History, 'game.history'],
  ['world', Globe2, 'game.world'],
  ['memory', Database, 'game.memory'],
  ['settings', Settings2, 'game.settings'],
] as const;

const dataSections = ['history', 'world', 'memory', 'settings'] as const;

const mobileSections = [
  ['map', Globe2, 'game.map'],
  ['actions', Swords, 'game.actions'],
  ['events', Landmark, 'game.events'],
  ['countries', Flag, 'game.countries'],
] as const;

const campaignSections = [
  'map',
  'actions',
  'diplomacy',
  'advisor',
  'events',
  'countries',
  'dashboard',
  'history',
  'world',
  'memory',
  'settings',
] as const;

type CampaignSection = (typeof campaignSections)[number];
type DataSection = (typeof dataSections)[number];

const isCampaignSection = (value: string): value is CampaignSection =>
  campaignSections.includes(value as CampaignSection);
const isDataSection = (value: CampaignSection): value is DataSection =>
  dataSections.includes(value as DataSection);

const MapView = lazy(() => import('../components/MapView'));

export function GamePage() {
  const {
    gameId = '',
    section: routeSection = 'map',
    countryCode,
  } = useParams<{
    gameId: string;
    section?: string;
    countryCode?: string;
  }>();
  const { t, i18n } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
  const gameIdIsValid = uuidSchema.safeParse(gameId).success;
  const section: CampaignSection =
    routeSection === 'timeline'
      ? 'history'
      : isCampaignSection(routeSection)
        ? routeSection
        : 'map';
  const [timeCommandOpen, setTimeCommandOpen] = useState(false);
  const [timeCommandMinimized, setTimeCommandMinimized] = useState(false);
  const [turnPending, setTurnPending] = useState(false);
  const [timeJump, setTimeJump] = useState<TimeJumpDraft>({
    amount: 1,
    unit: 'month',
    strategy: 'fixed',
  });
  const [recenterToken, setRecenterToken] = useState(0);
  const [playbackEvents, setPlaybackEvents] = useState<GameEvent[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackTimeline, setPlaybackTimeline] = useState<TimelineEntry[]>([]);
  const [timelinePlaybackIndex, setTimelinePlaybackIndex] = useState(0);
  const [closePlaybackOpen, setClosePlaybackOpen] = useState(false);
  const [manualFocusCue, setManualFocusCue] = useState<EventMapCue>();
  const [mapSelection, setMapSelection] = useState<MapSelection>();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const game = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => api.game(gameId),
    enabled: gameIdIsValid,
  });
  const actions = useQuery({
    queryKey: ['actions', gameId],
    queryFn: () => api.actions(gameId),
    enabled: gameIdIsValid,
  });
  const events = useQuery({
    queryKey: ['events', gameId],
    queryFn: () => api.events(gameId),
    enabled: gameIdIsValid,
  });
  const strategic = useQuery({
    queryKey: ['strategic-state', gameId],
    queryFn: () => api.strategicState(gameId),
    enabled: gameIdIsValid,
  });
  const timeline = useQuery({
    queryKey: ['timeline', gameId],
    queryFn: () => api.timeline(gameId),
    enabled: gameIdIsValid,
  });
  const worldHistory = useQuery({
    queryKey: ['world-history', gameId],
    queryFn: () => api.worldHistory(gameId),
    enabled: gameIdIsValid && section === 'events',
  });
  const units = useQuery({
    queryKey: ['units', gameId],
    queryFn: () => api.units(gameId),
    enabled: gameIdIsValid,
  });
  const chats = useQuery({
    queryKey: ['chats', gameId],
    queryFn: () => api.chats(gameId),
    enabled: gameIdIsValid,
  });
  const nations = useQuery({ queryKey: ['nations'], queryFn: api.nations });
  const countries = useQuery({
    queryKey: ['countries', gameId],
    queryFn: () => api.countries(gameId),
    enabled: gameIdIsValid,
  });
  const campaignMapNations = useMemo<Nation[]>(
    () =>
      (countries.data ?? []).map((country) => ({
        code: country.code,
        name: country.name,
        ...(country.capital ? { capital: country.capital } : {}),
        ideology: country.ideology,
        is_major_power: country.isMajorPower,
        color: country.color,
        population: country.indicators.population,
        manpower: country.indicators.manpower,
        leader_name: country.leaderName ?? undefined,
      })),
    [countries.data],
  );
  const playbackStorageKey = eventPlaybackStorageKey(gameId);
  const timelinePlaybackStorageKey = `what-if-history-timeline-playback:${gameId}`;
  const activePlaybackEvent = playbackEvents[playbackIndex];
  const activeTimelineEntry = playbackTimeline[timelinePlaybackIndex];

  useEffect(() => {
    if (!gameIdIsValid) {
      history.replace('/');
    } else if (routeSection === 'timeline') {
      history.replace(`/game/${gameId}/history`);
    } else if (!isCampaignSection(routeSection)) {
      history.replace(`/game/${gameId}/map`);
    }
  }, [gameId, gameIdIsValid, history, routeSection]);

  useEffect(() => {
    if (!gameIdIsValid) return;
    const stream = new EventSource(`/api/v1/stream?gameId=${encodeURIComponent(gameId)}`);
    const refresh = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['actions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['game-regions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['map-features', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['units', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['world-history', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['snapshots', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['strategic-state', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['characters', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['contacts', gameId] }),
      ]);
    };
    stream.addEventListener('turn.completed', refresh);
    stream.addEventListener('world.changed', refresh);
    return () => stream.close();
  }, [gameId, gameIdIsValid, queryClient]);

  useEffect(() => {
    if (!events.data || playbackEvents.length) return;
    const stored = localStorage.getItem(playbackStorageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { eventIds?: string[]; index?: number };
      const restored = (parsed.eventIds ?? [])
        .map((id) => events.data.find((event) => event.id === id))
        .filter((event): event is GameEvent => Boolean(event));
      if (restored.length) {
        setPlaybackEvents(restored);
        setPlaybackIndex(Math.min(parsed.index ?? 0, restored.length - 1));
      } else {
        localStorage.removeItem(playbackStorageKey);
      }
    } catch {
      localStorage.removeItem(playbackStorageKey);
    }
  }, [events.data, playbackEvents.length, playbackStorageKey]);

  useEffect(() => {
    if (!playbackEvents.length) return;
    localStorage.setItem(
      playbackStorageKey,
      JSON.stringify({ eventIds: playbackEvents.map((event) => event.id), index: playbackIndex }),
    );
  }, [playbackEvents, playbackIndex, playbackStorageKey]);

  useEffect(() => {
    if (!timeline.data || playbackTimeline.length) return;
    const stored = localStorage.getItem(timelinePlaybackStorageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as { entryIds?: string[]; index?: number };
      const restored = (parsed.entryIds ?? [])
        .map((id) => timeline.data.find((entry) => entry.id === id))
        .filter((entry): entry is TimelineEntry => Boolean(entry));
      if (restored.length) {
        setPlaybackTimeline(restored);
        setTimelinePlaybackIndex(Math.min(parsed.index ?? 0, restored.length - 1));
      } else {
        localStorage.removeItem(timelinePlaybackStorageKey);
      }
    } catch {
      localStorage.removeItem(timelinePlaybackStorageKey);
    }
  }, [playbackTimeline.length, timeline.data, timelinePlaybackStorageKey]);

  useEffect(() => {
    if (!playbackTimeline.length) return;
    localStorage.setItem(
      timelinePlaybackStorageKey,
      JSON.stringify({
        entryIds: playbackTimeline.map((entry) => entry.id),
        index: timelinePlaybackIndex,
      }),
    );
  }, [playbackTimeline, timelinePlaybackIndex, timelinePlaybackStorageKey]);

  if (game.isLoading) return <main className={styles.loadingScreen}>{t('common.loading')}</main>;
  if (!game.data || game.isError) {
    return (
      <main className={styles.fatalError}>
        <h1>{t('common.error')}</h1>
        <Link className={styles.button} to="/">
          {t('common.back')}
        </Link>
      </main>
    );
  }

  const selectSection = (next: CampaignSection) => {
    setMobileMenuOpen(false);
    history.push(`/game/${gameId}/${next}`);
  };
  const startPlayback = (nextEvents: GameEvent[]) => {
    if (!nextEvents.length) return;
    setPlaybackEvents(nextEvents);
    setPlaybackIndex(0);
    queueEventPlayback(gameId, nextEvents);
  };
  const startTimelinePlayback = (entries: TimelineEntry[]) => {
    if (!entries.length) return;
    setPlaybackEvents([]);
    setPlaybackTimeline([...entries].sort((a, b) => a.sequence - b.sequence));
    setTimelinePlaybackIndex(0);
  };
  const closePlayback = () => {
    setPlaybackEvents([]);
    setPlaybackIndex(0);
    setClosePlaybackOpen(false);
    localStorage.removeItem(playbackStorageKey);
  };
  const closeTimelinePlayback = () => {
    setPlaybackTimeline([]);
    setTimelinePlaybackIndex(0);
    localStorage.removeItem(timelinePlaybackStorageKey);
  };
  const surface =
    section === 'map'
      ? 'none'
      : ['actions', 'diplomacy', 'advisor', 'events'].includes(section)
        ? 'dock'
        : 'workspace';
  const surfaceClass =
    surface === 'dock'
      ? styles.campaignDock
      : surface === 'workspace'
        ? `${styles.campaignDeck} ${styles.campaignWorkspace}`
        : styles.campaignDeck;

  return (
    <main className={styles.gameShell}>
      <header className={styles.gameHeader}>
        <Link to="/" className={styles.gameBrand}>
          <BrandMark size={27} />
          <span>WHAT IF: HISTORY</span>
        </Link>
        <div className={styles.commandIdentity}>
          <strong aria-label={game.data.playerNation.name}>
            <span className={styles.commandNationFull}>{game.data.playerNation.name}</span>
            <span className={styles.commandNationCode} aria-hidden="true">
              {game.data.playerNationCode}
            </span>
          </strong>
          <span>
            {formatCalendarDate(game.data.currentDate, i18n.language, 'medium')} ·{' '}
            {t('game.turn', { turn: game.data.turnNumber })}
          </span>
        </div>
        <button
          type="button"
          className={styles.mobileMenu}
          aria-label={t('game.openMenu')}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((current) => !current)}
        >
          <Menu size={19} />
        </button>
        <button
          type="button"
          className={styles.summaryButton}
          data-active={section === 'dashboard'}
          aria-label={t('game.dashboard')}
          aria-pressed={section === 'dashboard'}
          onClick={() => selectSection('dashboard')}
        >
          <LayoutDashboard size={17} />
          <span>{t('game.dashboard')}</span>
        </button>
        <button
          type="button"
          className={styles.advanceTimeButton}
          data-pending={turnPending}
          aria-label={turnPending ? t('timeline.inProgress') : t('timeline.open')}
          aria-expanded={timeCommandOpen && !timeCommandMinimized}
          onClick={() => {
            if (section !== 'map') selectSection('map');
            setTimeCommandOpen(true);
            setTimeCommandMinimized(false);
          }}
        >
          {turnPending ? (
            <Clock3 className={styles.spinIcon} size={17} />
          ) : (
            <FastForward size={17} />
          )}
          <span>{turnPending ? t('timeline.inProgress') : t('timeline.open')}</span>
        </button>
        <LlmActivityIndicator game={{ id: game.data.id, name: game.data.name }} />
        <StrategicAudioControl
          {...(strategic.data ? { state: strategic.data } : {})}
          {...(activeTimelineEntry ? { activeCue: activeTimelineEntry.cue } : {})}
        />
        <Preferences />
      </header>

      <aside className={`${styles.sidebar} ${mobileMenuOpen ? styles.sidebarOpen : ''}`}>
        <nav aria-label="Campaign">
          {primarySections.map(([key, Icon, label]) => (
            <button
              key={key}
              className={section === key ? styles.navActive : undefined}
              onClick={() => selectSection(key)}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
            </button>
          ))}
          <button
            type="button"
            className={isDataSection(section) ? styles.navActive : undefined}
            aria-expanded={isDataSection(section)}
            onClick={() => selectSection('history')}
          >
            <Command size={18} />
            <span>{t('game.command')}</span>
          </button>
        </nav>
      </aside>
      {mobileMenuOpen ? (
        <button
          type="button"
          className={styles.mobileMenuBackdrop}
          aria-label={t('common.close')}
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <section className={styles.mapStage}>
        <Suspense fallback={<p className={styles.mapLoading}>{t('common.loading')}</p>}>
          <MapView
            gameId={gameId}
            units={units.data ?? []}
            nations={campaignMapNations}
            playerNationCode={game.data.playerNationCode}
            {...(activeTimelineEntry
              ? {
                  focusCue: {
                    camera: 'auto' as const,
                    locations: activeTimelineEntry.cue.locations,
                  },
                }
              : activePlaybackEvent
                ? { focusCue: activePlaybackEvent.map_cue }
                : {})}
            {...(!activeTimelineEntry && !activePlaybackEvent && manualFocusCue
              ? { focusCue: manualFocusCue }
              : {})}
            showIntel={
              section === 'map' && !activeTimelineEntry && !activePlaybackEvent && !timeCommandOpen
            }
            recenterToken={recenterToken}
            surface={surface}
            onCountrySelect={(code) => history.push(`/game/${gameId}/countries/${code}`)}
            onSelectionChange={setMapSelection}
          />
        </Suspense>

        {section !== 'map' ? (
          <aside
            className={`${styles.campaignSurface} ${surfaceClass}`}
            data-surface={surface}
            data-section={section}
            aria-label={t(`game.${section}`)}
          >
            {section === 'dashboard' ? (
              <Dashboard
                game={game.data}
                actions={actions.data ?? []}
                events={events.data ?? []}
                units={units.data ?? []}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {section === 'countries' ? (
              <CountriesPanel
                gameId={gameId}
                playerNationCode={game.data.playerNationCode}
                selectedCode={countryCode}
                onSelect={(code) => history.push(`/game/${gameId}/countries/${code}`)}
                onStartDiplomacy={() => history.push(`/game/${gameId}/diplomacy`)}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {section === 'actions' ? (
              <ActionsPanel
                gameId={gameId}
                actions={actions.data ?? []}
                {...(mapSelection ? { mapSelection } : {})}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {section === 'diplomacy' ? (
              <DiplomacyPanel
                gameId={gameId}
                playerNationCode={game.data.playerNationCode}
                chats={chats.data ?? []}
                nations={nations.data ?? []}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {section === 'advisor' ? (
              <AdvisorPanel
                gameId={gameId}
                {...(mapSelection ? { mapSelection } : {})}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {section === 'events' ? (
              <EventsPanel
                gameId={gameId}
                events={events.data ?? []}
                timeline={timeline.data ?? []}
                mutations={worldHistory.data ?? []}
                onReplay={(event) => {
                  startPlayback([event]);
                  selectSection('map');
                }}
                onReplayTimeline={(entry) => {
                  startTimelinePlayback([entry]);
                  selectSection('map');
                }}
                onFocusMutation={(mutation) => {
                  if (mutation.mutationType !== 'region') return;
                  setManualFocusCue({
                    camera: 'bounds',
                    locations: [{ kind: 'region', role: 'primary', region_id: mutation.targetId }],
                  });
                  selectSection('map');
                }}
                onClose={() => selectSection('map')}
              />
            ) : null}
            {isDataSection(section) ? (
              <section className={styles.dataWorkspace}>
                <header className={styles.dataWorkspaceBar}>
                  <nav
                    className={styles.dataWorkspaceTabs}
                    role="tablist"
                    aria-label={t('game.command')}
                  >
                    {commandSections.map(([key, Icon, label]) => (
                      <button
                        type="button"
                        role="tab"
                        key={key}
                        aria-selected={section === key}
                        className={section === key ? styles.dataWorkspaceTabActive : undefined}
                        onClick={() => selectSection(key)}
                      >
                        <Icon size={17} />
                        <span>{t(label)}</span>
                      </button>
                    ))}
                  </nav>
                  <div className={styles.surfaceHeaderActions}>
                    <Link className={styles.dataWorkspaceHome} to="/">
                      <Home size={16} />
                      <span>{t('game.home')}</span>
                    </Link>
                    <button
                      type="button"
                      className={styles.surfaceClose}
                      aria-label={t('common.close')}
                      onClick={() => selectSection('map')}
                    >
                      <X size={18} />
                    </button>
                  </div>
                </header>
                <div className={styles.dataWorkspaceContent}>
                  {section === 'history' ? (
                    <SimulationHistoryPanel
                      gameId={gameId}
                      onReuse={(jump) => {
                        setTimeJump(jump);
                        selectSection('map');
                        setTimeCommandOpen(true);
                        setTimeCommandMinimized(false);
                      }}
                    />
                  ) : null}
                  {section === 'world' ? (
                    <WorldPanel gameId={gameId} nations={nations.data ?? []} />
                  ) : null}
                  {section === 'memory' ? <MemoryPanel gameId={gameId} /> : null}
                  {section === 'settings' ? <CampaignSettingsPanel game={game.data} /> : null}
                </div>
              </section>
            ) : null}
          </aside>
        ) : null}

        <TimeAdvanceDialog
          gameId={gameId}
          currentDate={game.data.currentDate}
          pendingActions={
            (actions.data ?? []).filter((action) => action.status === 'pending').length
          }
          open={timeCommandOpen}
          minimized={timeCommandMinimized}
          jump={timeJump}
          onJumpChange={setTimeJump}
          onOpenChange={setTimeCommandOpen}
          onMinimizedChange={setTimeCommandMinimized}
          onPendingChange={setTurnPending}
          onTurnCompleted={(result) => {
            setRecenterToken((value) => value + 1);
            void api.timeline(gameId).then((entries) => {
              const turnEntries = entries.filter((entry) => entry.turnNumber === result.turnNumber);
              if (turnEntries.length) startTimelinePlayback(turnEntries);
              else if (result.events.length) startPlayback(result.events);
            });
            selectSection('map');
          }}
        />

        {activeTimelineEntry ? (
          <StrategicTimelineTheater
            entry={activeTimelineEntry}
            index={timelinePlaybackIndex}
            total={playbackTimeline.length}
            onPrevious={() => setTimelinePlaybackIndex((current) => Math.max(0, current - 1))}
            onNext={() => {
              if (timelinePlaybackIndex < playbackTimeline.length - 1) {
                setTimelinePlaybackIndex((current) => current + 1);
              } else {
                closeTimelinePlayback();
              }
            }}
            onClose={closeTimelinePlayback}
          />
        ) : null}

        {activePlaybackEvent && !activeTimelineEntry ? (
          <EventTheater
            key={activePlaybackEvent.id}
            gameId={gameId}
            event={activePlaybackEvent}
            index={playbackIndex}
            total={playbackEvents.length}
            onPrevious={() => setPlaybackIndex((current) => Math.max(0, current - 1))}
            onNext={() => {
              if (playbackIndex < playbackEvents.length - 1) {
                setPlaybackIndex((current) => current + 1);
              } else {
                closePlayback();
              }
            }}
            onClose={() => {
              if (playbackIndex < playbackEvents.length - 1) setClosePlaybackOpen(true);
              else closePlayback();
            }}
            onIntervene={() => {
              closePlayback();
              selectSection('actions');
            }}
          />
        ) : null}
      </section>

      <nav className={styles.mobileBottomNav} aria-label="Campaign">
        {mobileSections.map(([key, Icon, label]) => (
          <button
            key={key}
            className={section === key ? styles.navActive : undefined}
            aria-label={t(label)}
            onClick={() => selectSection(key)}
          >
            <Icon size={19} />
            <span>{t(label)}</span>
          </button>
        ))}
        <button
          type="button"
          className={isDataSection(section) ? styles.navActive : undefined}
          aria-label={t('game.command')}
          aria-expanded={isDataSection(section)}
          onClick={() => selectSection('history')}
        >
          <Command size={19} />
          <span>{t('game.command')}</span>
        </button>
      </nav>
      <ConfirmDialog
        open={closePlaybackOpen}
        onOpenChange={setClosePlaybackOpen}
        title={t('eventTheater.closeTitle')}
        description={t('eventTheater.closeDescription')}
        confirmLabel={t('eventTheater.closeConfirm')}
        onConfirm={async () => closePlayback()}
      />
    </main>
  );
}

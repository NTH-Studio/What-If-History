import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
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
  MapPin,
  Menu,
  MessageSquare,
  Pencil,
  ScrollText,
  Send,
  Shield,
  Save,
  Settings2,
  Sparkles,
  Swords,
  Trash2,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHistory, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import type {
  Action,
  ChatMessage,
  EventLocation,
  GameEvent,
  Nation,
} from '@what-if-history/contracts';
import { api } from '../api';
import { Preferences } from '../App';
import { ConfirmDialog, Modal } from '../components/Dialogs';
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
  const { t } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
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
  const [closePlaybackOpen, setClosePlaybackOpen] = useState(false);
  const [mapSelection, setMapSelection] = useState<MapSelection>();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const game = useQuery({ queryKey: ['game', gameId], queryFn: () => api.game(gameId) });
  const actions = useQuery({ queryKey: ['actions', gameId], queryFn: () => api.actions(gameId) });
  const events = useQuery({ queryKey: ['events', gameId], queryFn: () => api.events(gameId) });
  const units = useQuery({ queryKey: ['units', gameId], queryFn: () => api.units(gameId) });
  const chats = useQuery({ queryKey: ['chats', gameId], queryFn: () => api.chats(gameId) });
  const nations = useQuery({ queryKey: ['nations'], queryFn: api.nations });
  const playbackStorageKey = `what-if-history-event-playback:${gameId}`;
  const activePlaybackEvent = playbackEvents[playbackIndex];

  useEffect(() => {
    if (routeSection === 'timeline') {
      history.replace(`/game/${gameId}/history`);
    } else if (!isCampaignSection(routeSection)) {
      history.replace(`/game/${gameId}/map`);
    }
  }, [gameId, history, routeSection]);

  useEffect(() => {
    const stream = new EventSource(`/api/v1/stream?gameId=${encodeURIComponent(gameId)}`);
    const refresh = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['actions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    };
    stream.addEventListener('turn.completed', refresh);
    return () => stream.close();
  }, [gameId, queryClient]);

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
    localStorage.setItem(
      playbackStorageKey,
      JSON.stringify({ eventIds: nextEvents.map((event) => event.id), index: 0 }),
    );
  };
  const closePlayback = () => {
    setPlaybackEvents([]);
    setPlaybackIndex(0);
    setClosePlaybackOpen(false);
    localStorage.removeItem(playbackStorageKey);
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
          <strong>{game.data.playerNation.name}</strong>
          <span>
            {game.data.currentDate} · {t('game.turn', { turn: game.data.turnNumber })}
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
            nations={nations.data ?? []}
            playerNationCode={game.data.playerNationCode}
            {...(activePlaybackEvent ? { focusCue: activePlaybackEvent.map_cue } : {})}
            showIntel={section === 'map' && !activePlaybackEvent && !timeCommandOpen}
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
            <button
              type="button"
              className={styles.surfaceClose}
              aria-label={t('common.close')}
              onClick={() => selectSection('map')}
            >
              <X size={18} />
            </button>
            {section === 'dashboard' ? (
              <Dashboard
                game={game.data}
                actions={actions.data ?? []}
                events={events.data ?? []}
                units={units.data ?? []}
              />
            ) : null}
            {section === 'countries' ? (
              <CountriesPanel
                gameId={gameId}
                playerNationCode={game.data.playerNationCode}
                selectedCode={countryCode}
                onSelect={(code) => history.push(`/game/${gameId}/countries/${code}`)}
                onStartDiplomacy={() => history.push(`/game/${gameId}/diplomacy`)}
              />
            ) : null}
            {section === 'actions' ? (
              <ActionsPanel
                gameId={gameId}
                actions={actions.data ?? []}
                {...(mapSelection ? { mapSelection } : {})}
              />
            ) : null}
            {section === 'diplomacy' ? (
              <DiplomacyPanel
                gameId={gameId}
                playerNationCode={game.data.playerNationCode}
                chats={chats.data ?? []}
                nations={nations.data ?? []}
              />
            ) : null}
            {section === 'advisor' ? (
              <AdvisorPanel gameId={gameId} {...(mapSelection ? { mapSelection } : {})} />
            ) : null}
            {section === 'events' ? (
              <EventsPanel
                gameId={gameId}
                events={events.data ?? []}
                onReplay={(event) => {
                  startPlayback([event]);
                  selectSection('map');
                }}
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
                  <Link className={styles.dataWorkspaceHome} to="/">
                    <Home size={16} />
                    <span>{t('game.home')}</span>
                  </Link>
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
            startPlayback(result.events);
            selectSection('map');
          }}
        />

        {activePlaybackEvent ? (
          <EventTheater
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

function Dashboard({
  game,
  actions,
  events,
  units,
}: {
  game: Awaited<ReturnType<typeof api.game>>;
  actions: Awaited<ReturnType<typeof api.actions>>;
  events: Awaited<ReturnType<typeof api.events>>;
  units: Awaited<ReturnType<typeof api.units>>;
}) {
  const { t } = useTranslation();
  const player = game.nationStates.find((state) => state.nationCode === game.playerNationCode);
  const metrics = [
    [t('game.stability'), `${Math.round(player?.stability ?? 0)}%`],
    [t('game.warSupport'), `${Math.round(player?.warSupport ?? 0)}%`],
    [t('game.treasury'), Math.round(player?.treasury ?? 0).toLocaleString()],
    [t('game.manpower'), Math.round(player?.manpower ?? 0).toLocaleString()],
  ];
  const pendingActions = actions.filter((action) => action.status === 'pending');
  const latestEvent = events[0];
  return (
    <div className={styles.dashboard}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>SITREP · {game.currentDate}</p>
          <h1>{t('game.strategicOverview')}</h1>
        </div>
        <span className={styles.turnBadge}>{t('game.turn', { turn: game.turnNumber })}</span>
      </header>
      <div className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <div className={styles.dashboardDigest}>
        <article>
          <span>
            <Swords size={15} />
            {t('game.pendingActions')}
          </span>
          <strong>{pendingActions.length}</strong>
          <p>{pendingActions[0]?.actionText ?? t('game.noActions')}</p>
        </article>
        <article>
          <span>
            <Landmark size={15} />
            {t('game.recentEvents')}
          </span>
          <strong>{events.length}</strong>
          <p>{latestEvent?.title ?? t('game.noEvents')}</p>
        </article>
        <article>
          <span>
            <Shield size={15} />
            {t('game.forceOverview')}
          </span>
          <strong>{units.length}</strong>
          <p>{units[0]?.name ?? t('game.noUnits')}</p>
        </article>
        {game.scenarioMode === 'custom' ? (
          <article className={styles.dashboardBriefing}>
            <span>
              <Sparkles size={15} />
              {t('game.scenarioBriefing')}
            </span>
            <p>{game.worldContext}</p>
          </article>
        ) : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header>
        {icon}
        <h2>{title}</h2>
      </header>
      <div>{children}</div>
    </section>
  );
}

function ActionsPanel({
  gameId,
  actions,
  mapSelection,
}: {
  gameId: string;
  actions: Action[];
  mapSelection?: MapSelection;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [type, setType] = useState<Action['actionType']>('general');
  const [suggestions, setSuggestions] = useState('');
  const [deleteId, setDeleteId] = useState<string>();
  const [editAction, setEditAction] = useState<Action>();
  const [lawConfirmationOpen, setLawConfirmationOpen] = useState(false);
  const createMutation = useMutation({
    mutationFn: () => api.createAction(gameId, { actionText: text, actionType: type }),
    onSuccess: async () => {
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  const brainstormMutation = useMutation({
    mutationFn: () => api.brainstorm(gameId),
    onSuccess: (result) => setSuggestions(result.suggestions),
  });
  const enhanceMutation = useMutation({
    mutationFn: () => api.enhanceAction(gameId, text),
    onSuccess: (result) => setText(result.actionText),
  });
  const updateMutation = useMutation({
    mutationFn: (input: { actionText: string; actionType: Action['actionType'] }) =>
      api.updateAction(gameId, editAction!.id, input),
    onSuccess: async () => {
      setEditAction(undefined);
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  const lawMutation = useMutation({
    mutationFn: () => api.promulgateLaw(gameId, text),
    onSuccess: async () => {
      setText('');
      setLawConfirmationOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['actions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['countries', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['country', gameId] }),
      ]);
    },
  });
  const suggestionItems = suggestions
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((item) => item.length > 12);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAction(gameId, id),
    onSuccess: async () => {
      setDeleteId(undefined);
      await queryClient.invalidateQueries({ queryKey: ['actions', gameId] });
    },
  });
  return (
    <div className={styles.pageStack}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>ORDERS · QUEUE</p>
          <h1>{t('actions.title')}</h1>
          <p>{t('actions.description')}</p>
        </div>
        <button
          className={`${styles.button} ${styles.compactHeaderAction}`}
          aria-label={t('actions.brainstorm')}
          title={t('actions.brainstorm')}
          onClick={() => brainstormMutation.mutate()}
        >
          <Sparkles size={18} />
          <span>{t('actions.brainstormShort')}</span>
        </button>
      </header>
      <form
        className={styles.commandForm}
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        {mapSelection ? (
          <div className={styles.mapContextCard}>
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>{mapSelection.name}</strong>
              {t('map.selectionContext', {
                nation: mapSelection.nationCode,
                detail: mapSelection.detail,
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                setText((current) => {
                  const context = t('actions.mapContext', {
                    name: mapSelection.name,
                    nation: mapSelection.nationCode,
                  });
                  return current ? `${current}\n\n${context}` : context;
                })
              }
            >
              {t('map.useForAction')}
            </button>
          </div>
        ) : null}
        <textarea
          data-action-composer
          maxLength={4_000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('actions.placeholder')}
          required
        />
        <div className={styles.commandFooter}>
          <label className={styles.commandTypeField}>
            <span>{t('actions.type')}</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as Action['actionType'])}
            >
              {(['general', 'military', 'diplomatic', 'economic'] as const).map((value) => (
                <option value={value} key={value}>
                  {t(`actions.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.commandActions}>
            <button
              type="button"
              className={styles.button}
              aria-label={t('actions.enhance')}
              title={t('actions.enhance')}
              disabled={!text.trim() || enhanceMutation.isPending}
              onClick={() => enhanceMutation.mutate()}
            >
              <WandSparkles size={17} />
              <span>{t('actions.enhanceShort')}</span>
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.lawButton}`}
              aria-label={t('actions.promulgate')}
              title={t('actions.promulgate')}
              disabled={!text.trim() || lawMutation.isPending || createMutation.isPending}
              onClick={() => setLawConfirmationOpen(true)}
            >
              <ScrollText size={17} />
              <span>{t('actions.promulgateShort')}</span>
            </button>
            <button
              className={styles.primaryButton}
              aria-label={t('actions.submit')}
              title={t('actions.submit')}
              disabled={!text.trim() || createMutation.isPending || lawMutation.isPending}
            >
              <Send size={17} />
              <span>{t('actions.submitShort')}</span>
            </button>
          </div>
        </div>
      </form>
      {suggestions ? (
        <Panel title={t('actions.suggestions')} icon={<Sparkles size={18} />}>
          <div className={styles.suggestionGrid}>
            {suggestionItems.length > 0 ? (
              suggestionItems.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setText(suggestion);
                    globalThis.document
                      .querySelector<HTMLTextAreaElement>('[data-action-composer]')
                      ?.focus();
                  }}
                >
                  <Sparkles size={15} />
                  <span>{suggestion}</span>
                </button>
              ))
            ) : (
              <ReactMarkdown>{suggestions}</ReactMarkdown>
            )}
          </div>
        </Panel>
      ) : null}
      <div className={styles.listCards}>
        {actions.map((action) => (
          <article key={action.id}>
            <header>
              <span>
                {t(
                  `actions.${
                    action.actionType === 'law'
                      ? action.status === 'pending'
                        ? 'enacted'
                        : 'enactedProcessed'
                      : action.status
                  }`,
                )}
              </span>
              <span>{t(`actions.${action.actionType}`)}</span>
            </header>
            <p>{action.actionText}</p>
            {action.aiResponse ? <small>{action.aiResponse}</small> : null}
            {action.status === 'pending' && action.actionType !== 'law' ? (
              <footer className={styles.cardActions}>
                <button className={styles.button} onClick={() => setEditAction(action)}>
                  <Pencil size={15} />
                  {t('common.edit')}
                </button>
                <button className={styles.textDanger} onClick={() => setDeleteId(action.id)}>
                  <Trash2 size={15} />
                  {t('common.delete')}
                </button>
              </footer>
            ) : null}
          </article>
        ))}
      </div>
      <ConfirmDialog
        open={lawConfirmationOpen}
        onOpenChange={setLawConfirmationOpen}
        title={t('actions.promulgateTitle')}
        description={t('actions.promulgateDescription')}
        confirmLabel={t('actions.promulgateConfirm')}
        onConfirm={async () => {
          await lawMutation.mutateAsync();
        }}
      />
      <Modal
        open={Boolean(editAction)}
        onOpenChange={(open) => !open && setEditAction(undefined)}
        title={t('actions.editTitle')}
        description={t('actions.editDescription')}
      >
        {editAction ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              updateMutation.mutate({
                actionText: String(data.get('actionText')),
                actionType: data.get('actionType') as Action['actionType'],
              });
            }}
          >
            <label>
              <span>{t('actions.type')}</span>
              <select name="actionType" defaultValue={editAction.actionType}>
                {(['general', 'military', 'diplomatic', 'economic'] as const).map((value) => (
                  <option value={value} key={value}>
                    {t(`actions.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('actions.order')}</span>
              <textarea
                name="actionText"
                defaultValue={editAction.actionText}
                maxLength={4_000}
                rows={8}
                required
              />
            </label>
            <footer className={styles.dialogActions}>
              <button className={styles.primaryButton}>{t('common.save')}</button>
            </footer>
          </form>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(undefined)}
        title={t('common.delete')}
        description={t('home.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteId) await deleteMutation.mutateAsync(deleteId);
        }}
      />
    </div>
  );
}

function DiplomacyPanel({
  gameId,
  playerNationCode,
  chats,
  nations,
}: {
  gameId: string;
  playerNationCode: string;
  chats: Awaited<ReturnType<typeof api.chats>>;
  nations: Nation[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeChatId, setActiveChatId] = useState<string | undefined>(chats[0]?.id);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const messages = useQuery({
    queryKey: ['messages', gameId, activeChatId],
    queryFn: () => api.messages(gameId, activeChatId!),
    enabled: Boolean(activeChatId),
  });
  const createMutation = useMutation({
    mutationFn: () => api.createChat(gameId, targets),
    onSuccess: async (chat) => {
      setActiveChatId(chat.id);
      setTargets([]);
      setNewChatOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['chats', gameId] });
    },
  });
  const sendMutation = useMutation({
    mutationFn: (text: string) => api.sendMessage(gameId, activeChatId!, text),
    onSuccess: async () => {
      setMessage('');
      await queryClient.invalidateQueries({ queryKey: ['messages', gameId, activeChatId] });
    },
  });
  const speakerMutation = useMutation({
    mutationFn: (nationCode: string) => api.setChatSpeaker(gameId, activeChatId!, nationCode),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['chats', gameId] }),
  });
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  useEffect(() => {
    if (!activeChatId && chats[0]) setActiveChatId(chats[0].id);
  }, [activeChatId, chats]);

  return (
    <div className={styles.pageStack}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>DIPLOMACY · SECURE</p>
          <h1>{t('diplomacy.title')}</h1>
        </div>
        {chats.length ? (
          <button
            className={`${styles.primaryButton} ${styles.compactHeaderAction}`}
            aria-label={t('diplomacy.newChat')}
            title={t('diplomacy.newChat')}
            onClick={() => setNewChatOpen(true)}
          >
            <MessageSquare size={18} />
            <span>{t('diplomacy.newChatShort')}</span>
          </button>
        ) : null}
      </header>
      {chats.length === 0 ? (
        <section className={styles.chatEmptyState}>
          <MessageSquare size={24} />
          <strong>{t('diplomacy.noChats')}</strong>
          <p>{t('diplomacy.emptyHint')}</p>
          <button className={styles.primaryButton} onClick={() => setNewChatOpen(true)}>
            <MessageSquare size={16} />
            {t('diplomacy.newChat')}
          </button>
        </section>
      ) : (
        <div className={styles.chatLayout}>
          <aside className={styles.chatList}>
            {chats.map((chat) => (
              <button
                key={chat.id}
                className={activeChatId === chat.id ? styles.chatActive : undefined}
                onClick={() => setActiveChatId(chat.id)}
              >
                <span>
                  {chat.participants.map((participant) => participant.nationCode).join(' · ')}
                </span>
                <strong>
                  {chat.participants.map((participant) => participant.nationName).join(', ')}
                </strong>
              </button>
            ))}
          </aside>
          <section className={styles.chatWindow}>
            {activeChat ? (
              <header className={styles.chatContext}>
                <div className={styles.participantBadges}>
                  {activeChat.participants.map((participant) => (
                    <span key={participant.nationCode}>{participant.nationCode}</span>
                  ))}
                </div>
                <label>
                  <span>{t('diplomacy.nextSpeaker')}</span>
                  <select
                    value={activeChat.nextSpeakerNationCode ?? ''}
                    onChange={(event) => speakerMutation.mutate(event.target.value)}
                  >
                    {activeChat.participants.map((participant) => (
                      <option key={participant.nationCode} value={participant.nationCode}>
                        {participant.nationName}
                      </option>
                    ))}
                  </select>
                </label>
              </header>
            ) : null}
            <div className={styles.messages} aria-live="polite">
              {messages.data?.map((item) => (
                <MessageBubble
                  key={item.id}
                  message={item}
                  player={item.senderNation === playerNationCode}
                />
              ))}
              {activeChatId && messages.data?.length === 0 ? (
                <p className={styles.muted}>{t('diplomacy.noMessages')}</p>
              ) : null}
            </div>
            {activeChatId ? (
              <form
                className={styles.messageForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMutation.mutate(message);
                }}
              >
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={4_000}
                  placeholder={t('diplomacy.placeholder')}
                  required
                />
                <button className={styles.primaryButton} disabled={sendMutation.isPending}>
                  <Send size={17} />
                  {t('common.send')}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      )}
      <Modal open={newChatOpen} onOpenChange={setNewChatOpen} title={t('diplomacy.newChat')}>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <fieldset className={styles.selectionGrid}>
            <legend>{t('diplomacy.nations')}</legend>
            {nations
              .filter((nation) => nation.code !== playerNationCode)
              .map((nation) => (
                <label key={nation.code} data-selected={targets.includes(nation.code)}>
                  <input
                    type="checkbox"
                    checked={targets.includes(nation.code)}
                    onChange={() =>
                      setTargets((current) =>
                        current.includes(nation.code)
                          ? current.filter((code) => code !== nation.code)
                          : current.length < 8
                            ? [...current, nation.code]
                            : current,
                      )
                    }
                  />
                  <span>{nation.name}</span>
                  <strong>{nation.code}</strong>
                </label>
              ))}
          </fieldset>
          <footer className={styles.dialogActions}>
            <button
              className={styles.primaryButton}
              disabled={targets.length === 0 || createMutation.isPending}
            >
              {t('diplomacy.open')}
            </button>
          </footer>
        </form>
      </Modal>
    </div>
  );
}

function MessageBubble({ message, player }: { message: ChatMessage; player: boolean }) {
  return (
    <article className={`${styles.messageBubble} ${player ? styles.messagePlayer : ''}`}>
      <header>
        <strong>{message.senderName}</strong>
        <span>{message.leaderName}</span>
      </header>
      <p>{message.messageText}</p>
    </article>
  );
}

function AdvisorPanel({ gameId, mapSelection }: { gameId: string; mapSelection?: MapSelection }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const messages = useQuery({
    queryKey: ['advisor-messages', gameId],
    queryFn: () => api.advisorMessages(gameId),
  });
  const mutation = useMutation({
    mutationFn: (prompt: string) => api.advisor(gameId, prompt),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ['advisor-messages', gameId] }),
  });
  const clearMutation = useMutation({
    mutationFn: () => api.clearAdvisor(gameId),
    onSuccess: async () => {
      setClearOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['advisor-messages', gameId] });
    },
  });
  const promptKeys = ['priorities', 'risks', 'diplomacy', 'economy'] as const;
  return (
    <div className={styles.pageStack}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>ADVISOR · ANALYSIS</p>
          <h1>{t('advisor.title')}</h1>
          <p>{t('advisor.description')}</p>
        </div>
        {messages.data?.length ? (
          <button className={styles.button} onClick={() => setClearOpen(true)}>
            <Trash2 size={16} />
            {t('advisor.clear')}
          </button>
        ) : null}
      </header>
      <section
        className={styles.advisorConsole}
        data-empty={!messages.isLoading && messages.data?.length === 0}
      >
        {mapSelection ? (
          <div className={styles.mapContextCard}>
            <MapPin size={18} aria-hidden="true" />
            <span>
              <strong>{mapSelection.name}</strong>
              {t('map.selectionContext', {
                nation: mapSelection.nationCode,
                detail: mapSelection.detail,
              })}
            </span>
            <button
              type="button"
              onClick={() =>
                setQuestion(
                  t('advisor.mapQuestion', {
                    name: mapSelection.name,
                    nation: mapSelection.nationCode,
                  }),
                )
              }
            >
              {t('map.askAdvisor')}
            </button>
          </div>
        ) : null}
        <div className={styles.messages} aria-live="polite">
          {messages.data?.map((message) => (
            <article
              className={`${styles.advisorMessage} ${
                message.role === 'user' ? styles.messagePlayer : ''
              }`}
              key={message.id}
            >
              {message.role === 'advisor' ? (
                <ReactMarkdown>{message.messageText}</ReactMarkdown>
              ) : (
                <p>{message.messageText}</p>
              )}
            </article>
          ))}
          {!messages.isLoading && messages.data?.length === 0 ? (
            <>
              <p className={styles.muted}>{t('advisor.empty')}</p>
              <div className={styles.promptChips}>
                {promptKeys.map((key) => (
                  <button key={key} type="button" onClick={() => setQuestion(t(`advisor.${key}`))}>
                    {t(`advisor.${key}`)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <form
          className={styles.messageForm}
          onSubmit={(event) => {
            event.preventDefault();
            const sent = question;
            mutation.mutate(sent);
            setQuestion('');
          }}
        >
          <textarea
            maxLength={4_000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('advisor.placeholder')}
            required
          />
          <button
            className={styles.primaryButton}
            aria-label={t('advisor.ask')}
            title={t('advisor.ask')}
            disabled={mutation.isPending}
          >
            <Sparkles size={17} />
            {t('advisor.askShort')}
          </button>
        </form>
      </section>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('advisor.clearTitle')}
        description={t('advisor.clearDescription')}
        confirmLabel={t('advisor.clear')}
        onConfirm={async () => clearMutation.mutateAsync()}
      />
    </div>
  );
}

function EventTheater({
  gameId,
  event,
  index,
  total,
  onPrevious,
  onNext,
  onClose,
  onIntervene,
}: {
  gameId: string;
  event: GameEvent;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onIntervene: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [animationsSkipped, setAnimationsSkipped] = useState(false);
  const saveMutation = useMutation({
    mutationFn: () =>
      api.createSnapshot(
        gameId,
        t('eventTheater.snapshotLabel', { date: event.gameDate, position: index + 1 }),
      ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['snapshots', gameId] }),
  });
  const primaryLocation =
    event.map_cue.locations.find((location) => location.role === 'primary') ??
    event.map_cue.locations[0];
  const locationLabel = primaryLocation
    ? (primaryLocation.label ??
      (primaryLocation.kind === 'region'
        ? primaryLocation.region_id
        : primaryLocation.kind === 'feature'
          ? t('eventTheater.mapFeature')
          : primaryLocation.kind === 'unit'
            ? t('eventTheater.unit')
            : primaryLocation.kind === 'nation'
              ? primaryLocation.nation_code
              : primaryLocation.kind === 'global'
                ? t('eventTheater.global')
                : t('eventTheater.coordinates')))
    : t('eventTheater.unspecified');
  const affectedChanges = Object.keys(event.state_changes);

  useEffect(() => {
    const handleKey = (keyboardEvent: KeyboardEvent) => {
      const target = keyboardEvent.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (keyboardEvent.key === 'ArrowLeft' && index > 0) {
        keyboardEvent.preventDefault();
        onPrevious();
      }
      if (keyboardEvent.key === 'ArrowRight' || keyboardEvent.key === ' ') {
        keyboardEvent.preventDefault();
        onNext();
      }
      if (keyboardEvent.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', handleKey);
    return () => globalThis.removeEventListener('keydown', handleKey);
  }, [index, onClose, onNext, onPrevious]);

  useEffect(() => {
    if (animationsSkipped) {
      globalThis.document.documentElement.dataset.reduceMapMotion = 'true';
    } else {
      delete globalThis.document.documentElement.dataset.reduceMapMotion;
    }
    return () => {
      delete globalThis.document.documentElement.dataset.reduceMapMotion;
    };
  }, [animationsSkipped]);

  return (
    <section
      className={`${styles.eventTheater} ${animationsSkipped ? styles.motionSkipped : ''}`}
      aria-labelledby="event-theater-title"
      aria-live="polite"
    >
      <header className={styles.eventTheaterHeader}>
        <div>
          <span>{t('eventTheater.progress', { current: index + 1, total })}</span>
          <span>{event.gameDate}</span>
        </div>
        <button type="button" aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className={styles.eventTheaterMeta}>
        <span data-severity={event.severity}>{t(`events.severities.${event.severity}`)}</span>
        <span>{t(`events.types.${event.event_type}`)}</span>
        <span>
          <MapPin size={14} />
          {locationLabel}
        </span>
      </div>
      <h2 id="event-theater-title">{event.title}</h2>
      <p>{event.description}</p>
      {affectedChanges.length ? (
        <div className={styles.eventChanges}>
          <strong>{t('eventTheater.consequences')}</strong>
          <span>{affectedChanges.join(' · ')}</span>
        </div>
      ) : null}
      <div className={styles.eventTheaterTools}>
        <button type="button" className={styles.button} onClick={() => saveMutation.mutate()}>
          <Save size={15} />
          {saveMutation.isSuccess ? t('common.saved') : t('eventTheater.save')}
        </button>
        <button type="button" className={styles.button} onClick={onIntervene}>
          <Swords size={15} />
          {t('eventTheater.intervene')}
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={animationsSkipped}
          onClick={() => setAnimationsSkipped((value) => !value)}
        >
          <FastForward size={15} />
          {t('eventTheater.skipAnimations')}
        </button>
      </div>
      <footer className={styles.eventTheaterNavigation}>
        <button type="button" className={styles.button} disabled={index === 0} onClick={onPrevious}>
          <ChevronLeft size={17} />
          {t('eventTheater.previous')}
        </button>
        <div className={styles.eventProgressDots} aria-hidden="true">
          {Array.from({ length: total }, (_, dotIndex) => (
            <span key={dotIndex} data-active={dotIndex === index} />
          ))}
        </div>
        <button type="button" className={styles.primaryButton} onClick={onNext}>
          {index === total - 1 ? t('eventTheater.finish') : t('eventTheater.next')}
          <ChevronRight size={17} />
        </button>
      </footer>
    </section>
  );
}

function EventsPanel({
  gameId,
  events,
  onReplay,
}: {
  gameId: string;
  events: Awaited<ReturnType<typeof api.events>>;
  onReplay: (event: GameEvent) => void;
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
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>WORLD · FEED</p>
          <h1>{t('events.title')}</h1>
        </div>
      </header>
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

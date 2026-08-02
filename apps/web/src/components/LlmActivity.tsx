import * as Dialog from '@radix-ui/react-dialog';
import * as Toast from '@radix-ui/react-toast';
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, Clock3, LoaderCircle, WifiOff, X, XCircle } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { LlmActivity } from '@what-if-history/contracts';
import { llmActivitySchema } from '@what-if-history/contracts';
import { api } from '../api';
import { formatTimestamp } from '../dateFormatting';
import styles from '../styles/App.module.css';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface PanelGame {
  id: string;
  name: string;
}

interface ActivityContextValue {
  activities: LlmActivity[];
  connection: ConnectionState;
  elapsedSeconds: number;
  openPanel(game?: PanelGame): void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

function sortActivities(activities: LlmActivity[]) {
  return [...activities].sort((left, right) => {
    if (left.status === 'running' && right.status !== 'running') return -1;
    if (right.status === 'running' && left.status !== 'running') return 1;
    return (
      Date.parse(right.completedAt ?? right.startedAt) -
      Date.parse(left.completedAt ?? left.startedAt)
    );
  });
}

export function LlmActivityProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<LlmActivity[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelGame, setPanelGame] = useState<PanelGame>();
  const [filter, setFilter] = useState<'all' | 'game'>('all');
  const [toast, setToast] = useState<LlmActivity>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const notified = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ['llm-activity'],
    queryFn: () => api.llmActivity(),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (query.data) setActivities(sortActivities(query.data));
  }, [query.data]);

  const upsert = useCallback((activity: LlmActivity) => {
    setActivities((current) =>
      sortActivities([activity, ...current.filter((item) => item.id !== activity.id)]),
    );
    if (
      activity.initiatedHere &&
      activity.status !== 'running' &&
      !notified.current.has(activity.id)
    ) {
      notified.current.add(activity.id);
      setToast(activity);
    }
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setConnection('disconnected');
      return;
    }
    const stream = new EventSource(api.llmActivityStreamUrl());
    const connected = () => {
      setConnection('connected');
      void query.refetch();
    };
    const changed = (event: MessageEvent) => {
      try {
        const parsed = llmActivitySchema.safeParse(JSON.parse(String(event.data)));
        if (parsed.success) upsert(parsed.data);
      } catch {
        // Ignore malformed or partial SSE frames; the reconnect refresh is authoritative.
      }
    };
    stream.addEventListener('connected', connected);
    stream.addEventListener('llm.activity', changed);
    stream.onerror = () => setConnection('disconnected');
    return () => stream.close();
  }, [query.refetch, upsert]);

  const hasRunning = activities.some((activity) => activity.status === 'running');
  useEffect(() => {
    if (!hasRunning) {
      setElapsedSeconds(0);
      return;
    }
    const update = () => setElapsedSeconds(Math.floor(Date.now() / 1_000));
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [hasRunning]);

  const openPanel = useCallback(
    (game?: PanelGame) => {
      setPanelGame(game);
      setFilter(game ? 'game' : 'all');
      setPanelOpen(true);
      void query.refetch();
    },
    [query.refetch],
  );

  const visibleActivities = useMemo(
    () =>
      filter === 'game' && panelGame
        ? activities.filter((activity) => activity.gameId === panelGame.id)
        : activities,
    [activities, filter, panelGame],
  );

  return (
    <ActivityContext.Provider value={{ activities, connection, elapsedSeconds, openPanel }}>
      <Toast.Provider swipeDirection="right">
        {children}
        <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={styles.activityOverlay} />
            <Dialog.Content className={styles.activityPanel}>
              <header className={styles.activityPanelHeader}>
                <div>
                  <Dialog.Title>{t('llmActivity.title')}</Dialog.Title>
                  <Dialog.Description>{t('llmActivity.description')}</Dialog.Description>
                </div>
                <Dialog.Close className={styles.iconButton} aria-label={t('common.close')}>
                  <X size={19} />
                </Dialog.Close>
              </header>
              {panelGame ? (
                <div className={styles.activityFilters} aria-label={t('llmActivity.filters')}>
                  <button
                    className={filter === 'all' ? styles.activityFilterActive : undefined}
                    onClick={() => setFilter('all')}
                  >
                    {t('llmActivity.all')}
                  </button>
                  <button
                    className={filter === 'game' ? styles.activityFilterActive : undefined}
                    onClick={() => setFilter('game')}
                  >
                    {t('llmActivity.thisCampaign')}
                  </button>
                </div>
              ) : null}
              <div className={styles.activityList}>
                {visibleActivities.length === 0 ? (
                  <div className={styles.activityEmpty}>
                    <Bot size={28} />
                    <p>{t('llmActivity.empty')}</p>
                  </div>
                ) : (
                  visibleActivities.map((activity) => (
                    <ActivityCard
                      key={activity.id}
                      activity={activity}
                      nowSeconds={elapsedSeconds}
                    />
                  ))
                )}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        {toast ? (
          <Toast.Root
            className={`${styles.activityToast} ${
              toast.status === 'failed' ? styles.activityToastFailed : ''
            }`}
            open
            duration={toast.status === 'failed' ? 8_000 : 4_000}
            onOpenChange={(open) => {
              if (!open) setToast(undefined);
            }}
          >
            <Toast.Title>
              {toast.status === 'failed'
                ? t('llmActivity.toastFailed')
                : t('llmActivity.toastSucceeded')}
            </Toast.Title>
            <Toast.Description>
              {t(`llmActivity.types.${toast.type}`)}
              {toast.gameName ? ` · ${toast.gameName}` : ''}
            </Toast.Description>
            <Toast.Close className={styles.iconButton} aria-label={t('common.close')}>
              <X size={16} />
            </Toast.Close>
          </Toast.Root>
        ) : null}
        <Toast.Viewport className={styles.activityToastViewport} />
      </Toast.Provider>
    </ActivityContext.Provider>
  );
}

export function LlmActivityIndicator({ game }: { game?: PanelGame }) {
  const { t } = useTranslation();
  const context = useLlmActivity();
  const running = context.activities.filter((activity) => activity.status === 'running');
  const current = running[0];
  const disconnected = context.connection === 'disconnected';
  let label = t('llmActivity.available');
  if (disconnected) label = t('llmActivity.disconnected');
  else if (running.length > 1) label = t('llmActivity.concurrent', { count: running.length });
  else if (current) {
    label = `${t(`llmActivity.types.${current.type}`)} · ${t(
      `llmActivity.phases.${current.phase}`,
    )}`;
  }
  const elapsed = current
    ? Math.max(0, context.elapsedSeconds - Math.floor(Date.parse(current.startedAt) / 1_000))
    : 0;

  return (
    <button
      className={`${styles.activityIndicator} ${
        current ? styles.activityIndicatorRunning : ''
      } ${disconnected ? styles.activityIndicatorDisconnected : ''}`}
      onClick={() => context.openPanel(game)}
      aria-label={t('llmActivity.open')}
      aria-live="polite"
    >
      {disconnected ? (
        <WifiOff size={15} />
      ) : current ? (
        <LoaderCircle className={styles.activitySpinner} size={15} />
      ) : (
        <span className={styles.activityDot} aria-hidden="true" />
      )}
      <span className={styles.activityIndicatorLabel}>{label}</span>
      {current ? <time>{formatDuration(elapsed)}</time> : null}
    </button>
  );
}

function ActivityCard({ activity, nowSeconds }: { activity: LlmActivity; nowSeconds: number }) {
  const { t, i18n } = useTranslation();
  const duration =
    activity.status === 'running'
      ? Math.max(0, nowSeconds - Math.floor(Date.parse(activity.startedAt) / 1_000))
      : Math.round((activity.durationMs ?? 0) / 1_000);
  const StatusIcon =
    activity.status === 'running'
      ? Clock3
      : activity.status === 'succeeded'
        ? CheckCircle2
        : XCircle;
  return (
    <article className={styles.activityCard}>
      <div className={styles.activityCardTop}>
        <StatusIcon aria-hidden="true" size={17} />
        <div>
          <strong>{t(`llmActivity.types.${activity.type}`)}</strong>
          <span>{activity.gameName ?? t('llmActivity.noCampaign')}</span>
        </div>
        <span data-status={activity.status}>{t(`llmActivity.statuses.${activity.status}`)}</span>
      </div>
      <dl>
        <div>
          <dt>{t('llmActivity.step')}</dt>
          <dd>{t(`llmActivity.phases.${activity.phase}`)}</dd>
        </div>
        <div>
          <dt>{t('llmActivity.provider')}</dt>
          <dd>
            {activity.provider} · {activity.model}
          </dd>
        </div>
        <div>
          <dt>{t('llmActivity.started')}</dt>
          <dd>
            {formatTimestamp(activity.startedAt, i18n.language, {
              dateStyle: 'short',
              timeStyle: 'medium',
            })}
          </dd>
        </div>
        <div>
          <dt>{t('llmActivity.duration')}</dt>
          <dd>{formatDuration(duration)}</dd>
        </div>
        <div>
          <dt>{t('llmActivity.tokens')}</dt>
          <dd>
            {activity.usage
              ? t('llmActivity.tokenCount', {
                  input: activity.usage.inputTokens,
                  output: activity.usage.outputTokens,
                  total: activity.usage.totalTokens,
                })
              : t('llmActivity.notReported')}
          </dd>
        </div>
        {activity.errorCode ? (
          <div>
            <dt>{t('llmActivity.errorCode')}</dt>
            <dd>{activity.errorCode}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('llmActivity.requestId')}</dt>
          <dd className={styles.activityRequestId}>{activity.requestId}</dd>
        </div>
      </dl>
    </article>
  );
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, seconds);
  if (safe < 60) return `${safe}s`;
  return `${Math.floor(safe / 60)}m ${safe % 60}s`;
}

function useLlmActivity() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error('LlmActivityProvider is missing.');
  return context;
}

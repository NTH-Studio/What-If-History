import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Minimize2,
  Play,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeJump, TurnResult, TurnRun } from '@what-if-history/contracts';
import { ApiError, api } from '../api';
import styles from '../styles/App.module.css';

export type TimeJumpDraft = Required<Pick<TimeJump, 'amount' | 'unit' | 'strategy'>>;

const defaultJump: TimeJumpDraft = {
  amount: 1,
  unit: 'month',
  strategy: 'fixed',
};

function targetDate(currentDate: string, jump: TimeJumpDraft) {
  const date = new Date(`${currentDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return currentDate;
  if (jump.unit === 'day') date.setUTCDate(date.getUTCDate() + jump.amount);
  if (jump.unit === 'week') date.setUTCDate(date.getUTCDate() + jump.amount * 7);
  if (jump.unit === 'month') date.setUTCMonth(date.getUTCMonth() + jump.amount);
  if (jump.unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + jump.amount);
  return date.toISOString().slice(0, 10);
}

function friendlyTurnError(error: Error | null, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  const code = error.problem.code;
  if (code.includes('TIMEOUT')) return 'timeline.errors.timeout';
  if (code.includes('VALIDATION') || code.includes('AI_RESPONSE'))
    return 'timeline.errors.validation';
  if (code.includes('PROVIDER') || code.includes('CONNECTION')) return 'timeline.errors.provider';
  return 'timeline.errors.generic';
}

export function TimeAdvanceDialog({
  gameId,
  currentDate,
  pendingActions,
  open,
  minimized,
  jump,
  onJumpChange,
  onOpenChange,
  onMinimizedChange,
  onPendingChange,
  onTurnCompleted,
}: {
  gameId: string;
  currentDate: string;
  pendingActions: number;
  open: boolean;
  minimized: boolean;
  jump: TimeJumpDraft;
  onJumpChange: (jump: TimeJumpDraft) => void;
  onOpenChange: (open: boolean) => void;
  onMinimizedChange: (minimized: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onTurnCompleted: (result: TurnResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: () => api.advanceTurn(gameId, jump),
    onMutate: () => {
      submitting.current = true;
      onPendingChange(true);
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['game', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['actions', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['events', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['turn-runs', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['snapshots', gameId] }),
        queryClient.invalidateQueries({ queryKey: ['consolidations', gameId] }),
      ]);
      onOpenChange(false);
      onMinimizedChange(false);
      onTurnCompleted(result);
    },
    onSettled: () => {
      submitting.current = false;
      onPendingChange(false);
    },
  });
  const preview = useMemo(() => targetDate(currentDate, jump), [currentDate, jump]);
  const formattedPreview = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
        new Date(`${preview}T12:00:00Z`),
      ),
    [i18n.language, preview],
  );

  if (!open && !mutation.isPending) return null;

  const submit = () => {
    if (submitting.current || mutation.isPending) return;
    submitting.current = true;
    mutation.mutate();
  };
  const errorKey = friendlyTurnError(
    mutation.error instanceof Error ? mutation.error : null,
    'timeline.errors.generic',
  );

  return (
    <section
      className={`${styles.timeCommand} ${minimized ? styles.timeCommandMinimized : ''}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="time-command-title"
      data-testid="time-advance-command"
    >
      <header className={styles.timeCommandHeader}>
        <div>
          <span className={styles.surfaceKicker}>{t('timeline.commandKicker')}</span>
          <h2 id="time-command-title">{t('timeline.title')}</h2>
        </div>
        <div className={styles.surfaceActions}>
          {mutation.isPending ? (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('timeline.minimize')}
              onClick={() => onMinimizedChange(true)}
            >
              <Minimize2 size={17} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('common.close')}
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className={styles.timeCommandGrid}>
        <label>
          <span>{t('timeline.amount')}</span>
          <input
            type="number"
            min={1}
            max={365}
            value={jump.amount}
            disabled={mutation.isPending}
            onChange={(event) =>
              onJumpChange({
                ...jump,
                amount: Math.min(365, Math.max(1, Number(event.target.value) || 1)),
              })
            }
          />
        </label>
        <label>
          <span>{t('timeline.unit')}</span>
          <select
            value={jump.unit}
            disabled={mutation.isPending}
            onChange={(event) =>
              onJumpChange({ ...jump, unit: event.target.value as TimeJumpDraft['unit'] })
            }
          >
            {(['day', 'week', 'month', 'year'] as const).map((unit) => (
              <option value={unit} key={unit}>
                {t(`timeline.${unit}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.timeStrategy}>
          <span>{t('timeline.strategy')}</span>
          <select
            value={jump.strategy}
            disabled={mutation.isPending}
            onChange={(event) =>
              onJumpChange({
                ...jump,
                strategy: event.target.value as TimeJumpDraft['strategy'],
              })
            }
          >
            <option value="fixed">{t('timeline.fixed')}</option>
            <option value="next_major_event">{t('timeline.nextMajorEvent')}</option>
          </select>
        </label>
      </div>

      <div className={styles.timePreview}>
        <CalendarClock size={20} />
        <div>
          <span>{t('timeline.targetDate')}</span>
          <strong>
            {jump.strategy === 'next_major_event' ? t('timeline.beforeDate') : ''}
            {formattedPreview}
          </strong>
        </div>
        <div>
          <span>{t('game.pendingActions')}</span>
          <strong>{pendingActions}</strong>
        </div>
      </div>

      {mutation.isError ? (
        <div className={styles.compactTurnError} role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>{t('timeline.failedTitle')}</strong>
            <p>{t(errorKey)}</p>
            {mutation.error instanceof ApiError ? (
              <details>
                <summary>
                  {t('timeline.technicalDetails')} <ChevronDown size={14} />
                </summary>
                <code>{mutation.error.problem.code}</code>
                <small>{mutation.error.problem.requestId}</small>
              </details>
            ) : null}
          </div>
          <div className={styles.turnErrorActions}>
            <button type="button" className={styles.button} onClick={submit}>
              <RefreshCw size={15} />
              {t('timeline.retry')}
            </button>
            <button type="button" className={styles.button} onClick={() => mutation.reset()}>
              {t('timeline.modify')}
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.primaryButton}
        disabled={mutation.isPending}
        onClick={submit}
      >
        {mutation.isPending ? <Clock3 className={styles.spinIcon} size={18} /> : <Play size={18} />}
        {mutation.isPending ? t('timeline.inProgress') : t('timeline.launch')}
      </button>
    </section>
  );
}

type HistoryFilter = 'all' | 'completed' | 'failed';

function runDuration(run: TurnRun) {
  if (!run.completedAt) return undefined;
  const duration = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function SimulationHistoryPanel({
  gameId,
  onReuse,
}: {
  gameId: string;
  onReuse: (jump: TimeJumpDraft) => void;
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const runs = useQuery({
    queryKey: ['turn-runs', gameId],
    queryFn: () => api.turnRuns(gameId),
  });
  const visibleRuns = (runs.data ?? []).filter((run) => filter === 'all' || run.status === filter);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }),
    [i18n.language],
  );

  return (
    <div className={styles.historyPanel} data-testid="simulation-history">
      <header className={styles.dataSurfaceHeader}>
        <div>
          <span className={styles.surfaceKicker}>{t('timeline.historyKicker')}</span>
          <h1>{t('timeline.runs')}</h1>
          <p>{t('timeline.historyDescription')}</p>
        </div>
        <div className={styles.historyFilters} aria-label={t('timeline.filters')}>
          {(['all', 'completed', 'failed'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`timeline.filter.${value}`)}
            </button>
          ))}
        </div>
      </header>

      {runs.isLoading ? <p className={styles.muted}>{t('common.loading')}</p> : null}
      {!runs.isLoading && visibleRuns.length === 0 ? (
        <div className={styles.historyEmpty}>
          <Clock3 size={24} />
          <p>{t('timeline.noRuns')}</p>
        </div>
      ) : null}
      <div className={styles.historyTable}>
        {visibleRuns.map((run) => {
          const duration = runDuration(run);
          const complete = run.status === 'completed';
          const jump = run.jump ?? defaultJump;
          return (
            <article key={run.id} data-status={run.status}>
              <div className={styles.historyStatus}>
                {complete ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                <div>
                  <strong>{t(`timeline.status.${run.status}`)}</strong>
                  <span>{t('game.turn', { turn: run.turnNumber })}</span>
                </div>
              </div>
              <div>
                <span>{t('timeline.started')}</span>
                <strong>{dateFormatter.format(new Date(run.startedAt))}</strong>
              </div>
              <div>
                <span>{t('timeline.duration')}</span>
                <strong>
                  {duration === undefined
                    ? t('timeline.pending')
                    : t('timeline.durationSeconds', {
                        seconds: Math.max(1, Math.round(duration / 1000)),
                      })}
                </strong>
              </div>
              <div>
                <span>{t('timeline.jump')}</span>
                <strong>
                  {jump.amount} {t(`timeline.${jump.unit}`)}
                </strong>
              </div>
              <button
                type="button"
                className={styles.button}
                onClick={() =>
                  onReuse({
                    amount: jump.amount,
                    unit: jump.unit,
                    strategy: jump.strategy ?? 'fixed',
                  })
                }
              >
                <RotateCcw size={15} />
                {t('timeline.reuse')}
              </button>
              {run.errorCode ? (
                <details className={styles.historyDiagnostic}>
                  <summary>{t('timeline.diagnostic')}</summary>
                  <code>{run.errorCode}</code>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

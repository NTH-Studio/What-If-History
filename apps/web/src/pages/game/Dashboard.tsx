import { Landmark, Shield, Sparkles, Swords, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { formatCalendarDate } from '../../dateFormatting';
import styles from '../../styles/App.module.css';

export function Dashboard({
  game,
  actions,
  events,
  units,
  onClose,
}: {
  game: Awaited<ReturnType<typeof api.game>>;
  actions: Awaited<ReturnType<typeof api.actions>>;
  events: Awaited<ReturnType<typeof api.events>>;
  units: Awaited<ReturnType<typeof api.units>>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
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
      <header className={`${styles.workspaceHeader} ${styles.surfaceHeader}`}>
        <div>
          <p className={styles.eyebrow}>
            SITREP · {formatCalendarDate(game.currentDate, i18n.language, 'medium')}
          </p>
          <h1>{t('game.strategicOverview')}</h1>
        </div>
        <div className={styles.surfaceHeaderActions}>
          <span className={styles.turnBadge}>{t('game.turn', { turn: game.turnNumber })}</span>
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

export function Panel({
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

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FastForward, MapPin, Save, Swords, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameEvent } from '@what-if-history/contracts';
import { api } from '../../api';
import { formatCalendarDate } from '../../dateFormatting';
import styles from '../../styles/App.module.css';

export function EventTheater({
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
  const { t, i18n } = useTranslation();
  const formattedDate = formatCalendarDate(event.gameDate, i18n.language, 'long');
  const queryClient = useQueryClient();
  const [animationsSkipped, setAnimationsSkipped] = useState(false);
  const saveMutation = useMutation({
    mutationFn: () =>
      api.createSnapshot(
        gameId,
        t('eventTheater.snapshotLabel', { date: formattedDate, position: index + 1 }),
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
      data-testid="event-theater"
      aria-labelledby="event-theater-title"
      aria-live="polite"
    >
      <header className={styles.eventTheaterHeader}>
        <div>
          <span>{t('eventTheater.progress', { current: index + 1, total })}</span>
          <time dateTime={event.gameDate}>{formattedDate}</time>
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

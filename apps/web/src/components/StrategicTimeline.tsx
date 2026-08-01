import {
  Biohazard,
  ChevronLeft,
  ChevronRight,
  FastForward,
  MapPin,
  Pause,
  Play,
  Radio,
  SkipForward,
  Swords,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CinematicCue, StrategicState, TimelineEntry } from '@what-if-history/contracts';
import styles from '../styles/App.module.css';

const iconForKind = (kind: TimelineEntry['kind']) => {
  if (kind === 'battle' || kind === 'interception') return Swords;
  if (kind === 'impact') return Biohazard;
  if (kind.startsWith('movement') || kind === 'arrival') return FastForward;
  return Radio;
};

export function StrategicTimelineTheater({
  entry,
  index,
  total,
  onPrevious,
  onNext,
  onClose,
}: {
  entry: TimelineEntry;
  index: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [animationsSkipped, setAnimationsSkipped] = useState(false);
  const Icon = iconForKind(entry.kind);
  const consequences = Object.entries(entry.consequences);

  useEffect(() => {
    const root = globalThis.document.documentElement;
    root.dataset.timelinePaused = paused ? 'true' : 'false';
    root.dataset.reduceMapMotion = animationsSkipped ? 'true' : 'false';
    root.style.setProperty('--strategic-animation-speed', `${1 / Number(speed)}s`);
    return () => {
      delete root.dataset.timelinePaused;
      delete root.dataset.reduceMapMotion;
      root.style.removeProperty('--strategic-animation-speed');
    };
  }, [animationsSkipped, paused, speed]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && index > 0) onPrevious();
      if (event.key === 'ArrowRight' || event.key === ' ') onNext();
      if (event.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', handleKey);
    return () => globalThis.removeEventListener('keydown', handleKey);
  }, [index, onClose, onNext, onPrevious]);

  return (
    <section className={styles.strategicTimelineTheater} aria-live="polite">
      <header>
        <span>{t('strategic.timeline.progress', { current: index + 1, total })}</span>
        <span>{entry.gameDate}</span>
        <button type="button" aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className={styles.strategicTimelineHero} data-kind={entry.cue.kind}>
        <span className={styles.strategicTimelineIcon}>
          <Icon size={28} aria-hidden="true" />
        </span>
        <div>
          <p>{t(`strategic.timeline.kinds.${entry.kind}`)}</p>
          <h2>{entry.title}</h2>
        </div>
      </div>
      <p>{entry.description}</p>
      {consequences.length ? (
        <dl className={styles.strategicConsequences}>
          {consequences.map(([key, value]) => (
            <div key={key}>
              <dt>
                {t(`strategic.timeline.consequences.${key}`, {
                  defaultValue: key.replaceAll('_', ' '),
                })}
              </dt>
              <dd>
                {typeof value === 'boolean' ? (value ? t('common.yes') : t('common.no')) : value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className={styles.strategicPlaybackTools}>
        <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
          {paused ? t('strategic.timeline.resume') : t('strategic.timeline.pause')}
        </button>
        <label>
          <span>{t('strategic.timeline.speed')}</span>
          <select value={speed} onChange={(event) => setSpeed(event.target.value)}>
            <option value="0.5">{'\u00d7'}0,5</option>
            <option value="1">{'\u00d7'}1</option>
            <option value="2">{'\u00d7'}2</option>
          </select>
        </label>
        <button
          type="button"
          aria-pressed={animationsSkipped}
          onClick={() => setAnimationsSkipped((value) => !value)}
        >
          <SkipForward size={16} />
          {t('strategic.timeline.skip')}
        </button>
      </div>
      <footer>
        <button type="button" disabled={index === 0} onClick={onPrevious}>
          <ChevronLeft size={17} />
          {t('eventTheater.previous')}
        </button>
        <div aria-hidden="true">
          {Array.from({ length: total }, (_, dotIndex) => (
            <span key={dotIndex} data-active={dotIndex === index} />
          ))}
        </div>
        <button type="button" onClick={onNext}>
          {index === total - 1 ? t('eventTheater.finish') : t('eventTheater.next')}
          <ChevronRight size={17} />
        </button>
      </footer>
    </section>
  );
}

function strategicMood(state?: StrategicState): 'peace' | 'tension' | 'war' | 'crisis' | 'nuclear' {
  if (state?.impactZones.some((zone) => zone.active && zone.kind === 'nuclear_strike'))
    return 'nuclear';
  if (state?.wars.some((war) => war.status === 'active')) return 'war';
  if (state?.impactZones.some((zone) => zone.active && zone.intensity >= 70)) return 'crisis';
  if (state?.orders.some((order) => order.status === 'queued' || order.status === 'moving'))
    return 'tension';
  return 'peace';
}

export function StrategicAudioControl({
  state,
  activeCue,
}: {
  state?: StrategicState;
  activeCue?: CinematicCue;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(
    () => localStorage.getItem('strategic-audio-muted') === 'true',
  );
  const [open, setOpen] = useState(false);
  const [musicVolume, setMusicVolume] = useState(() =>
    Number(localStorage.getItem('strategic-music-volume') ?? 0.16),
  );
  const [effectsVolume, setEffectsVolume] = useState(() =>
    Number(localStorage.getItem('strategic-effects-volume') ?? 0.28),
  );
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const oscillatorsRef = useRef<OscillatorNode[]>([]);
  const mood = strategicMood(state);

  const stopAudio = () => {
    for (const oscillator of oscillatorsRef.current) oscillator.stop();
    oscillatorsRef.current = [];
    void contextRef.current?.close();
    contextRef.current = null;
    gainRef.current = null;
  };

  const startAudio = () => {
    if (contextRef.current) return;
    const AudioContextClass = globalThis.AudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.value = muted ? 0 : musicVolume;
    gain.connect(context.destination);
    const frequencies =
      mood === 'peace' ? [65.41, 98] : mood === 'nuclear' ? [41.2, 43.65] : [55, 82.41];
    oscillatorsRef.current = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = index ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      const layerGain = context.createGain();
      layerGain.gain.value = index ? 0.22 : 0.34;
      oscillator.connect(layerGain).connect(gain);
      oscillator.start();
      return oscillator;
    });
    contextRef.current = context;
    gainRef.current = gain;
    setEnabled(true);
  };

  useEffect(() => {
    localStorage.setItem('strategic-audio-muted', String(muted));
    localStorage.setItem('strategic-music-volume', String(musicVolume));
    localStorage.setItem('strategic-effects-volume', String(effectsVolume));
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : musicVolume;
  }, [effectsVolume, musicVolume, muted]);

  useEffect(() => {
    const context = contextRef.current;
    if (!enabled || muted || !activeCue?.audioCue || !context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = activeCue.kind === 'explosion' ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(
      activeCue.kind === 'explosion' ? 72 : 220,
      context.currentTime,
    );
    oscillator.frequency.exponentialRampToValueAtTime(44, context.currentTime + 0.6);
    gain.gain.setValueAtTime(Math.max(0.001, effectsVolume), context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.65);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
  }, [activeCue, effectsVolume, enabled, muted]);

  useEffect(() => () => stopAudio(), []);

  return (
    <div className={styles.strategicAudioControl} data-open={open}>
      <button
        type="button"
        aria-label={t('strategic.audio.title')}
        aria-expanded={open}
        onClick={() => {
          if (!enabled) startAudio();
          setOpen((value) => !value);
        }}
      >
        {enabled && !muted ? <Volume2 size={17} /> : <VolumeX size={17} />}
        <span>{t(`strategic.audio.moods.${mood}`)}</span>
      </button>
      {open ? (
        <section aria-label={t('strategic.audio.title')}>
          <header>
            <strong>{t('strategic.audio.title')}</strong>
            <button type="button" aria-label={t('common.close')} onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </header>
          <button type="button" onClick={() => setMuted((value) => !value)}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {muted ? t('strategic.audio.unmute') : t('strategic.audio.mute')}
          </button>
          <label>
            <span>{t('strategic.audio.music')}</span>
            <input
              type="range"
              min="0"
              max="0.4"
              step="0.02"
              value={musicVolume}
              onChange={(event) => setMusicVolume(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{t('strategic.audio.effects')}</span>
            <input
              type="range"
              min="0"
              max="0.6"
              step="0.02"
              value={effectsVolume}
              onChange={(event) => setEffectsVolume(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              stopAudio();
              setEnabled(false);
            }}
          >
            {t('strategic.audio.disable')}
          </button>
          <small>{t('strategic.audio.credits')}</small>
        </section>
      ) : null}
    </div>
  );
}

export function TimelineReplayButton({
  entry,
  onReplay,
}: {
  entry: TimelineEntry;
  onReplay: () => void;
}) {
  const { t } = useTranslation();
  const replayLabel = t('strategic.timeline.replay');
  return (
    <button
      type="button"
      className={`${styles.primaryButton} ${styles.timelineReplayButton}`}
      title={`${replayLabel} — ${entry.title}`}
      aria-label={`${replayLabel} — ${entry.title}`}
      data-testid="timeline-replay-button"
      onClick={onReplay}
    >
      <MapPin size={15} aria-hidden="true" />
      <span>{t('strategic.timeline.replayShort')}</span>
    </button>
  );
}

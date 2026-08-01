import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import type { ScenarioMode } from '@what-if-history/contracts';
import { api, ApiError } from '../../api';
import { Modal } from '../../components/Dialogs';
import styles from '../../styles/App.module.css';

export function NewGameDialog({
  open,
  onOpenChange,
  nations,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nations: Awaited<ReturnType<typeof api.nations>>;
  onError: (message?: string) => void;
}) {
  const { t } = useTranslation();
  const history = useHistory();
  const queryClient = useQueryClient();
  const [nationCode, setNationCode] = useState('');
  const [nationQuery, setNationQuery] = useState('');
  const [nationListOpen, setNationListOpen] = useState(false);
  const [activeNationIndex, setActiveNationIndex] = useState(0);
  const nationOptionsRef = useRef<HTMLUListElement>(null);
  const [startDate, setStartDate] = useState('1936-01-01');
  const [difficulty, setDifficulty] = useState<
    'very_easy' | 'easy' | 'normal' | 'hard' | 'impossible'
  >('normal');
  const [name, setName] = useState('');
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>('historical');
  const [scenarioPremise, setScenarioPremise] = useState('');
  const historicalWorld = useQuery({
    queryKey: ['historical-world-preview', startDate],
    queryFn: () => api.historicalWorld(startDate),
    enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(startDate),
    retry: false,
  });
  const historicalWorldErrorCode =
    historicalWorld.error instanceof ApiError ? historicalWorld.error.problem.code : undefined;
  const datedNations = historicalWorld.data?.nations ?? nations;
  const mutation = useMutation({
    mutationFn: api.createGame,
    onSuccess: async (game) => {
      await queryClient.invalidateQueries({ queryKey: ['games'] });
      onOpenChange(false);
      history.push(`/game/${game.id}/dashboard`);
    },
    onError: (caught) => {
      onError(caught instanceof ApiError ? caught.problem.detail : t('common.error'));
    },
  });
  const normalizeSearch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase()
      .trim();
  const selectedNation = datedNations.find((nation) => nation.code === nationCode);
  const selectedHistoricalNation = historicalWorld.data?.nations.find(
    (nation) => nation.code === nationCode,
  );
  const selectedNationLabel = selectedNation
    ? `${selectedNation.name} · ${selectedNation.code}`
    : undefined;
  const normalizedNationQuery =
    selectedNationLabel === nationQuery ? '' : normalizeSearch(nationQuery);
  const nationMatchScore = (nation: (typeof datedNations)[number]) => {
    const normalizedCode = normalizeSearch(nation.code);
    const normalizedName = normalizeSearch(nation.name);
    const words = normalizedName.split(/\s+/);
    if (normalizedCode === normalizedNationQuery) return 0;
    if (normalizedCode.startsWith(normalizedNationQuery)) return 1;
    if (normalizedName.startsWith(normalizedNationQuery)) return 2;
    if (words.some((word) => word.startsWith(normalizedNationQuery))) return 3;
    return 4;
  };
  const filteredNations = normalizedNationQuery
    ? datedNations
        .filter((nation) =>
          normalizeSearch(`${nation.name} ${nation.code}`).includes(normalizedNationQuery),
        )
        .sort(
          (left, right) =>
            nationMatchScore(left) - nationMatchScore(right) || left.name.localeCompare(right.name),
        )
    : datedNations;
  const activeNationCode = filteredNations[activeNationIndex]?.code;
  const selectNation = (nation: (typeof datedNations)[number]) => {
    setNationCode(nation.code);
    setNationQuery(`${nation.name} · ${nation.code}`);
    setNationListOpen(false);
  };
  useEffect(() => {
    if (!nationListOpen || !activeNationCode) return;
    nationOptionsRef.current
      ?.querySelector<HTMLElement>(`#nation-option-${activeNationCode}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeNationCode, nationListOpen]);
  useEffect(() => {
    if (
      !historicalWorld.isSuccess ||
      !nationCode ||
      historicalWorld.data.nations.some((nation) => nation.code === nationCode)
    ) {
      return;
    }
    setNationCode('');
    setNationQuery('');
    setNationListOpen(false);
  }, [historicalWorld.data, historicalWorld.isSuccess, nationCode]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('newGame.title')}
      description={t('newGame.description')}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({
            nationCode,
            startDate,
            difficulty,
            ...(name.trim() ? { name: name.trim() } : {}),
            scenario:
              scenarioMode === 'custom'
                ? { mode: 'custom', premise: scenarioPremise.trim() }
                : { mode: 'historical' },
          });
        }}
      >
        <div className={styles.nationField}>
          <label htmlFor="nation-search">
            <span>{t('newGame.nation')}</span>
          </label>
          <div
            className={styles.nationCombobox}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setNationListOpen(false);
              }
            }}
          >
            <Search size={17} aria-hidden="true" />
            <input
              id="nation-search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={nationListOpen}
              aria-controls="nation-options"
              aria-activedescendant={
                nationListOpen && filteredNations[activeNationIndex]
                  ? `nation-option-${filteredNations[activeNationIndex].code}`
                  : undefined
              }
              autoComplete="off"
              placeholder={t('newGame.search')}
              value={nationQuery}
              onFocus={() => {
                setActiveNationIndex(
                  Math.max(
                    0,
                    filteredNations.findIndex((nation) => nation.code === nationCode),
                  ),
                );
                setNationListOpen(true);
              }}
              onChange={(event) => {
                setNationQuery(event.target.value);
                setNationCode('');
                setActiveNationIndex(0);
                setNationListOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setNationListOpen(true);
                  setActiveNationIndex((index) =>
                    Math.max(0, Math.min(index + 1, filteredNations.length - 1)),
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveNationIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === 'Enter' && nationListOpen) {
                  const exactCodeMatch = filteredNations.find(
                    (nation) => normalizeSearch(nation.code) === normalizedNationQuery,
                  );
                  const nation = exactCodeMatch ?? filteredNations[activeNationIndex];
                  if (nation) {
                    event.preventDefault();
                    selectNation(nation);
                  }
                } else if (event.key === 'Escape') {
                  setNationListOpen(false);
                }
              }}
            />
            {selectedNation ? (
              <Check className={styles.nationSelectedIcon} size={17} aria-hidden="true" />
            ) : (
              <ChevronDown className={styles.nationChevron} size={17} aria-hidden="true" />
            )}
            {nationListOpen ? (
              <ul
                ref={nationOptionsRef}
                id="nation-options"
                className={styles.nationOptions}
                role="listbox"
              >
                {filteredNations.length > 0 ? (
                  filteredNations.map((nation, index) => (
                    <li
                      id={`nation-option-${nation.code}`}
                      key={nation.code}
                      role="option"
                      aria-selected={nation.code === nationCode}
                      data-active={index === activeNationIndex}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActiveNationIndex(index)}
                      onClick={() => selectNation(nation)}
                    >
                      <span>{nation.name}</span>
                      <strong>{nation.code}</strong>
                    </li>
                  ))
                ) : (
                  <li
                    className={styles.nationNoResults}
                    role="option"
                    aria-disabled="true"
                    aria-selected="false"
                  >
                    {t('newGame.noNationResults')}
                  </li>
                )}
              </ul>
            ) : null}
          </div>
        </div>
        <div className={styles.formRow}>
          <label>
            <span>{t('newGame.date')}</span>
            <input
              type="date"
              min={historicalWorld.data?.coverageStart ?? '1870-01-01'}
              max={historicalWorld.data?.coverageEnd ?? '2026-07-31'}
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
            />
          </label>
          <label>
            <span>
              {t('newGame.name')} · {t('newGame.optional')}
            </span>
            <input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t('campaignSettings.difficulty')}</span>
            <select
              value={difficulty}
              onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
            >
              {(['very_easy', 'easy', 'normal', 'hard', 'impossible'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`difficulty.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section className={styles.historicalPreview} aria-live="polite">
          {historicalWorld.isPending ? (
            <p>{t('newGame.loadingHistoricalWorld')}</p>
          ) : historicalWorld.isError ? (
            <p data-tone="error">
              {t(
                historicalWorldErrorCode === 'HISTORICAL_DATE_OUT_OF_RANGE'
                  ? 'newGame.historicalWorldUnavailable'
                  : 'newGame.historicalWorldLoadError',
              )}
            </p>
          ) : selectedHistoricalNation ? (
            <>
              <div className={styles.historicalPreviewHeader}>
                <span className={styles.roleIcon} aria-hidden="true">
                  &#9813;
                </span>
                <div>
                  <strong>{selectedHistoricalNation.name}</strong>
                  <small>
                    {t(`countries.governments.${selectedHistoricalNation.governmentType}`)} ·{' '}
                    {t('newGame.capital')}:{' '}
                    {selectedHistoricalNation.capital ?? t('common.unknown')}
                  </small>
                </div>
              </div>
              <dl>
                {selectedHistoricalNation.officeHolders.map((holder) => (
                  <div key={holder.id}>
                    <dt>
                      <span className={styles.roleIcon} aria-hidden="true">
                        {holder.role === 'head_of_state' ? '\u2655' : '\u265f'}
                      </span>
                      {holder.title}
                    </dt>
                    <dd>{holder.name}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.historicalPrecisionNotice}>
                {t('newGame.strategicBordersNotice')}
              </p>
            </>
          ) : (
            <p>{t('newGame.selectNationForPreview')}</p>
          )}
        </section>
        <fieldset className={styles.scenarioFieldset}>
          <legend>{t('newGame.scenario')}</legend>
          <div className={styles.scenarioChoices}>
            {(['historical', 'custom'] as const).map((mode) => (
              <label key={mode} data-selected={scenarioMode === mode}>
                <input
                  type="radio"
                  name="scenarioMode"
                  value={mode}
                  checked={scenarioMode === mode}
                  onChange={() => setScenarioMode(mode)}
                />
                <span>
                  <strong>{t(`newGame.${mode}`)}</strong>
                  <small>{t(`newGame.${mode}Description`)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {scenarioMode === 'custom' ? (
          <label>
            <span>{t('newGame.premise')}</span>
            <textarea
              value={scenarioPremise}
              onChange={(event) => setScenarioPremise(event.target.value)}
              placeholder={t('newGame.premisePlaceholder')}
              maxLength={4_000}
              rows={5}
              required
              aria-describedby="scenario-guidance scenario-count"
            />
            <small id="scenario-guidance">{t('newGame.premiseGuidance')}</small>
            <small id="scenario-count" className={styles.characterCount}>
              {scenarioPremise.length.toLocaleString()} / 4 000
            </small>
          </label>
        ) : null}
        <footer className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className={styles.primaryButton}
            disabled={
              mutation.isPending ||
              historicalWorld.isPending ||
              historicalWorld.isError ||
              !nationCode ||
              (scenarioMode === 'custom' && !scenarioPremise.trim())
            }
          >
            {mutation.isPending ? t('common.loading') : t('newGame.create')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

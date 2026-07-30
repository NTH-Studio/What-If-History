import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CountryIndicators, CountryProfile, CountrySummary } from '@what-if-history/contracts';
import { ArrowLeftRight, Landmark, MessageSquare, Scale, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import styles from '../styles/App.module.css';

type SortKey = 'name' | 'population' | 'gdp' | 'happiness';
type CountryView = 'overview' | 'indicators' | 'laws' | 'activity' | 'compare';

export function CountriesPanel({
  gameId,
  playerNationCode,
  selectedCode,
  onSelect,
  onStartDiplomacy,
}: {
  gameId: string;
  playerNationCode: string;
  selectedCode: string | undefined;
  onSelect: (code: string) => void;
  onStartDiplomacy: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const countries = useQuery({
    queryKey: ['countries', gameId],
    queryFn: () => api.countries(gameId),
  });
  const [search, setSearch] = useState('');
  const [ideology, setIdeology] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('name');
  const activeCode = selectedCode ?? countries.data?.[0]?.code;
  const profile = useQuery({
    queryKey: ['country', gameId, activeCode],
    queryFn: () => api.country(gameId, activeCode!),
    enabled: Boolean(activeCode),
  });
  const [comparisonCode, setComparisonCode] = useState('');
  const comparison = useQuery({
    queryKey: ['country', gameId, comparisonCode],
    queryFn: () => api.country(gameId, comparisonCode),
    enabled: Boolean(comparisonCode),
  });
  const diplomacy = useMutation({
    mutationFn: (nationCode: string) => api.createChat(gameId, nationCode),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chats', gameId] });
      onStartDiplomacy();
    },
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return [...(countries.data ?? [])]
      .filter(
        (country) =>
          (!needle ||
            [country.name, country.code, country.capital, country.leaderName].some((value) =>
              value?.toLocaleLowerCase().includes(needle),
            )) &&
          (ideology === 'all' || country.ideology === ideology) &&
          (status === 'all' ||
            (status === 'major' && country.isMajorPower) ||
            (status === 'war' && country.indicators.atWar)),
      )
      .sort((left, right) => {
        if (sort === 'name') return left.name.localeCompare(right.name);
        return right.indicators[sort] - left.indicators[sort];
      });
  }, [countries.data, ideology, search, sort, status]);

  if (countries.isLoading) return <p>{t('common.loading')}</p>;
  if (countries.isError) return <p role="alert">{t('countries.loadError')}</p>;

  return (
    <div className={styles.countriesPage}>
      <header className={styles.workspaceHeader}>
        <div>
          <p className={styles.eyebrow}>{t('countries.eyebrow')}</p>
          <h1>{t('countries.title')}</h1>
          <p className={styles.muted}>{t('countries.description')}</p>
        </div>
        <span className={styles.turnBadge}>
          {t('countries.count', { count: countries.data?.length })}
        </span>
      </header>

      <div className={styles.countryFilters}>
        <label className={styles.searchField}>
          <Search size={17} />
          <span className={styles.srOnly}>{t('countries.search')}</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('countries.search')}
          />
        </label>
        <label>
          <span>{t('countries.ideology')}</span>
          <select value={ideology} onChange={(event) => setIdeology(event.target.value)}>
            <option value="all">{t('countries.allIdeologies')}</option>
            <option value="democratic">{t('countries.ideologies.democratic')}</option>
            <option value="authoritarian">{t('countries.ideologies.authoritarian')}</option>
            <option value="fascism">{t('countries.ideologies.fascism')}</option>
            <option value="communist">{t('countries.ideologies.communist')}</option>
          </select>
        </label>
        <label>
          <span>{t('countries.status')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">{t('countries.allCountries')}</option>
            <option value="major">{t('countries.majorPowers')}</option>
            <option value="war">{t('countries.atWar')}</option>
          </select>
        </label>
        <label>
          <span>{t('countries.sort')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="name">{t('countries.sortName')}</option>
            <option value="population">{t('countries.population')}</option>
            <option value="gdp">{t('countries.gdp')}</option>
            <option value="happiness">{t('countries.happiness')}</option>
          </select>
        </label>
      </div>

      <div className={styles.countryBrowser}>
        <aside className={styles.countryList} aria-label={t('countries.list')}>
          {filtered.map((country) => (
            <button
              key={country.code}
              className={country.code === activeCode ? styles.countryListActive : undefined}
              onClick={() => onSelect(country.code)}
              aria-current={country.code === activeCode ? 'page' : undefined}
              ref={(element) => {
                if (element && country.code === activeCode) {
                  element.scrollIntoView({ block: 'nearest' });
                }
              }}
            >
              <span className={styles.countrySwatch} style={{ background: country.color }} />
              <span>
                <strong>{country.name}</strong>
                <small>
                  {country.code} · {formatCompact(country.indicators.population)}
                </small>
              </span>
              <b>{Math.round(country.indicators.happiness)}</b>
            </button>
          ))}
          {!filtered.length ? <p className={styles.muted}>{t('countries.noResults')}</p> : null}
        </aside>

        <section className={styles.countryDetail} aria-live="polite">
          {profile.isLoading ? <p>{t('common.loading')}</p> : null}
          {profile.isError ? <p role="alert">{t('countries.loadError')}</p> : null}
          {profile.data ? (
            <CountryProfileView
              profile={profile.data}
              countries={countries.data ?? []}
              comparisonCode={comparisonCode}
              onComparisonChange={setComparisonCode}
              comparison={comparison.data}
              canStartDiplomacy={profile.data.code !== playerNationCode}
              onStartDiplomacy={() => diplomacy.mutate(profile.data!.code)}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CountryProfileView({
  profile,
  countries,
  comparisonCode,
  onComparisonChange,
  comparison,
  canStartDiplomacy,
  onStartDiplomacy,
}: {
  profile: CountryProfile;
  countries: CountrySummary[];
  comparisonCode: string;
  onComparisonChange: (code: string) => void;
  comparison: CountryProfile | undefined;
  canStartDiplomacy: boolean;
  onStartDiplomacy: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const metrics = indicatorRows(profile.indicators, t, number, integer);
  const [view, setView] = useState<CountryView>('overview');
  const views: CountryView[] = ['overview', 'indicators', 'laws', 'activity', 'compare'];

  return (
    <>
      <header className={styles.countryHero} style={{ borderColor: profile.color }}>
        <div>
          <p className={styles.eyebrow}>
            {profile.code} · {t(`countries.ideologies.${profile.ideology}`)}
          </p>
          <h2>{profile.name}</h2>
          <p>
            {profile.capital ?? t('countries.unknown')} ·{' '}
            {profile.leaderName ?? t('countries.unknown')}
            {profile.leaderTitle ? `, ${profile.leaderTitle}` : ''}
          </p>
        </div>
        <div className={styles.countryBadges}>
          {canStartDiplomacy ? (
            <button className={styles.button} onClick={onStartDiplomacy}>
              <MessageSquare size={15} />
              {t('countries.openDiplomacy')}
            </button>
          ) : null}
          {profile.isMajorPower ? <span>{t('countries.majorPower')}</span> : null}
          {profile.indicators.atWar ? (
            <span className={styles.dangerBadge}>{t('countries.atWar')}</span>
          ) : null}
        </div>
      </header>

      <nav className={styles.countryTabs} aria-label={t('countries.sections')}>
        {views.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {t(`countries.views.${item}`)}
          </button>
        ))}
      </nav>

      {view === 'overview' ? (
        <div className={styles.countryView}>
          <p className={styles.dataNotice}>
            {t('countries.estimateNotice', { date: profile.baselineDate })}
          </p>
          <section className={styles.countrySection}>
            <h3>
              <Landmark size={18} /> {t('countries.government')}
            </h3>
            <dl className={styles.detailList}>
              <div>
                <dt>{t('countries.governmentType')}</dt>
                <dd>{t(`countries.governments.${profile.governmentType}`)}</dd>
              </div>
              <div>
                <dt>{t('countries.politicalPower')}</dt>
                <dd>{integer.format(profile.indicators.politicalPower)}</dd>
              </div>
              <div>
                <dt>{t('countries.militaryStrength')}</dt>
                <dd>{integer.format(profile.militaryStrength)} / 100</dd>
              </div>
              <div>
                <dt>{t('countries.units')}</dt>
                <dd>{integer.format(profile.unitCount)}</dd>
              </div>
            </dl>
          </section>
          <section className={styles.countrySection}>
            <h3>{t('countries.keyIndicators')}</h3>
            <div className={styles.countryMetricGrid}>
              {metrics.slice(0, 4).map(([label, value]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {view === 'indicators' ? (
        <section className={`${styles.countrySection} ${styles.countryView}`}>
          <h3>{t('countries.indicators')}</h3>
          <div className={styles.countryMetricGrid}>
            {metrics.map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'laws' ? (
        <section className={`${styles.countrySection} ${styles.countryView}`}>
          <h3>
            <Scale size={18} /> {t('countries.laws')}
          </h3>
          <div className={styles.countryLawList}>
            {profile.laws.map((law) => (
              <article key={law.id}>
                <header>
                  <strong>{law.title}</strong>
                  <span>{t(`countries.lawCategories.${law.category}`)}</span>
                </header>
                <p>{law.summary}</p>
                <small>
                  {t(`countries.lawSources.${law.source}`)} · {law.enactedDate}
                  {law.status === 'repealed' ? ` · ${t('countries.repealed')}` : ''}
                </small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'activity' ? (
        <div className={styles.countryView}>
          <section className={styles.countrySection}>
            <h3>{t('countries.occupiedRegions')}</h3>
            <p>
              {profile.occupiedRegions.length
                ? profile.occupiedRegions.join(', ')
                : t('countries.none')}
            </p>
          </section>
          <section className={styles.countrySection}>
            <h3>{t('countries.recentEvents')}</h3>
            {profile.recentEvents.length ? (
              <div className={styles.countryLawList}>
                {profile.recentEvents.map((event) => (
                  <article key={event.id}>
                    <header>
                      <strong>{event.title}</strong>
                      <span>{event.gameDate}</span>
                    </header>
                    <p>{event.description}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.muted}>{t('countries.noEvents')}</p>
            )}
          </section>
        </div>
      ) : null}

      {view === 'compare' ? (
        <section className={`${styles.countrySection} ${styles.countryView}`}>
          <h3>
            <ArrowLeftRight size={18} /> {t('countries.compare')}
          </h3>
          <label className={styles.compareSelect}>
            <span>{t('countries.compareWith')}</span>
            <select
              value={comparisonCode}
              onChange={(event) => onComparisonChange(event.target.value)}
            >
              <option value="">{t('countries.chooseCountry')}</option>
              {countries
                .filter((country) => country.code !== profile.code)
                .map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
            </select>
          </label>
          {comparison ? (
            <div
              className={styles.comparisonTable}
              role="table"
              aria-label={t('countries.compare')}
            >
              <div role="row">
                <strong role="columnheader">{t('countries.indicator')}</strong>
                <strong role="columnheader">{profile.name}</strong>
                <strong role="columnheader">{comparison.name}</strong>
              </div>
              {metrics.map(([label, value], index) => {
                const compared = indicatorRows(comparison.indicators, t, number, integer)[index]!;
                return (
                  <div role="row" key={label}>
                    <span role="rowheader">{label}</span>
                    <span role="cell" data-country={profile.name}>
                      {value}
                    </span>
                    <span role="cell" data-country={comparison.name}>
                      {compared[1]}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function indicatorRows(
  indicators: CountryIndicators,
  t: (key: string) => string,
  number: Intl.NumberFormat,
  integer: Intl.NumberFormat,
): Array<[string, string]> {
  return [
    [t('countries.population'), integer.format(indicators.population)],
    [t('countries.gdp'), `${number.format(indicators.gdp)} M$`],
    [t('countries.gdpPerCapita'), `${integer.format(indicators.gdpPerCapita)} $`],
    [t('countries.happiness'), `${number.format(indicators.happiness)} / 100`],
    [t('game.stability'), `${number.format(indicators.stability)}%`],
    [t('countries.literacy'), `${number.format(indicators.literacy)}%`],
    [t('countries.unemployment'), `${number.format(indicators.unemployment)}%`],
    [t('countries.inflation'), `${number.format(indicators.inflation)}%`],
    [t('countries.industry'), `${number.format(indicators.industrialCapacity)} / 100`],
    [t('countries.health'), `${number.format(indicators.health)} / 100`],
    [t('countries.foodSecurity'), `${number.format(indicators.foodSecurity)} / 100`],
    [t('game.warSupport'), `${number.format(indicators.warSupport)}%`],
    [t('game.manpower'), integer.format(indicators.manpower)],
    [t('game.treasury'), integer.format(indicators.treasury)],
  ];
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

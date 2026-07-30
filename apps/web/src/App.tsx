import { QueryErrorResetBoundary, useQueryClient } from '@tanstack/react-query';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Redirect, Route, Switch } from 'react-router-dom';
import { Modal } from './components/Dialogs';
import { HomePage } from './pages/HomePage';
import { LlmActivityProvider } from './components/LlmActivity';
import { useDisplay, type DesktopLayout, type MobileNavigation } from './display';
import { useTheme } from './theme';
import styles from './styles/App.module.css';

const GamePage = lazy(() =>
  import('./pages/GamePage').then((module) => ({ default: module.GamePage })),
);
const PresetStudioPage = lazy(() =>
  import('./pages/PresetStudioPage').then((module) => ({ default: module.PresetStudioPage })),
);

class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed', error, info);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Preferences() {
  const { i18n, t } = useTranslation();
  const queryClient = useQueryClient();
  const { preference, setPreference } = useTheme();
  const { desktopLayout, setDesktopLayout, mobileNavigation, setMobileNavigation } = useDisplay();
  const [open, setOpen] = useState(false);
  const themes = ['system', 'light', 'dark'] as const;
  const desktopLayouts: DesktopLayout[] = ['atlas', 'spread', 'dossier'];
  const mobileNavigations: MobileNavigation[] = ['bottom', 'drawer', 'tabs'];

  return (
    <>
      <button
        className={styles.iconButton}
        aria-label={t('appearance.open')}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={18} />
        <span>{i18n.language.toUpperCase()}</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('appearance.title')}
        description={t('appearance.description')}
      >
        <div className={styles.appearanceSections}>
          <section>
            <h3>{t('common.language')}</h3>
            <div className={styles.preferenceGrid}>
              {(['fr', 'en'] as const).map((language) => {
                const selected = i18n.language.startsWith(language);
                return (
                  <button
                    key={language}
                    type="button"
                    className={selected ? styles.preferenceCardActive : styles.preferenceCard}
                    aria-pressed={selected}
                    onClick={async () => {
                      await i18n.changeLanguage(language);
                      await queryClient.invalidateQueries();
                    }}
                  >
                    <span>{t(`appearance.language.${language}`)}</span>
                    {selected ? <Check size={17} /> : null}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h3>{t('common.theme')}</h3>
            <div className={styles.preferenceGrid}>
              {themes.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={
                    preference === theme ? styles.preferenceCardActive : styles.preferenceCard
                  }
                  aria-pressed={preference === theme}
                  onClick={() => setPreference(theme)}
                >
                  <span>{t(`common.${theme}`)}</span>
                  {preference === theme ? <Check size={17} /> : null}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{t('appearance.desktop.title')}</h3>
            <p>{t('appearance.desktop.description')}</p>
            <div className={styles.preferenceGrid}>
              {desktopLayouts.map((layout) => (
                <button
                  key={layout}
                  type="button"
                  className={
                    desktopLayout === layout ? styles.preferenceCardActive : styles.preferenceCard
                  }
                  aria-pressed={desktopLayout === layout}
                  onClick={() => setDesktopLayout(layout)}
                >
                  <span>{t(`appearance.desktop.${layout}`)}</span>
                  {desktopLayout === layout ? <Check size={17} /> : null}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3>{t('appearance.mobile.title')}</h3>
            <p>{t('appearance.mobile.description')}</p>
            <div className={styles.preferenceGrid}>
              {mobileNavigations.map((navigation) => (
                <button
                  key={navigation}
                  type="button"
                  className={
                    mobileNavigation === navigation
                      ? styles.preferenceCardActive
                      : styles.preferenceCard
                  }
                  aria-pressed={mobileNavigation === navigation}
                  onClick={() => setMobileNavigation(navigation)}
                >
                  <span>{t(`appearance.mobile.${navigation}`)}</span>
                  {mobileNavigation === navigation ? <Check size={17} /> : null}
                </button>
              ))}
            </div>
          </section>
        </div>
      </Modal>
    </>
  );
}

export function App() {
  const { t } = useTranslation();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={
            <main className={styles.fatalError}>
              <h1>{t('common.error')}</h1>
              <button className={styles.button} onClick={reset}>
                {t('common.back')}
              </button>
            </main>
          }
        >
          <LlmActivityProvider>
            <Suspense
              fallback={
                <main className={styles.fatalError} aria-live="polite">
                  <p>{t('common.loading')}</p>
                </main>
              }
            >
              <Switch>
                <Route exact path="/" component={HomePage} />
                <Route path="/presets/:presetId" component={PresetStudioPage} />
                <Route path="/game/:gameId/:section?/:countryCode?" component={GamePage} />
                <Redirect to="/" />
              </Switch>
            </Suspense>
          </LlmActivityProvider>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

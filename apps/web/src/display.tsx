import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type DesktopLayout = 'atlas' | 'spread' | 'dossier';
export type MobileNavigation = 'bottom' | 'drawer' | 'tabs';

interface DisplayContextValue {
  desktopLayout: DesktopLayout;
  setDesktopLayout: (layout: DesktopLayout) => void;
  mobileNavigation: MobileNavigation;
  setMobileNavigation: (navigation: MobileNavigation) => void;
}

const desktopLayoutKey = 'what-if-history-desktop-layout';
const mobileNavigationKey = 'what-if-history-mobile-navigation';

const DisplayContext = createContext<DisplayContextValue | null>(null);

function readDesktopLayout(): DesktopLayout {
  const stored = localStorage.getItem(desktopLayoutKey);
  return stored === 'spread' || stored === 'dossier' ? stored : 'atlas';
}

function readMobileNavigation(): MobileNavigation {
  const stored = localStorage.getItem(mobileNavigationKey);
  return stored === 'drawer' || stored === 'tabs' ? stored : 'bottom';
}

export function DisplayProvider({ children }: { children: ReactNode }) {
  const [desktopLayout, setDesktopLayout] = useState<DesktopLayout>(readDesktopLayout);
  const [mobileNavigation, setMobileNavigation] = useState<MobileNavigation>(readMobileNavigation);

  useEffect(() => {
    document.documentElement.dataset.desktopLayout = desktopLayout;
    localStorage.setItem(desktopLayoutKey, desktopLayout);
  }, [desktopLayout]);

  useEffect(() => {
    document.documentElement.dataset.mobileNavigation = mobileNavigation;
    localStorage.setItem(mobileNavigationKey, mobileNavigation);
  }, [mobileNavigation]);

  const value = useMemo(
    () => ({ desktopLayout, setDesktopLayout, mobileNavigation, setMobileNavigation }),
    [desktopLayout, mobileNavigation],
  );

  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplay() {
  const context = useContext(DisplayContext);
  if (!context) throw new Error('DisplayProvider is missing.');
  return context;
}

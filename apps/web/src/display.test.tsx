// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { DisplayProvider, useDisplay } from './display';

function wrapper({ children }: { children: ReactNode }) {
  return <DisplayProvider>{children}</DisplayProvider>;
}

describe('display preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.desktopLayout;
    delete document.documentElement.dataset.mobileNavigation;
  });

  it('uses the editorial atlas defaults', () => {
    const { result } = renderHook(() => useDisplay(), { wrapper });

    expect(result.current.desktopLayout).toBe('atlas');
    expect(result.current.mobileNavigation).toBe('bottom');
    expect(document.documentElement.dataset.desktopLayout).toBe('atlas');
    expect(document.documentElement.dataset.mobileNavigation).toBe('bottom');
  });

  it('persists desktop and mobile choices independently', () => {
    const { result } = renderHook(() => useDisplay(), { wrapper });

    act(() => result.current.setDesktopLayout('dossier'));
    act(() => result.current.setMobileNavigation('tabs'));

    expect(localStorage.getItem('what-if-history-desktop-layout')).toBe('dossier');
    expect(localStorage.getItem('what-if-history-mobile-navigation')).toBe('tabs');
    expect(document.documentElement.dataset.desktopLayout).toBe('dossier');
    expect(document.documentElement.dataset.mobileNavigation).toBe('tabs');
  });
});

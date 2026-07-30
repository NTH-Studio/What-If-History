// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { LlmActivity } from '@what-if-history/contracts';
import i18n from '../i18n';
import { LlmActivityIndicator, LlmActivityProvider } from './LlmActivity';

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, EventListener>();
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(
      new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) }),
    );
  }

  close() {}
}

const runningActivity: LlmActivity = {
  id: '30000000-0000-4000-8000-000000000003',
  gameId: '40000000-0000-4000-8000-000000000004',
  gameName: 'Test campaign',
  requestId: 'request-activity',
  type: 'advisor',
  provider: 'fake',
  model: 'deterministic',
  phase: 'waiting_provider',
  status: 'running',
  startedAt: new Date().toISOString(),
  completedAt: null,
  durationMs: null,
  usage: null,
  errorCode: null,
  initiatedHere: true,
};

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <LlmActivityProvider>{children}</LlmActivityProvider>
    </QueryClientProvider>
  );
}

describe('global LLM activity UI', () => {
  beforeEach(async () => {
    sessionStorage.setItem('what-if-history-client-id', '10000000-0000-4000-8000-000000000001');
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await i18n.changeLanguage('fr');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows live phases, the accessible panel and initiator-only completion toast', async () => {
    render(
      <Wrapper>
        <LlmActivityIndicator
          game={{ id: runningActivity.gameId!, name: runningActivity.gameName! }}
        />
      </Wrapper>,
    );

    expect(await screen.findByText('IA disponible')).toBeInTheDocument();
    const stream = MockEventSource.instances[0]!;
    await act(() => stream.emit('connected', { connected: true }));
    await act(() => stream.emit('llm.activity', runningActivity));
    expect(await screen.findByText(/Conseiller · Attente du fournisseur/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' }));
    expect(await screen.findByRole('heading', { name: 'Activité IA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cette campagne' })).toBeInTheDocument();
    expect(screen.getByText('Test campaign')).toBeInTheDocument();

    await act(() =>
      stream.emit('llm.activity', {
        ...runningActivity,
        id: '50000000-0000-4000-8000-000000000005',
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        durationMs: 100,
        initiatedHere: false,
      }),
    );
    expect(screen.queryByText('Appel IA terminé')).not.toBeInTheDocument();

    await act(() =>
      stream.emit('llm.activity', {
        ...runningActivity,
        status: 'succeeded',
        phase: 'applying_result',
        completedAt: new Date().toISOString(),
        durationMs: 120,
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      }),
    );
    expect(await screen.findByText('Appel IA terminé')).toBeInTheDocument();
  });

  it('reports a disconnected activity stream without hiding the history entry point', async () => {
    render(
      <Wrapper>
        <LlmActivityIndicator />
      </Wrapper>,
    );
    await screen.findByText('IA disponible');
    const stream = MockEventSource.instances[0]!;
    act(() => stream.onerror?.(new Event('error')));
    expect(await screen.findByText('Suivi IA déconnecté')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' })).toBeEnabled();
  });
});

import type {
  Action,
  AdvisorMessage,
  Chat,
  ChatMessage,
  CreateActionInput,
  CreateGameInput,
  CountryProfile,
  CountrySummary,
  Consolidation,
  ConsolidationSettings,
  CreateMapFeatureInput,
  CreatePresetInput,
  Game,
  GameEvent,
  GameSummary,
  GameRegion,
  GameSnapshot,
  LlmSettingsInput,
  LlmSettingsPublic,
  LlmActivity,
  MapRegion,
  MapFeature,
  Nation,
  ProblemDetails,
  Preset,
  PresetDetail,
  TimeJump,
  TurnRun,
  TurnResult,
  UpdateGameConfigInput,
  UpdatePresetInput,
  Unit,
} from '@what-if-history/contracts';

const clientIdKey = 'what-if-history-client-id';

function createClientId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getClientId() {
  const existing = sessionStorage.getItem(clientIdKey);
  if (existing) return existing;
  const created = createClientId();
  sessionStorage.setItem(clientIdKey, created);
  return created;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail);
  }
}

function activeLanguage() {
  const stored = localStorage.getItem('what-if-history-language');
  return stored?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      'x-what-if-history-language': activeLanguage(),
      'x-what-if-history-client-id': getClientId(),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const problem = (await response.json()) as ProblemDetails;
    throw new ApiError(problem);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  nations: () => request<Nation[]>('/catalog/nations'),
  countries: (gameId: string) => request<CountrySummary[]>(`/games/${gameId}/countries`),
  country: (gameId: string, nationCode: string) =>
    request<CountryProfile>(`/games/${gameId}/countries/${encodeURIComponent(nationCode)}`),
  regions: () =>
    request<{ viewBox: string; width: string; height: string; regions: MapRegion[] }>(
      '/map/regions',
    ),
  cities: () =>
    request<
      Array<{
        id: string | number;
        name: string;
        nation_code: string;
        type: string;
        region_id: string;
        coords: [number, number];
      }>
    >('/map/cities'),
  games: () => request<GameSummary[]>('/games'),
  game: (id: string) => request<Game>(`/games/${id}`),
  createGame: (input: CreateGameInput) =>
    request<Game>('/games', { method: 'POST', body: JSON.stringify(input) }),
  renameGame: (id: string, name: string) =>
    request<Game>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteGame: (id: string) => request<void>(`/games/${id}`, { method: 'DELETE' }),
  updateGameConfig: (id: string, input: UpdateGameConfigInput) =>
    request<Game>(`/games/${id}/config`, { method: 'PATCH', body: JSON.stringify(input) }),
  advanceTurn: (id: string, jump: TimeJump) =>
    request<TurnResult>(`/games/${id}/turns`, {
      method: 'POST',
      body: JSON.stringify(jump),
    }),
  actions: (id: string) => request<Action[]>(`/games/${id}/actions`),
  createAction: (id: string, input: CreateActionInput) =>
    request<Action>(`/games/${id}/actions`, { method: 'POST', body: JSON.stringify(input) }),
  promulgateLaw: (id: string, actionText: string) =>
    request<Action>(`/games/${id}/actions/promulgate-law`, {
      method: 'POST',
      body: JSON.stringify({ actionText }),
    }),
  brainstorm: (id: string) =>
    request<{ suggestions: string }>(`/games/${id}/actions/brainstorm`, { method: 'POST' }),
  enhanceAction: (id: string, actionText: string) =>
    request<{ actionText: string }>(`/games/${id}/actions/enhance`, {
      method: 'POST',
      body: JSON.stringify({ actionText }),
    }),
  updateAction: (gameId: string, actionId: string, input: Partial<CreateActionInput>) =>
    request<Action>(`/games/${gameId}/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteAction: (gameId: string, actionId: string) =>
    request<void>(`/games/${gameId}/actions/${actionId}`, { method: 'DELETE' }),
  events: (id: string) => request<GameEvent[]>(`/games/${id}/events`),
  updateEvent: (gameId: string, eventId: string, input: Partial<GameEvent>) =>
    request<GameEvent>(`/games/${gameId}/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteEvent: (gameId: string, eventId: string) =>
    request<void>(`/games/${gameId}/events/${eventId}`, { method: 'DELETE' }),
  units: (id: string) => request<Unit[]>(`/games/${id}/units`),
  chats: (id: string) => request<Chat[]>(`/games/${id}/chats`),
  createChat: (id: string, targetNationCodes: string | string[]) =>
    request<Chat>(`/games/${id}/chats`, {
      method: 'POST',
      body: JSON.stringify({
        participantNationCodes: Array.isArray(targetNationCodes)
          ? targetNationCodes
          : [targetNationCodes],
      }),
    }),
  setChatSpeaker: (gameId: string, chatId: string, nationCode: string) =>
    request<Chat>(`/games/${gameId}/chats/${chatId}/speaker`, {
      method: 'PATCH',
      body: JSON.stringify({ nationCode }),
    }),
  messages: (gameId: string, chatId: string) =>
    request<ChatMessage[]>(`/games/${gameId}/chats/${chatId}/messages`),
  sendMessage: (gameId: string, chatId: string, messageText: string) =>
    request<{ playerMessage: ChatMessage; reply: ChatMessage }>(
      `/games/${gameId}/chats/${chatId}/messages`,
      { method: 'POST', body: JSON.stringify({ messageText }) },
    ),
  advisor: (id: string, question: string) =>
    request<{ response: string; messages: AdvisorMessage[] }>(`/games/${id}/advisor`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  advisorMessages: (id: string) => request<AdvisorMessage[]>(`/games/${id}/advisor`),
  clearAdvisor: (id: string) => request<void>(`/games/${id}/advisor`, { method: 'DELETE' }),
  turnRuns: (id: string) => request<TurnRun[]>(`/games/${id}/turn-runs`),
  snapshots: (id: string) => request<GameSnapshot[]>(`/games/${id}/snapshots`),
  createSnapshot: (id: string, label: string) =>
    request<GameSnapshot>(`/games/${id}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restoreSnapshot: (gameId: string, snapshotId: string) =>
    request<Game>(`/games/${gameId}/snapshots/${snapshotId}/restore`, { method: 'POST' }),
  consolidations: (id: string) =>
    request<{ settings: ConsolidationSettings; items: Consolidation[] }>(
      `/games/${id}/consolidations`,
    ),
  updateConsolidationSettings: (id: string, settings: ConsolidationSettings) =>
    request<ConsolidationSettings>(`/games/${id}/consolidations/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  updateConsolidation: (gameId: string, id: string, summary: string) =>
    request<Consolidation>(`/games/${gameId}/consolidations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ summary }),
    }),
  deleteConsolidation: (gameId: string, id: string) =>
    request<void>(`/games/${gameId}/consolidations/${id}`, { method: 'DELETE' }),
  gameRegions: (id: string) => request<GameRegion[]>(`/games/${id}/world/regions`),
  updateGameRegion: (
    gameId: string,
    regionId: string,
    input: Partial<Pick<GameRegion, 'ownerNationCode' | 'regionType'>>,
  ) =>
    request<GameRegion>(`/games/${gameId}/world/regions/${encodeURIComponent(regionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  mapFeatures: (id: string) => request<MapFeature[]>(`/games/${id}/world/features`),
  createMapFeature: (gameId: string, input: CreateMapFeatureInput) =>
    request<MapFeature>(`/games/${gameId}/world/features`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateMapFeature: (gameId: string, id: string, input: Partial<CreateMapFeatureInput>) =>
    request<MapFeature>(`/games/${gameId}/world/features/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteMapFeature: (gameId: string, id: string) =>
    request<void>(`/games/${gameId}/world/features/${id}`, { method: 'DELETE' }),
  worldHistory: (id: string) =>
    request<Array<Record<string, unknown>>>(`/games/${id}/world/history`),
  presets: () => request<Preset[]>('/presets'),
  preset: (id: string) => request<PresetDetail>(`/presets/${id}`),
  createPreset: (input: CreatePresetInput) =>
    request<PresetDetail>('/presets', { method: 'POST', body: JSON.stringify(input) }),
  updatePreset: (id: string, input: UpdatePresetInput) =>
    request<PresetDetail>(`/presets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  publishPreset: (id: string) =>
    request<PresetDetail>(`/presets/${id}/publish`, { method: 'POST' }),
  duplicatePreset: (id: string) =>
    request<PresetDetail>(`/presets/${id}/duplicate`, { method: 'POST' }),
  archivePreset: (id: string) => request<void>(`/presets/${id}/archive`, { method: 'POST' }),
  exportPreset: (id: string) => request<PresetDetail>(`/presets/${id}/export`),
  importPreset: (input: CreatePresetInput) =>
    request<PresetDetail>('/presets/import', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  presetPreview: (id: string, gameId?: string) =>
    request<{ helpers: Record<string, string>; prompts: Array<Record<string, string>> }>(
      `/presets/${id}/preview${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ''}`,
    ),
  playPreset: (id: string, input: { nationCode: string; name?: string; difficulty?: string }) =>
    request<Game>(`/presets/${id}/play`, { method: 'POST', body: JSON.stringify(input) }),
  llmSettings: () => request<LlmSettingsPublic>('/llm/settings'),
  saveLlmSettings: (input: LlmSettingsInput) =>
    request<LlmSettingsPublic>('/llm/settings', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  testLlmSettings: (input: LlmSettingsInput) =>
    request<{ success: boolean; model: string }>('/llm/settings/test', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  llmActivity: (gameId?: string, limit = 100) =>
    request<LlmActivity[]>(
      `/llm/activity?limit=${limit}${gameId ? `&gameId=${encodeURIComponent(gameId)}` : ''}`,
    ),
  llmActivityStreamUrl: () =>
    `/api/v1/llm/activity/stream?clientId=${encodeURIComponent(getClientId())}`,
};

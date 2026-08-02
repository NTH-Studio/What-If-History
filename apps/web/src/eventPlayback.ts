import type { GameEvent } from '@what-if-history/contracts';

export function eventPlaybackStorageKey(gameId: string) {
  return `what-if-history-event-playback:${gameId}`;
}

export function queueEventPlayback(gameId: string, events: GameEvent[]) {
  const storageKey = eventPlaybackStorageKey(gameId);
  if (!events.length) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      eventIds: events.map((event) => event.id),
      index: 0,
    }),
  );
}

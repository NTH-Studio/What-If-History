import type { Response } from 'express';

export type StreamEvent = 'turn.started' | 'turn.completed' | 'turn.failed' | 'world.changed';

export class SseHub {
  private readonly clients = new Map<string, Set<Response>>();

  subscribe(gameId: string, response: Response) {
    const group = this.clients.get(gameId) ?? new Set<Response>();
    group.add(response);
    this.clients.set(gameId, group);
    response.write(`event: connected\ndata: ${JSON.stringify({ gameId })}\n\n`);
    return () => {
      group.delete(response);
      if (group.size === 0) this.clients.delete(gameId);
    };
  }

  publish(gameId: string, event: StreamEvent, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of this.clients.get(gameId) ?? []) {
      response.write(payload);
    }
  }
}

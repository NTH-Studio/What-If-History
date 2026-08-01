import type { Router } from 'express';
import { z } from 'zod';
import {
  createUnitInputSchema,
  moveUnitInputSchema,
  movementOrderInputSchema,
  updateEventInputSchema,
} from '@what-if-history/contracts';
import { parseUuid, type ApiRouteContext } from './context.js';

export function registerWorldRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, publishWorldChanged } = context;
  router.get('/games/:gameId/events', (req, res) => {
    res.json(dependencies.repository.listEvents(parseUuid(req.params.gameId)));
  });
  router.patch('/games/:gameId/events/:eventId', (req, res) => {
    const input = updateEventInputSchema.parse(req.body);
    res.json(
      dependencies.advanced.updateEvent(
        parseUuid(req.params.gameId),
        parseUuid(req.params.eventId),
        {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.event_type !== undefined ? { event_type: input.event_type } : {}),
          ...(input.severity !== undefined ? { severity: input.severity } : {}),
        },
      ),
    );
  });
  router.delete('/games/:gameId/events/:eventId', (req, res) => {
    dependencies.advanced.deleteEvent(parseUuid(req.params.gameId), parseUuid(req.params.eventId));
    res.status(204).end();
  });

  router.get('/games/:gameId/units', (req, res) => {
    res.json(dependencies.repository.listUnits(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/units', (req, res) => {
    const input = createUnitInputSchema.parse(req.body);
    res.status(201).json(dependencies.repository.createUnit(parseUuid(req.params.gameId), input));
  });
  router.put('/games/:gameId/units/:unitId/move', (req, res) => {
    const input = moveUnitInputSchema.parse(req.body);
    res.json(
      dependencies.repository.moveUnit(
        parseUuid(req.params.gameId),
        parseUuid(req.params.unitId),
        input.regionId,
        input.centroid,
      ),
    );
  });
  router.delete('/games/:gameId/units/:unitId', (req, res) => {
    dependencies.repository.deleteUnit(parseUuid(req.params.gameId), parseUuid(req.params.unitId));
    res.status(204).end();
  });

  router.get('/games/:gameId/strategic-state', (req, res) => {
    const sinceRevision =
      req.query.sinceRevision === undefined
        ? undefined
        : z.coerce.number().int().nonnegative().parse(req.query.sinceRevision);
    res.json(
      dependencies.strategic.getState(
        parseUuid(req.params.gameId),
        ...(sinceRevision === undefined ? [] : [sinceRevision]),
      ),
    );
  });
  router.get('/games/:gameId/characters', (req, res) => {
    res.json(dependencies.strategic.listCharacters(parseUuid(req.params.gameId)));
  });
  router.get('/games/:gameId/contacts', (req, res) => {
    res.json(dependencies.strategic.listContacts(parseUuid(req.params.gameId)));
  });
  router.get('/games/:gameId/timeline', (req, res) => {
    const limit = z.coerce.number().int().min(1).max(1_000).default(300).parse(req.query.limit);
    res.json(dependencies.strategic.listTimeline(parseUuid(req.params.gameId), limit));
  });
  router.post('/games/:gameId/orders/preview', (req, res) => {
    res.json(
      dependencies.strategic.previewOrder(
        parseUuid(req.params.gameId),
        movementOrderInputSchema.parse(req.body),
      ),
    );
  });
  router.post('/games/:gameId/orders', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const input = movementOrderInputSchema.parse(req.body);
    const order = dependencies.strategic.createOrder(gameId, input);
    publishWorldChanged(gameId, { unitIds: [order.unitId] });
    res.status(201).json(order);
  });
}

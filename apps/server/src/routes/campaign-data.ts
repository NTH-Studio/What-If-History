import type { Router } from 'express';
import { z } from 'zod';
import {
  consolidationSettingsSchema,
  createMapFeatureInputSchema,
  updateConsolidationInputSchema,
  updateGameRegionInputSchema,
  updateMapFeatureInputSchema,
} from '@what-if-history/contracts';
import { parseUuid, requestLanguage, type ApiRouteContext } from './context.js';

export function registerCampaignDataRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies, publishWorldChanged } = context;
  router.get('/games/:gameId/turn-runs', (req, res) => {
    res.json(dependencies.advanced.listTurnRuns(parseUuid(req.params.gameId)));
  });
  router.get('/games/:gameId/snapshots', (req, res) => {
    res.json(dependencies.advanced.listSnapshots(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/snapshots', (req, res) => {
    const label = z.string().trim().min(1).max(120).parse(req.body?.label);
    res.status(201).json(dependencies.advanced.createSnapshot(parseUuid(req.params.gameId), label));
  });
  router.post('/games/:gameId/snapshots/:snapshotId/restore', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    dependencies.advanced.restoreSnapshot(gameId, parseUuid(req.params.snapshotId));
    res.json(dependencies.repository.getGame(gameId, requestLanguage(req)));
  });

  router.get('/games/:gameId/consolidations', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    res.json({
      settings: dependencies.advanced.getConsolidationSettings(gameId),
      items: dependencies.advanced.listConsolidations(gameId),
    });
  });
  router.patch('/games/:gameId/consolidations/settings', (req, res) => {
    res.json(
      dependencies.advanced.updateConsolidationSettings(
        parseUuid(req.params.gameId),
        consolidationSettingsSchema.parse(req.body),
      ),
    );
  });
  router.patch('/games/:gameId/consolidations/:consolidationId', (req, res) => {
    const { summary } = updateConsolidationInputSchema.parse(req.body);
    res.json(
      dependencies.advanced.updateConsolidation(
        parseUuid(req.params.gameId),
        parseUuid(req.params.consolidationId),
        summary,
      ),
    );
  });
  router.delete('/games/:gameId/consolidations/:consolidationId', (req, res) => {
    dependencies.advanced.deleteConsolidation(
      parseUuid(req.params.gameId),
      parseUuid(req.params.consolidationId),
    );
    res.status(204).end();
  });

  router.get('/games/:gameId/world/regions', (req, res) => {
    res.json(dependencies.advanced.listRegions(parseUuid(req.params.gameId)));
  });
  router.patch('/games/:gameId/world/regions/:regionId', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const regionId = z.string().min(1).max(160).parse(req.params.regionId);
    const input = updateGameRegionInputSchema.parse(req.body);
    const region = dependencies.advanced.updateRegion(gameId, regionId, {
      ...(input.ownerNationCode !== undefined ? { ownerNationCode: input.ownerNationCode } : {}),
      ...(input.controllerNationCode !== undefined
        ? { controllerNationCode: input.controllerNationCode }
        : {}),
      ...(input.claimNationCodes !== undefined ? { claimNationCodes: input.claimNationCodes } : {}),
      ...(input.regionType !== undefined ? { regionType: input.regionType } : {}),
    });
    publishWorldChanged(gameId, { regionIds: [regionId] });
    res.json(region);
  });
  router.get('/games/:gameId/world/features', (req, res) => {
    res.json(dependencies.advanced.listMapFeatures(parseUuid(req.params.gameId)));
  });
  router.post('/games/:gameId/world/features', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const feature = dependencies.advanced.createMapFeature(
      gameId,
      createMapFeatureInputSchema.parse(req.body),
    );
    publishWorldChanged(gameId, { featureIds: [feature.id] });
    res.status(201).json(feature);
  });
  router.patch('/games/:gameId/world/features/:featureId', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const featureId = parseUuid(req.params.featureId);
    const feature = dependencies.advanced.updateMapFeature(
      gameId,
      featureId,
      updateMapFeatureInputSchema.parse(req.body),
    );
    publishWorldChanged(gameId, { featureIds: [featureId] });
    res.json(feature);
  });
  router.delete('/games/:gameId/world/features/:featureId', (req, res) => {
    const gameId = parseUuid(req.params.gameId);
    const featureId = parseUuid(req.params.featureId);
    dependencies.advanced.deleteMapFeature(gameId, featureId);
    publishWorldChanged(gameId, { featureIds: [featureId] });
    res.status(204).end();
  });
  router.get('/games/:gameId/world/history', (req, res) => {
    res.json(dependencies.advanced.listWorldMutations(parseUuid(req.params.gameId)));
  });
}

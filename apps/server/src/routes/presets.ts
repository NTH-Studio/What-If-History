import type { Router } from 'express';
import {
  createGameInputSchema,
  createPresetInputSchema,
  nationCodeSchema,
  updatePresetInputSchema,
} from '@what-if-history/contracts';
import { AppError } from '../errors.js';
import { parseUuid, requestLanguage, type ApiRouteContext } from './context.js';

export function registerPresetRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies } = context;
  router.get('/presets', (_req, res) => {
    res.json(dependencies.advanced.listPresets());
  });
  router.post('/presets', (req, res) => {
    res
      .status(201)
      .json(dependencies.advanced.createPreset(createPresetInputSchema.parse(req.body)));
  });
  router.get('/presets/:presetId', (req, res) => {
    res.json(dependencies.advanced.getPreset(parseUuid(req.params.presetId)));
  });
  router.patch('/presets/:presetId', (req, res) => {
    res.json(
      dependencies.advanced.updatePreset(
        parseUuid(req.params.presetId),
        updatePresetInputSchema.parse(req.body),
      ),
    );
  });
  router.post('/presets/:presetId/publish', (req, res) => {
    res.json(dependencies.advanced.publishPreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/:presetId/duplicate', (req, res) => {
    res.status(201).json(dependencies.advanced.duplicatePreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/:presetId/archive', (req, res) => {
    dependencies.advanced.archivePreset(parseUuid(req.params.presetId));
    res.status(204).end();
  });
  router.get('/presets/:presetId/export', (req, res) => {
    res.json(dependencies.advanced.getPreset(parseUuid(req.params.presetId)));
  });
  router.post('/presets/import', (req, res) => {
    const imported = createPresetInputSchema.parse(req.body);
    res.status(201).json(dependencies.advanced.createPreset(imported));
  });
  router.get('/presets/:presetId/preview', (req, res) => {
    const gameId = req.query.gameId === undefined ? undefined : parseUuid(req.query.gameId);
    res.json(dependencies.advanced.previewPreset(parseUuid(req.params.presetId), gameId));
  });
  router.post('/presets/:presetId/play', (req, res) => {
    const preset = dependencies.advanced.getPreset(parseUuid(req.params.presetId));
    const nationCode = nationCodeSchema.parse(req.body?.nationCode);
    if (!preset.playableNationCodes.includes(nationCode)) {
      throw new AppError(400, 'NATION_NOT_PLAYABLE', 'The nation is not playable in this preset.');
    }
    const game = dependencies.repository.createGame(
      createGameInputSchema.parse({
        nationCode,
        startDate: preset.startDate,
        name: req.body?.name,
        difficulty: req.body?.difficulty ?? preset.recommendedDifficulty,
        presetId: preset.id,
        scenario: { mode: 'custom', premise: preset.worldContext },
      }),
      requestLanguage(req),
    );
    dependencies.advanced.applyPresetInitialWorld(game.id, preset.initialWorld);
    res
      .status(201)
      .json(
        dependencies.repository.updateGameConfig(
          game.id,
          { simulationRules: preset.simulationRules, aiModels: preset.aiModels },
          requestLanguage(req),
        ),
      );
  });
}

import { Router } from 'express';
import { registerActionRoutes } from './routes/actions.js';
import { registerAdvisorRoutes } from './routes/advisor.js';
import { registerCampaignDataRoutes } from './routes/campaign-data.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { createApiRouteContext, type ApiDependencies } from './routes/context.js';
import { registerDiplomacyRoutes } from './routes/diplomacy.js';
import { registerGameRoutes } from './routes/games.js';
import { registerLlmRoutes } from './routes/llm.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerWorldRoutes } from './routes/world.js';

export function createApiRouter(dependencies: ApiDependencies) {
  const router = Router();
  const context = createApiRouteContext(dependencies);

  registerCatalogRoutes(router, context);
  registerGameRoutes(router, context);
  registerActionRoutes(router, context);
  registerWorldRoutes(router, context);
  registerDiplomacyRoutes(router, context);
  registerAdvisorRoutes(router, context);
  registerCampaignDataRoutes(router, context);
  registerPresetRoutes(router, context);
  registerLlmRoutes(router, context);
  registerStreamRoutes(router, context);

  return router;
}

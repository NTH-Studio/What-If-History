import type { Router } from 'express';
import { isoDateSchema } from '@what-if-history/contracts';
import { requestLanguage, type ApiRouteContext } from './context.js';

export function registerCatalogRoutes(router: Router, context: ApiRouteContext) {
  const { dependencies } = context;
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: 'sqlite', version: '4.0.0' });
  });

  router.get('/catalog/nations', (req, res) => {
    const date = req.query.date === undefined ? null : isoDateSchema.parse(req.query.date);
    res.json(
      date
        ? dependencies.repository.listHistoricalNations(date, requestLanguage(req))
        : dependencies.catalog.listNations(requestLanguage(req)),
    );
  });
  router.get('/catalog/historical-world', (req, res) => {
    const date = isoDateSchema.parse(req.query.date);
    res.json(dependencies.repository.previewHistoricalWorld(date, requestLanguage(req)));
  });
  router.get('/map/regions', (_req, res) => {
    res.json(dependencies.catalog.regions);
  });
  router.get('/map/cities', (req, res) => {
    res.json(dependencies.catalog.listCities(requestLanguage(req)));
  });
}

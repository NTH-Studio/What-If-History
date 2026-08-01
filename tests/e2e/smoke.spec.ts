import { expect, test } from '@playwright/test';

test('serves a supported permissions policy without browser console warnings', async ({ page }) => {
  const policyWarnings: string[] = [];
  page.on('console', (message) => {
    if (/permissions-policy|browsing-topics/i.test(message.text())) {
      policyWarnings.push(message.text());
    }
  });

  const response = await page.goto('/');
  expect(response?.headers()['permissions-policy']).toBe(
    'camera=(), geolocation=(), microphone=()',
  );
  await page.reload();
  expect(policyWarnings).toEqual([]);
});

test('shows the new identity and persists every display family', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle('What If: History');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    'href',
    '/what-if-history-mark-v2.png',
  );
  await expect(page.getByText('WHAT IF: HISTORY').first()).toBeVisible();
  await expect(page.getByText('Chaque décision écrit l’Histoire.')).toBeVisible();

  const studioSupport = page.getByTestId('studio-support');
  await expect(studioSupport).toBeVisible();
  await expect(studioSupport.locator('img[src="/branding/logo_nthstudio.png"]')).toBeVisible();
  await expect(studioSupport.locator('img[src="/branding/logo_kofi.svg"]')).toBeVisible();
  const nthStudioLink = page.getByRole('link', { name: 'Découvrir NTH Studio' });
  const kofiLink = page.getByRole('link', { name: 'Soutenir sur Ko-fi' });
  await expect(nthStudioLink).toHaveAttribute('href', 'https://nthstudio.eu');
  await expect(kofiLink).toHaveAttribute('href', 'https://ko-fi.com/nthstudio');
  for (const externalLink of [nthStudioLink, kofiLink]) {
    await expect(externalLink).toHaveAttribute('target', '_blank');
    await expect(externalLink).toHaveAttribute('rel', 'noreferrer');
  }
  const studioGeometry = await studioSupport.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const logos = [...element.querySelectorAll('img')];
    return {
      contained: bounds.left >= 0 && bounds.right <= window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      logosLoaded: logos.every((logo) => logo.complete && logo.naturalWidth > 0),
    };
  });
  expect(studioGeometry).toEqual({
    contained: true,
    documentOverflow: false,
    logosLoaded: true,
  });

  await page.getByRole('button', { name: 'Apparence et affichage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apparence et affichage' });
  if (testInfo.project.name === 'mobile') {
    const mobileDialog = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const grid = element.querySelector<HTMLElement>('[class*="_preferenceGrid_"]');
      return {
        bottomGap: window.innerHeight - bounds.bottom,
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
        heightRatio: bounds.height / window.innerHeight,
        left: bounds.left,
        right: bounds.right,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      };
    });
    expect(mobileDialog.documentOverflow).toBe(false);
    expect(mobileDialog.heightRatio).toBeLessThanOrEqual(0.89);
    expect(mobileDialog.bottomGap).toBeGreaterThanOrEqual(7);
    expect(mobileDialog.left).toBeGreaterThanOrEqual(7);
    expect(mobileDialog.right).toBeLessThanOrEqual(386);
    expect(mobileDialog.gridColumns).toBe(2);
  }
  await dialog.getByRole('button', { name: 'Double page' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-desktop-layout', 'spread');
  await dialog.getByRole('button', { name: 'Dossier' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-desktop-layout', 'dossier');
  await dialog.getByRole('button', { name: 'Atlas central' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-desktop-layout', 'atlas');

  await dialog.getByRole('button', { name: 'Sommaire latéral' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mobile-navigation', 'drawer');
  await dialog.getByRole('button', { name: 'Onglets défilants' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mobile-navigation', 'tabs');
  await dialog.getByRole('button', { name: 'Barre basse + sommaire' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mobile-navigation', 'bottom');

  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-desktop-layout', 'atlas');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-navigation', 'bottom');
});

test('tests saved AI settings without requiring the API key again', async ({ page, request }) => {
  await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'lm-studio',
      apiUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'stored-e2e-key',
      model: 'deterministic-settings-e2e',
      clearApiKey: false,
    },
  });
  let submittedSettings: Record<string, unknown> | undefined;
  await page.route('**/api/v1/llm/settings/test', async (route) => {
    submittedSettings = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        model: 'deterministic-settings-e2e',
        response: 'OK',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Configuration IA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configuration IA' });
  await expect(dialog.locator('input[name="apiKey"]')).toHaveAttribute(
    'placeholder',
    /Laisser vide/,
  );
  await dialog.getByRole('button', { name: 'Tester la connexion' }).click();
  await expect(dialog.getByRole('status')).toContainText('Connexion');
  expect(submittedSettings).toMatchObject({
    provider: 'lm-studio',
    apiUrl: 'http://127.0.0.1:9/v1',
    model: 'deterministic-settings-e2e',
  });
  expect(submittedSettings).not.toHaveProperty('apiKey');
});

test('creates and opens a campaign without native dialogs', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What If: History' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle campagne' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle campagne' });
  if (testInfo.project.name === 'mobile') {
    const mobileCampaignDialog = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        heightRatio: bounds.height / window.innerHeight,
        right: bounds.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(mobileCampaignDialog.heightRatio).toBeLessThanOrEqual(0.89);
    expect(mobileCampaignDialog.right).toBeLessThanOrEqual(mobileCampaignDialog.viewportWidth - 7);
  }
  const nation = page.getByRole('combobox', { name: 'Nation' });
  await nation.fill('fra');
  await expect(page.getByRole('option', { name: /FRA$/ })).toBeVisible();
  await expect(nation).toHaveAttribute('aria-activedescendant', 'nation-option-FRA');
  await nation.press('Enter');
  await expect(nation).toHaveValue(/FRA$/);
  await page.getByRole('button', { name: 'Lancer la campagne' }).click();
  await expect(page.getByRole('heading', { name: 'Vue stratégique' })).toBeVisible({
    timeout: 15_000,
  });
});

test('dates leaders, playable nations and the strategic map at campaign creation', async ({
  page,
  request,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle campagne' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle campagne' });
  const nation = dialog.getByRole('combobox', { name: 'Nation' });

  await nation.fill('FRA');
  await dialog.getByRole('option', { name: /FRA$/ }).click();
  await expect(dialog.getByText('Albert Lebrun')).toBeVisible();

  await dialog.locator('input[type="date"]').fill('2025-01-01');
  await expect(dialog.getByText('Emmanuel Macron')).toBeVisible();
  await expect(dialog.getByText('Albert Lebrun')).toHaveCount(0);
  await expect(
    dialog.getByText('Cette date se trouve hors de la chronologie documentée.'),
  ).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Lancer la campagne' })).toBeEnabled();

  await dialog.locator('input[type="date"]').fill('2000-01-01');
  await expect(dialog.getByText('Jacques Chirac')).toBeVisible();
  await expect(dialog.getByText('Lionel Jospin')).toBeVisible();
  await expect(dialog.getByText('Albert Lebrun')).toHaveCount(0);
  await expect(dialog.getByText(/r.gions strat.giques du jeu/i)).toBeVisible();

  await dialog.getByRole('button', { name: 'Lancer la campagne' }).click();
  await expect(page.getByRole('heading', { name: /Vue strat/ })).toBeVisible();
  const gameId = new URL(page.url()).pathname.split('/')[2]!;

  const profile = await request.get(`/api/v1/games/${gameId}/countries/FRA`);
  expect(profile.ok()).toBe(true);
  expect(await profile.json()).toMatchObject({
    leaderName: 'Jacques Chirac',
    baselineDate: '2000-01-01',
    officeHolders: [
      expect.objectContaining({ name: 'Jacques Chirac', role: 'head_of_state' }),
      expect.objectContaining({ name: 'Lionel Jospin', role: 'head_of_government' }),
    ],
  });

  await page.goto(`/game/${gameId}/map`);
  await expect(page.locator('img[src$="/1936.svg"]')).toHaveCount(0);
  const neutralRegion = page.locator('[class*="neutralMapOverlay"] path').first();
  await expect(neutralRegion).toBeVisible();
  expect(await neutralRegion.evaluate((element) => getComputedStyle(element).fill)).toBe(
    'rgb(38, 57, 68)',
  );
  expect(consoleErrors).toEqual([]);
  await request.delete(`/api/v1/games/${gameId}`, { maxRetries: 2 });
});

test('creates, displays and simulates a persistent custom scenario', async ({ page, request }) => {
  const premise = 'Une épidémie mondiale frappe tous les continents en 1936.';
  const settingsResponse = await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-scenario-e2e',
      apiKey: '',
      clearApiKey: true,
    },
  });
  expect(settingsResponse.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle campagne' }).click();
  await page.getByRole('combobox', { name: 'Nation' }).fill('fra');
  await page.getByRole('option', { name: /FRA/ }).click();
  await page.getByLabel(/Nom de la campagne/).fill('Épidémie mondiale E2E');
  await page.getByRole('radio', { name: /Scénario personnalisé/ }).check();
  await page.getByLabel('Prémisse du scénario').fill(premise);

  await page.getByRole('radio', { name: /Histoire classique/ }).check();
  await page.getByRole('radio', { name: /Scénario personnalisé/ }).check();
  await expect(page.getByLabel('Prémisse du scénario')).toHaveValue(premise);

  await page.getByRole('button', { name: 'Lancer la campagne' }).click();
  await expect(page.getByText('Briefing du scénario')).toBeVisible();
  await expect(page.getByText(premise)).toBeVisible();

  const gameId = new URL(page.url()).pathname.split('/')[2];
  await page.getByRole('button', { name: 'Apparence et affichage' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Scenario briefing')).toBeVisible();
  await page.getByRole('button', { name: 'Appearance and display' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Français' }).click();
  await page.getByRole('button', { name: 'Fermer' }).click();

  await page.goto(`/game/${gameId}/timeline`);
  await expect(page).toHaveURL(new RegExp(`/game/${gameId}/history$`));
  await expect(page.getByTestId('simulation-history')).toBeVisible();
  await expect(page.getByTestId('time-advance-command')).toHaveCount(0);
  await page.getByRole('button', { name: 'Avancer le temps' }).click();
  await page.getByRole('button', { name: 'Lancer la simulation' }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/games/${gameId}`);
      return ((await response.json()) as { turnNumber: number }).turnNumber;
    })
    .toBe(2);

  const stored = await request.get(`/api/v1/games/${gameId}`);
  expect(stored.ok()).toBe(true);
  expect(await stored.json()).toMatchObject({
    scenarioMode: 'custom',
    worldContext: premise,
    turnNumber: 2,
  });
  await request.delete(`/api/v1/games/${gameId}`, { maxRetries: 2 });
});

test('promulgates a law without a vote from the actions screen', async ({ page, request }) => {
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Promulgation E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  await page.goto(`/game/${game.id}/actions`);
  await page
    .getByPlaceholder('Ex. Renforcer les défenses de la frontière orientale…')
    .fill('Rendre la vaccination obligatoire.');
  await page.getByRole('button', { name: 'Promulguer sans vote' }).click();
  const confirmation = page.getByRole('alertdialog', {
    name: 'Promulguer cette loi sans vote ?',
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Promulguer la loi' }).click();

  await expect(page.getByText('Rendre la vaccination obligatoire.')).toBeVisible();
  await expect(page.getByText('Promulguée · effet au prochain tour')).toBeVisible();
  await expect(page.getByText('Loi', { exact: true })).toBeVisible();

  const actionsResponse = await request.get(`/api/v1/games/${game.id}/actions`);
  expect(actionsResponse.ok()).toBe(true);
  expect(await actionsResponse.json()).toContainEqual(
    expect.objectContaining({
      actionType: 'law',
      status: 'pending',
      actionText: 'Rendre la vaccination obligatoire.',
    }),
  );
  await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
});

test('previews and paints the guaranteed Paris cession without a page reload', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-paris-v4',
      apiKey: '',
      clearApiKey: true,
    },
  });
  const gameResponse = await request.post('/api/v1/games', {
    data: { nationCode: 'FRA', startDate: '1936-01-01', name: 'Paris cession v4' },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };
  const nationsResponse = await request.get('/api/v1/catalog/nations');
  const nations = (await nationsResponse.json()) as Array<{ code: string; color: string }>;
  const franceColor = nations.find((nation) => nation.code === 'FRA')!.color;
  const germanyColor = nations.find((nation) => nation.code === 'GER')!.color;

  try {
    await page.goto(`/game/${game.id}/actions`);
    await page
      .getByPlaceholder('Ex. Renforcer les défenses de la frontière orientale…')
      .fill("donner Paris à l'Allemagne");
    await page.getByRole('button', { name: 'Prévisualiser les effets' }).click();
    await expect(page.getByText('Cession · Ile_de_France → GER')).toBeVisible();
    await page.getByRole('button', { name: 'Soumettre à validation' }).click();
    await expect(page.getByText("donner Paris à l'Allemagne")).toBeVisible();

    await page.goto(`/game/${game.id}/map`);
    const paris = page.locator('[data-region-id="Ile_de_France"]');
    await expect(paris).toHaveAttribute('data-owner-code', 'FRA');
    await expect(paris).toHaveCSS('vector-effect', 'non-scaling-stroke');
    await expect(paris).toHaveCSS('stroke-width', '1.15px');
    const normalizedColor = (color: string) =>
      page.evaluate((value) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.body.append(probe);
        const normalized = getComputedStyle(probe).color;
        probe.remove();
        return normalized;
      }, color);
    expect(await paris.evaluate((element) => getComputedStyle(element).fill)).toBe(
      await normalizedColor(franceColor),
    );

    await page.getByRole('button', { name: 'Avancer le temps' }).click();
    await page.getByRole('button', { name: 'Lancer la simulation' }).click();
    await expect(page.getByText('Événement 1 sur 1')).toBeVisible();
    await expect(paris).toHaveAttribute('data-owner-code', 'GER');
    await expect(paris).toHaveAttribute('data-controller-code', 'GER');
    await expect
      .poll(() => paris.evaluate((element) => getComputedStyle(element).fill))
      .toBe(await normalizedColor(germanyColor));
    await page.getByRole('button', { name: 'Terminer' }).click();

    await expect(page.getByRole('dialog', { name: 'Bilan du tour' })).toHaveCount(0);
    await page.goto(`/game/${game.id}/events`);
    const turnDetails = page.locator('details').filter({ hasText: 'Détails du tour' });
    await expect(turnDetails).toBeVisible();
    await turnDetails.locator('summary').click();
    await expect(turnDetails.getByText('Décisions du joueur')).toBeVisible();
    await expect(turnDetails.getByText('Territoire · Ile de France')).toBeVisible();
    await expect(turnDetails.getByText('Capitale · FRA')).toBeVisible();
    await expect(turnDetails.getByText('Statut de la capitale')).toBeVisible();
    await expect(turnDetails.getByText('Propriétaire')).toBeVisible();
    await expect(turnDetails).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}/i);

    const regions = (await (
      await request.get(`/api/v1/games/${game.id}/world/regions`)
    ).json()) as Array<{
      regionId: string;
      ownerNationCode: string;
      controllerNationCode: string;
    }>;
    expect(regions.find((region) => region.regionId === 'Ile_de_France')).toMatchObject({
      ownerNationCode: 'GER',
      controllerNationCode: 'GER',
    });
    const features = (await (
      await request.get(`/api/v1/games/${game.id}/world/features`)
    ).json()) as Array<{ name: string; nationCode: string; featureType: string }>;
    expect(features.find((feature) => feature.name === 'Paris')).toMatchObject({
      nationCode: 'GER',
      featureType: 'city',
    });
    const actions = (await (
      await request.get(`/api/v1/games/${game.id}/actions`)
    ).json()) as Array<{ status: string; effectStatus: string }>;
    expect(actions[0]).toMatchObject({ status: 'completed', effectStatus: 'applied' });
    const history = (await (
      await request.get(`/api/v1/games/${game.id}/world/history`)
    ).json()) as Array<{ targetId: string; worldRevision: number }>;
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: 'Ile_de_France', worldRevision: 1 }),
      ]),
    );
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('shows Gibraltar as a British Overseas Territory rather than the United Kingdom', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  );
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const gameResponse = await request.post('/api/v1/games', {
    data: { nationCode: 'FRA', startDate: '2020-01-01', name: 'Gibraltar 2020 E2E' },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  try {
    const regions = (await (
      await request.get(`/api/v1/games/${game.id}/world/regions`)
    ).json()) as Array<{
      regionId: string;
      territorialStatus: string | null;
      administeringNationCode: string | null;
      claimNationCodes: string[];
    }>;
    expect(regions.find((region) => region.regionId === 'Gibraltar')).toMatchObject({
      territorialStatus: 'overseas_territory',
      administeringNationCode: 'ENG',
      claimNationCodes: ['SPR'],
    });

    await page.goto(`/game/${game.id}/map`);
    await page.getByRole('button', { name: 'Inspecter Gibraltar' }).click();
    const intel = page.locator('aside').filter({ hasText: 'INTEL · GEO' });
    await expect(intel).toContainText('Territoire britannique d’outre-mer');
    await expect(intel).toContainText('Puissance administrante');
    await expect(intel).toContainText('Royaume-Uni');
    await expect(intel).toContainText('Revendication');
    await expect(intel).toContainText('Espagne');
    await expect(intel).toContainText('Forteresse');
    await expect(intel.getByText('Nation', { exact: true })).toHaveCount(0);
    await expect(intel).toBeInViewport();
    expect(
      await intel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth && element.clientWidth > 0,
      ),
    ).toBe(true);
    expect(consoleErrors).toEqual([]);
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('explores, compares and evolves complete country profiles', async ({ page, request }) => {
  const settingsResponse = await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-countries-e2e',
      apiKey: '',
      clearApiKey: true,
    },
  });
  expect(settingsResponse.ok()).toBe(true);
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Profils pays E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  const beforeResponse = await request.get(`/api/v1/games/${game.id}/countries/FRA`);
  const before = (await beforeResponse.json()) as { indicators: { gdp: number } };

  await page.goto(`/game/${game.id}/countries/FRA`);
  await expect(page.getByRole('heading', { name: 'République française' })).toBeVisible();
  await expect(
    page.locator('article').filter({ hasText: 'Population estimée' }).first(),
  ).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'PIB estimé' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Lois' }).click();
  await expect(page.getByRole('heading', { name: 'Lois et politiques' })).toBeVisible();

  await page.getByRole('button', { name: 'Comparer' }).click();
  await page.getByLabel('Comparer avec').selectOption('GER');
  const comparison = page.getByRole('table', { name: 'Comparer les pays' });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByText('Reich allemand')).toBeVisible();

  const lawResponse = await request.post(`/api/v1/games/${game.id}/actions/promulgate-law`, {
    data: { actionText: 'Garantir un salaire minimum national.' },
  });
  expect(lawResponse.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Lois' }).click();
  await expect(page.getByText('Garantir un salaire minimum national.')).toHaveCount(0);

  const turnResponse = await request.post(`/api/v1/games/${game.id}/turns`, {
    data: { amount: 1, unit: 'month' },
  });
  expect(turnResponse.ok()).toBe(true);
  const afterResponse = await request.get(`/api/v1/games/${game.id}/countries/FRA`);
  const after = (await afterResponse.json()) as { indicators: { gdp: number } };
  expect(after.indicators.gdp).toBeGreaterThan(before.indicators.gdp);
  await page.reload();
  await page.getByRole('button', { name: 'Lois' }).click();
  await expect(page.getByText('Garantir un salaire minimum national.')).toBeVisible();

  await page.goto(`/game/${game.id}/map`);
  const franceRegions = page.locator('path[data-owner-code="FRA"]');
  await expect(franceRegions).not.toHaveCount(0);
  const franceRegion = franceRegions.first();
  await expect(franceRegion).toBeAttached();
  const mapMarkers = page.locator('.leaflet-interactive');
  const visibleMarkerIndex = await mapMarkers.evaluateAll((markers) =>
    markers.findIndex((marker) => {
      const bounds = marker.getBoundingClientRect();
      const center = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return bounds.width > 0 && bounds.height > 0 && center === marker;
    }),
  );
  expect(visibleMarkerIndex).toBeGreaterThanOrEqual(0);
  await mapMarkers.nth(visibleMarkerIndex).click();
  await page.getByRole('button', { name: 'Actions' }).last().click();
  await page.getByRole('button', { name: 'Utiliser dans l’ordre' }).click();
  await expect(
    page.getByPlaceholder('Ex. Renforcer les défenses de la frontière orientale…'),
  ).toHaveValue(/^Contexte cartographique : .+ \([A-Z]{3}\)\.$/);

  await page.goto(`/game/${game.id}/map`);
  await franceRegion.focus();
  await franceRegion.press('Enter');
  await expect(page.getByText('INTEL · GEO')).toBeVisible();
  await page.getByRole('button', { name: 'Voir République française' }).click();
  await expect(page).toHaveURL(new RegExp(`/game/${game.id}/countries/FRA$`));

  await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
});

test('mobile navigation and event theater remain usable', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Nouvelle campagne' })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' }).click();
  const panel = page.getByRole('dialog', { name: 'Activité IA' });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(390);
  await panel.getByRole('button', { name: 'Fermer' }).click();

  const settingsResponse = await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-mobile-map-first',
      apiKey: '',
      clearApiKey: true,
    },
  });
  expect(settingsResponse.ok()).toBe(true);
  const gameResponse = await request.post('/api/v1/games', {
    data: { nationCode: 'FRA', startDate: '1936-01-01', name: 'Mobile Map-first E2E' },
  });
  const game = (await gameResponse.json()) as { id: string };

  await page.goto(`/game/${game.id}/map`);
  await page.getByRole('button', { name: 'Avancer le temps' }).click();
  await page.getByRole('button', { name: 'Lancer la simulation' }).click();
  await expect(page.getByText('Événement 1 sur 1')).toBeVisible();
  const next = page.getByRole('button', { name: 'Terminer' });
  await expect(next).toBeVisible();
  const nextBounds = await next.boundingBox();
  expect(nextBounds?.x).toBeGreaterThanOrEqual(0);
  expect((nextBounds?.x ?? 0) + (nextBounds?.width ?? 0)).toBeLessThanOrEqual(393);
  await next.click();
  await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
});

test('authors, publishes and launches a reusable scenario', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const presetResponse = await request.post('/api/v1/presets', {
    data: {
      title: 'Brumes continentales E2E',
      summary: 'Un scénario versionné vérifié dans le studio.',
      category: 'alternate_history',
      tags: ['uchronie', 'diplomatie'],
      startDate: '1889-04-01',
      worldContext: 'Les grandes puissances négocient dans un climat de défiance.',
      simulationRules: 'Préserver la cohérence historique et les conséquences.',
      recommendedDifficulty: 'hard',
      playableNationCodes: ['FRA', 'GER'],
      aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
      prompts: [],
      helpers: [],
    },
  });
  expect(presetResponse.ok()).toBe(true);
  const preset = (await presetResponse.json()) as { id: string };

  await page.goto(`/presets/${preset.id}`);
  await expect(page.getByRole('heading', { name: 'Studio de scénario' })).toBeVisible();
  await page.getByLabel('Titre').fill('Brumes continentales — édition E2E');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Enregistré', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Prévisualiser' }).click();
  await expect(page.getByRole('heading', { name: 'Prévisualiser' })).toBeVisible();
  await page.getByRole('button', { name: 'Publier une version' }).click();
  await expect(page.getByText('Publié', { exact: true })).toBeVisible();

  await page.goto('/');
  const card = page.getByRole('article').filter({ hasText: 'Brumes continentales — édition E2E' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Jouer' }).click();
  const launchDialog = page.getByRole('dialog', { name: 'Lancer ce scénario' });
  await launchDialog.getByRole('combobox', { name: 'Nation' }).selectOption('GER');
  await launchDialog.getByRole('button', { name: 'Jouer' }).click();
  await expect(page.getByRole('heading', { name: 'Vue stratégique' })).toBeVisible();

  const gameId = new URL(page.url()).pathname.split('/')[2];
  const game = await request.get(`/api/v1/games/${gameId}`);
  expect(await game.json()).toMatchObject({
    presetId: preset.id,
    currentDate: '1889-04-01',
    difficulty: 'hard',
    playerNationCode: 'GER',
  });
  await request.delete(`/api/v1/games/${gameId}`, { maxRetries: 2 });
});

test('uses a sequential, always-saveable studio on mobile', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  const presetResponse = await request.post('/api/v1/presets', {
    data: {
      title: 'Studio mobile E2E',
      summary: 'Validation du parcours séquentiel.',
      category: 'alternate_history',
      tags: ['mobile'],
      startDate: '1936-01-01',
      worldContext: 'Un monde de test.',
      simulationRules: 'Préserver la cohérence.',
      recommendedDifficulty: 'normal',
      playableNationCodes: ['FRA'],
      aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
      prompts: [],
      helpers: [],
    },
  });
  const preset = (await presetResponse.json()) as { id: string };

  await page.goto(`/presets/${preset.id}`);
  await expect(page.getByRole('heading', { name: 'Identité' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('heading', { name: 'Monde et règles' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
});

test('shares global activity while notifying only the initiating browser', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const settingsResponse = await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-activity-e2e',
      apiKey: '',
      clearApiKey: true,
    },
  });
  expect(settingsResponse.ok()).toBe(true);
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Activité globale E2E',
    },
  });
  const game = (await gameResponse.json()) as { id: string };
  const initiatorContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const initiator = await initiatorContext.newPage();
  const observer = await observerContext.newPage();
  try {
    await Promise.all([
      initiator.goto(`/game/${game.id}/advisor`),
      observer.goto(`/game/${game.id}/advisor`),
    ]);
    await Promise.all([
      expect(
        initiator.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' }),
      ).toBeVisible(),
      expect(
        observer.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' }),
      ).toBeVisible(),
    ]);

    await initiator
      .getByPlaceholder('Demander une analyse stratégique…')
      .fill('Évaluer la situation européenne.');
    await initiator.getByRole('button', { name: 'Demander conseil' }).click();
    await expect(initiator.getByText('Appel IA terminé', { exact: true })).toBeVisible();
    await expect(observer.getByText('Appel IA terminé')).toHaveCount(0);

    await observer.getByRole('button', { name: 'Ouvrir le suivi de l’activité IA' }).click();
    await expect(observer.getByRole('heading', { name: 'Activité IA' })).toBeVisible();
    await expect(observer.getByText('Activité globale E2E')).toBeVisible();
    await expect(observer.getByText('Conseiller', { exact: true }).first()).toBeVisible();
  } finally {
    await initiatorContext.close();
    await observerContext.close();
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('keeps time advance compact, recoverable and single-flight', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-time-command',
      apiKey: '',
      clearApiKey: true,
    },
  });
  const gameResponse = await request.post('/api/v1/games', {
    data: { nationCode: 'FRA', startDate: '1936-01-01', name: 'Commande temps E2E' },
  });
  const game = (await gameResponse.json()) as { id: string };
  let turnRequests = 0;
  await page.route(`**/api/v1/games/${game.id}/turns`, async (route) => {
    turnRequests += 1;
    if (turnRequests === 1) {
      await route.fulfill({
        status: 504,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Timeout',
          status: 504,
          code: 'LLM_TIMEOUT',
          detail: 'Provider timeout',
          requestId: 'time-command-e2e',
        }),
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    await route.continue();
  });

  try {
    await page.goto(`/game/${game.id}/map`);
    await page.getByRole('button', { name: 'Avancer le temps' }).click();
    const command = page.getByTestId('time-advance-command');
    await expect(command).toBeVisible();
    await expect(command).not.toContainText('Historique des simulations');
    await command.getByRole('button', { name: 'Lancer la simulation' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(command.getByText(/trop de temps/)).toBeVisible();
    expect(turnRequests).toBe(1);

    await command.getByRole('button', { name: 'Réessayer' }).click();
    await command.getByRole('button', { name: 'Réduire la commande' }).click();
    await expect(command).toBeHidden();
    await expect(page.getByRole('button', { name: 'Simulation en cours…' })).toBeVisible();
    await expect(page.getByText('Événement 1 sur 1')).toBeVisible();
    expect(turnRequests).toBe(2);
    await page.getByRole('button', { name: 'Terminer' }).click();

    await page.goto(`/game/${game.id}/history`);
    const historyPanel = page.getByTestId('simulation-history');
    await expect(historyPanel).toBeVisible();
    await historyPanel.getByRole('button', { name: 'Réutiliser' }).first().click();
    await expect(page.getByTestId('time-advance-command')).toBeVisible();
    await expect(page.getByLabel('Quantité')).toHaveValue('1');
    await expect(page.getByLabel('Unité')).toHaveValue('month');
  } finally {
    await page.unroute(`**/api/v1/games/${game.id}/turns`);
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('keeps every city, unit and character marker inside the world map', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Audit cartographique E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  const citiesResponse = await request.get('/api/v1/map/cities');
  const unitsResponse = await request.get(`/api/v1/games/${game.id}/units`);
  const charactersResponse = await request.get(`/api/v1/games/${game.id}/characters`);
  expect(citiesResponse.ok()).toBe(true);
  expect(unitsResponse.ok()).toBe(true);
  expect(charactersResponse.ok()).toBe(true);
  const cities = (await citiesResponse.json()) as Array<{
    id: string;
    region_id: string;
    coords: [number, number];
  }>;
  const units = (await unitsResponse.json()) as Array<{
    name: string;
    regionId: string;
    centroid: [number, number];
  }>;
  const characters = (await charactersResponse.json()) as Array<{
    name: string;
    role: string;
    iconKey: string;
    regionId: string | null;
    coordinates: [number, number] | null;
    status: string;
    portraitUrl?: string;
    portraitStatus?: string;
  }>;
  const visibleCharacters = characters.filter(
    (character) => character.status !== 'dead' && character.regionId && character.coordinates,
  );
  expect(
    characters.every((character) =>
      ['leader', 'commander', 'diplomat', 'operative', 'scientist', 'civilian'].includes(
        character.iconKey,
      ),
    ),
  ).toBe(true);
  expect(
    characters.every(
      (character) => !('portraitUrl' in character) && !('portraitStatus' in character),
    ),
  ).toBe(true);
  const anchors = [
    ...cities.map((city) => ({
      name: city.id,
      regionId: city.region_id,
      coords: city.coords,
    })),
    ...units.map((unit) => ({
      name: unit.name,
      regionId: unit.regionId,
      coords: unit.centroid,
    })),
    ...visibleCharacters.map((character) => ({
      name: character.name,
      regionId: character.regionId!,
      coords: character.coordinates!,
    })),
  ];

  await page.setViewportSize({ width: 1500, height: 700 });
  await page.goto('/1936.svg');
  const regionMismatches = await page.evaluate((points) => {
    return points.flatMap((point) => {
      const hit = document.elementFromPoint(point.coords[0], point.coords[1])?.id;
      return hit === point.regionId ? [] : [{ ...point, hit }];
    });
  }, anchors);
  expect(regionMismatches).toEqual([]);

  await page.goto(`/game/${game.id}/map`);
  await expect(page.getByRole('region', { name: 'Théâtre stratégique' })).toBeVisible();
  await expect(page.locator('.leaflet-control-zoom')).toHaveCount(0);
  const initialCharacterMarkers = await page.evaluate(() => {
    const direct = document.querySelectorAll('[data-icon]').length;
    const grouped = Array.from(document.querySelectorAll('[data-cluster-count]')).reduce(
      (total, marker) => total + Number(marker.getAttribute('data-cluster-count') ?? 0),
      0,
    );
    return { direct, grouped };
  });
  expect(initialCharacterMarkers.direct + initialCharacterMarkers.grouped).toBe(
    visibleCharacters.length,
  );
  await expect(page.locator('[data-icon] svg')).toHaveCount(initialCharacterMarkers.direct);
  await expect(page.locator('[data-icon] img')).toHaveCount(0);
  const zoomOut = page.getByRole('button', { name: /Dézoomer|Zoom out/ });
  for (let step = 0; step < 10 && (await zoomOut.isEnabled()); step += 1) {
    await zoomOut.click();
  }
  const zoomedMarkerSummary = await page.evaluate(() => {
    const direct = document.querySelectorAll('[data-icon]').length;
    const groups = Array.from(document.querySelectorAll('[data-cluster-count]'));
    const grouped = groups.reduce(
      (total, marker) => total + Number(marker.getAttribute('data-cluster-count') ?? 0),
      0,
    );
    return { represented: direct + grouped, rendered: direct + groups.length };
  });
  expect(zoomedMarkerSummary.represented).toBe(visibleCharacters.length);
  await expect(page.locator('.leaflet-interactive')).toHaveCount(
    cities.length + zoomedMarkerSummary.rendered,
  );
  await page
    .getByRole('button', { name: /Inspecter République française|Inspect French Republic/ })
    .press('Enter');
  await expect(page.getByText('INTEL · GEO')).toBeVisible();

  const floatingWindowStack = await page.evaluate(() => {
    const intel = Array.from(document.querySelectorAll('aside')).find((element) =>
      element.textContent?.includes('INTEL · GEO'),
    );
    const workspace = intel?.parentElement;
    const mapPanel = workspace?.querySelector('section[aria-label="Théâtre stratégique"]');
    const intelBounds = intel?.getBoundingClientRect();
    const hit =
      intel && intelBounds
        ? document.elementFromPoint(
            intelBounds.left + intelBounds.width / 2,
            intelBounds.top + intelBounds.height / 2,
          )
        : null;

    return {
      workspaceIsolation: workspace ? getComputedStyle(workspace).isolation : null,
      mapPanelZIndex: mapPanel ? getComputedStyle(mapPanel).zIndex : null,
      intelZIndex: intel ? getComputedStyle(intel).zIndex : null,
      intelOwnsTopLayer: Boolean(intel && hit && intel.contains(hit)),
    };
  });
  expect(floatingWindowStack).toEqual({
    workspaceIsolation: 'isolate',
    mapPanelZIndex: '0',
    intelZIndex: '20',
    intelOwnsTopLayer: true,
  });

  const placement = await page.evaluate(() => {
    const image = document.querySelector('.leaflet-image-layer');
    if (!image) {
      return { imageFound: false, outsideMarkerCenters: [-1] };
    }

    const imageBounds = image.getBoundingClientRect();
    const outsideMarkerCenters = Array.from(
      document.querySelectorAll('.leaflet-interactive'),
    ).flatMap((marker, index) => {
      const markerBounds = marker.getBoundingClientRect();
      const centerX = markerBounds.x + markerBounds.width / 2;
      const centerY = markerBounds.y + markerBounds.height / 2;
      const isOutside =
        centerX < imageBounds.left ||
        centerX > imageBounds.right ||
        centerY < imageBounds.top ||
        centerY > imageBounds.bottom;
      return isOutside ? [index] : [];
    });

    return { imageFound: true, outsideMarkerCenters };
  });

  expect(placement).toEqual({ imageFound: true, outsideMarkerCenters: [] });
  await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
});

test('declutters coincident Paris markers by layer and offers an accessible group', async ({
  page,
  request,
}, testInfo) => {
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '2026-01-08',
      name: 'Audit chevauchement Paris E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  try {
    const strategicResponse = await request.get(`/api/v1/games/${game.id}/strategic-state`);
    expect(strategicResponse.ok()).toBe(true);
    const strategic = (await strategicResponse.json()) as {
      units: Array<{ name: string; centroid: [number, number] }>;
      characters: Array<{
        name: string;
        role: string;
        coordinates: [number, number] | null;
      }>;
    };
    const unit = strategic.units.find((candidate) => candidate.name === 'Brigade interarmes');
    const character = strategic.characters.find(
      (candidate) => candidate.name === 'Emmanuel Macron',
    );
    expect(unit).toBeDefined();
    expect(character).toBeDefined();
    expect(character?.coordinates).toEqual(unit?.centroid);

    await page.setViewportSize(
      testInfo.project.name === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    );
    await page.goto(`/game/${game.id}/map`);

    await expect(page.locator('[data-icon]')).toHaveCount(1);
    await expect(page.locator('[data-domain]')).toHaveCount(0);

    const layerToggle = page.getByRole('button', {
      name: /Ouvrir les calques stratégiques|Open strategic layers/,
    });
    await layerToggle.click();
    await page.getByRole('radio', { name: /Renseignement|Intelligence/ }).click();

    const cluster = page.locator('[data-marker-cluster][data-cluster-count="2"]');
    await expect(cluster).toBeVisible();
    await cluster.click();

    if (testInfo.project.name === 'mobile') {
      const picker = page.getByTestId('strategic-marker-picker');
      await expect(picker).toBeVisible();
      await expect(picker.locator('[data-marker-choice-kind="character"]')).toContainText(
        'Emmanuel Macron',
      );
      await expect(picker.locator('[data-marker-choice-kind="unit"]')).toContainText(
        'Brigade interarmes',
      );
      await picker.getByRole('button', { name: /Fermer|Close/ }).click();
    } else {
      await expect(page.locator('[data-icon]')).toHaveCount(1);
      await expect(page.locator('[data-domain]')).toHaveCount(1);
      const markerDistance = await page.evaluate(() => {
        const characterMarker = document.querySelector('[data-icon]')?.getBoundingClientRect();
        const unitMarker = document.querySelector('[data-domain]')?.getBoundingClientRect();
        if (!characterMarker || !unitMarker) return 0;
        return Math.hypot(
          characterMarker.x + characterMarker.width / 2 - (unitMarker.x + unitMarker.width / 2),
          characterMarker.y + characterMarker.height / 2 - (unitMarker.y + unitMarker.height / 2),
        );
      });
      expect(markerDistance).toBeGreaterThanOrEqual(48);
    }

    await layerToggle.click();
    await page.getByRole('radio', { name: /Forces/ }).click();
    await expect(page.locator('[data-domain]')).toHaveCount(1);
    await expect(page.locator('[data-icon]')).toHaveCount(0);
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('keeps zoom and layer controls in the bottom-right, grouped and clear of map intel', async ({
  page,
  request,
}, testInfo) => {
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Audit commandes carte E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };

  try {
    await page.setViewportSize(
      testInfo.project.name === 'mobile'
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
    );
    await page.goto(`/game/${game.id}/map`);

    const controls = page.getByRole('group', {
      name: /Commandes de la carte|Map controls/,
    });
    const claims = controls.getByRole('button', {
      name: /Revendications|Claims/,
    });
    await expect(controls).toBeVisible();
    await expect(claims).toBeVisible();
    await expect(claims).toHaveAttribute('aria-pressed', 'false');

    const layerToggle = page.getByRole('button', {
      name: /Ouvrir les calques stratégiques|Open strategic layers/,
    });
    await expect(layerToggle).toBeVisible();

    const cornerPlacement = await page.evaluate(() => {
      const map = document.querySelector('section[aria-label="Théâtre stratégique"]');
      const controlGroup = document.querySelector('[data-testid="map-controls"]');
      const layerButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Ouvrir les calques stratégiques"], button[aria-label="Open strategic layers"]',
      );
      if (!map || !controlGroup || !layerButton) return null;

      const mapBounds = map.getBoundingClientRect();
      const controlBounds = controlGroup.getBoundingClientRect();
      const layerBounds = layerButton.getBoundingClientRect();
      return {
        controlsRightGap: Math.round(mapBounds.right - controlBounds.right),
        controlsBottomGap: Math.round(mapBounds.bottom - controlBounds.bottom),
        layerRightGap: Math.round(mapBounds.right - layerBounds.right),
        layerAboveControls: layerBounds.bottom < controlBounds.top,
        verticalGap: Math.round(controlBounds.top - layerBounds.bottom),
      };
    });
    expect(cornerPlacement).toEqual({
      controlsRightGap: testInfo.project.name === 'mobile' ? 10 : 18,
      controlsBottomGap: testInfo.project.name === 'mobile' ? 74 : 16,
      layerRightGap: testInfo.project.name === 'mobile' ? 10 : 18,
      layerAboveControls: true,
      verticalGap: expect.any(Number),
    });
    expect(cornerPlacement?.verticalGap).toBeGreaterThanOrEqual(8);
    expect(cornerPlacement?.verticalGap).toBeLessThanOrEqual(9);

    const zoomIn = controls.getByRole('button', { name: /Zoomer|Zoom in/ });
    for (let step = 0; step < 10 && (await zoomIn.isEnabled()); step += 1) {
      await zoomIn.click();
    }
    await expect(controls).toHaveAttribute('data-zoom', '4');

    await page.locator('[data-region-id="Ile_de_France"]').dispatchEvent('click');
    const intel = page.locator('aside').filter({ hasText: 'INTEL' });
    await expect(intel).toBeVisible();
    await expect(intel.getByRole('heading', { name: 'Ile de France' })).toBeVisible();
    for (const label of [
      'Région',
      'Propriétaire légal',
      'Contrôleur militaire',
      'Population',
      'Terrain',
      'Infrastructure',
      'Capacité industrielle',
      'Ravitaillement',
      'Santé',
      'Habitabilité',
      'Contamination',
      'Radiation',
    ]) {
      await expect(intel.getByText(label, { exact: true })).toBeVisible();
    }

    const placement = await page.evaluate(() => {
      const controlGroup = document.querySelector('[data-testid="map-controls"]');
      const claimsButton = controlGroup?.querySelector('button[aria-pressed]');
      const layerButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Ouvrir les calques stratégiques"], button[aria-label="Open strategic layers"]',
      );
      const intelPanel = Array.from(document.querySelectorAll('aside')).find((element) =>
        element.textContent?.includes('INTEL'),
      );
      if (!controlGroup || !claimsButton || !layerButton || !intelPanel) {
        return {
          grouped: false,
          insideViewport: false,
          overlapsIntel: true,
          overlapsLayer: true,
        };
      }

      const buttonBounds = claimsButton.getBoundingClientRect();
      const layerBounds = layerButton.getBoundingClientRect();
      const intelBounds = intelPanel.getBoundingClientRect();
      const overlapsIntel =
        buttonBounds.left < intelBounds.right &&
        buttonBounds.right > intelBounds.left &&
        buttonBounds.top < intelBounds.bottom &&
        buttonBounds.bottom > intelBounds.top;
      const overlapsLayer =
        layerBounds.left < intelBounds.right &&
        layerBounds.right > intelBounds.left &&
        layerBounds.top < intelBounds.bottom &&
        layerBounds.bottom > intelBounds.top;

      return {
        grouped: controlGroup.contains(claimsButton),
        insideViewport:
          buttonBounds.left >= 0 &&
          buttonBounds.top >= 0 &&
          buttonBounds.right <= window.innerWidth &&
          buttonBounds.bottom <= window.innerHeight,
        overlapsIntel,
        overlapsLayer,
      };
    });
    expect(placement).toEqual({
      grouped: true,
      insideViewport: true,
      overlapsIntel: false,
      overlapsLayer: false,
    });

    await claims.click();
    await expect(claims).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('keeps every campaign window contained, readable and adapted to its content', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const gameResponse = await request.post('/api/v1/games', {
    data: {
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Audit fenêtres E2E',
    },
  });
  expect(gameResponse.ok()).toBe(true);
  const game = (await gameResponse.json()) as { id: string };
  const mobile = testInfo.project.name === 'mobile';
  await page.setViewportSize(mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 });

  const routes = [
    ['dashboard', 'workspace'],
    ['countries/FRA', 'workspace'],
    ['actions', 'dock'],
    ['diplomacy', 'dock'],
    ['advisor', 'dock'],
    ['events', 'dock'],
    ['history', 'workspace'],
    ['world', 'workspace'],
    ['memory', 'workspace'],
    ['settings', 'workspace'],
  ] as const;

  try {
    for (const [route, surface] of routes) {
      await page.goto(`/game/${game.id}/${route}`);
      const drawer = page.locator(`aside[data-surface="${surface}"]`);
      await expect(drawer).toBeVisible({ timeout: 15_000 });

      const metrics = await drawer.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          height: bounds.height,
          horizontalOverflow: element.scrollWidth > element.clientWidth + 2,
          left: bounds.left,
          overflowing: Array.from(element.querySelectorAll<HTMLElement>('*'))
            .filter((child) => child.scrollWidth > child.clientWidth + 2)
            .slice(0, 5)
            .map((child) => ({
              className: child.className,
              clientWidth: child.clientWidth,
              scrollWidth: child.scrollWidth,
              tagName: child.tagName,
            })),
          right: bounds.right,
          top: bounds.top,
          width: bounds.width,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
      expect(metrics.horizontalOverflow, `${route}: ${JSON.stringify(metrics.overflowing)}`).toBe(
        false,
      );
      expect(metrics.top).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
      expect(metrics.height).toBeLessThan(metrics.viewportHeight);
      expect(metrics.width / metrics.viewportWidth).toBeLessThanOrEqual(mobile ? 0.96 : 0.99);
      expect(metrics.height / metrics.viewportHeight).toBeLessThanOrEqual(
        mobile && route !== 'dashboard' ? 0.72 : 0.98,
      );

      if (route === 'actions') {
        if (!mobile) expect(metrics.height).toBeLessThan(560);
        await expect(drawer.getByLabel('Type')).toHaveValue('general');
        await expect(drawer.getByRole('button', { name: 'Soumettre à validation' })).toBeVisible();
        const buttonLayout = await drawer.getByTestId('action-buttons').evaluate((element) => {
          const buttons = Array.from(element.querySelectorAll('button')).map((button) => {
            const bounds = button.getBoundingClientRect();
            return {
              bottom: bounds.bottom,
              contentFits: button.scrollWidth <= button.clientWidth + 1,
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
            };
          });
          const overlaps = buttons.some((button, index) =>
            buttons
              .slice(index + 1)
              .some(
                (other) =>
                  button.left < other.right &&
                  button.right > other.left &&
                  button.top < other.bottom &&
                  button.bottom > other.top,
              ),
          );
          return { buttons, overlaps };
        });
        expect(buttonLayout.buttons).toHaveLength(4);
        expect(buttonLayout.buttons.every((button) => button.contentFits)).toBe(true);
        expect(buttonLayout.overlaps).toBe(false);
      }
      if (!mobile && route === 'diplomacy') {
        expect(metrics.height).toBeLessThan(430);
        await expect(drawer.getByText('Aucune conversation diplomatique active.')).toBeVisible();
      }
      if (mobile && route === 'diplomacy') {
        expect(metrics.height / metrics.viewportHeight).toBeLessThan(0.5);
        await drawer.getByRole('button', { name: 'Nouvelle conversation' }).click();
        const diplomacyDialog = page.getByRole('dialog', { name: 'Nouvelle conversation' });
        const participantSearch = diplomacyDialog.getByRole('searchbox', {
          name: 'Rechercher des participants',
        });
        await expect(participantSearch).toBeVisible();
        await participantSearch.fill('BEL');
        await expect(diplomacyDialog.getByRole('checkbox', { name: 'Belgique BEL' })).toBeVisible();
        await expect(diplomacyDialog.getByRole('checkbox')).toHaveCount(1);
        await diplomacyDialog.getByRole('button', { name: 'Fermer' }).click();
      }
      if (!mobile && route === 'advisor') {
        expect(metrics.height).toBeLessThan(520);
        await expect(
          drawer.getByRole('button', {
            name: 'Quelles devraient être mes trois priorités immédiates ?',
          }),
        ).toBeVisible();
      }
      if (mobile && route === 'advisor') {
        const promptsFit = await drawer
          .locator('[class*="_promptChips_"]')
          .evaluate((element) =>
            Array.from(element.querySelectorAll('button')).every(
              (button) => button.scrollWidth <= button.clientWidth + 1,
            ),
          );
        expect(promptsFit).toBe(true);
      }
      if (route === 'dashboard') {
        expect(metrics.height / metrics.viewportHeight).toBeGreaterThan(0.8);
      }
      if (!mobile && route === 'countries/FRA') {
        await expect(drawer.getByRole('button', { name: 'Aperçu' })).toBeVisible();
        await drawer.getByRole('button', { name: 'Indicateurs' }).click();
        await expect(
          drawer.getByRole('heading', { name: 'Population, économie et société' }),
        ).toBeVisible();
      }
      if (['history', 'world', 'memory', 'settings'].includes(route)) {
        await expect(drawer.getByRole('tab', { name: 'Historique' })).toBeVisible();
        await expect(drawer.getByRole('tab', { name: 'Monde' })).toBeVisible();
        await expect(drawer.getByRole('tab', { name: 'Mémoire' })).toBeVisible();
        await expect(drawer.getByRole('tab', { name: 'Réglages' })).toBeVisible();
        if (mobile) {
          const tabsFit = await drawer
            .getByRole('tablist', { name: 'Commandement' })
            .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
          expect(tabsFit).toBe(true);
        }
      }

      if (mobile) {
        const compactNation = page.locator('header span[class*="_commandNationCode_"]');
        await expect(compactNation).toHaveText('FRA');
        await expect(compactNation).toBeVisible();
      }

      const closeBounds = await drawer.locator('button[class*="_surfaceClose_"]').boundingBox();
      expect(closeBounds).not.toBeNull();
      expect((closeBounds?.x ?? 0) + (closeBounds?.width ?? 0)).toBeGreaterThan(metrics.right - 64);
      const headerActions = drawer.locator('div[class*="_surfaceHeaderActions_"]');
      await expect(headerActions).toHaveCount(1);
      const actionLayout = await headerActions.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const children = Array.from(element.children)
          .map((child) => child.getBoundingClientRect())
          .filter((child) => child.width > 0 && child.height > 0)
          .map((child) => ({ left: child.left, right: child.right }));
        return { left: bounds.left, right: bounds.right, children };
      });
      expect(actionLayout.left).toBeGreaterThanOrEqual(metrics.left);
      expect(actionLayout.right).toBeLessThanOrEqual(metrics.right);
      for (let index = 1; index < actionLayout.children.length; index += 1) {
        expect(
          actionLayout.children[index]!.left - actionLayout.children[index - 1]!.right,
        ).toBeGreaterThanOrEqual(12);
      }
    }

    await page.goto(`/game/${game.id}/timeline`);
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}/history$`));
    await expect(page.getByTestId('simulation-history')).toBeVisible();
    await page.getByRole('button', { name: 'Avancer le temps' }).click();
    const timeCommand = page.getByTestId('time-advance-command');
    await expect(timeCommand).toBeVisible();
    await expect(timeCommand.getByText('Historique des simulations')).toHaveCount(0);
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('keeps the strategic view full-screen across every target viewport', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const gameResponse = await request.post('/api/v1/games', {
    data: { nationCode: 'FRA', startDate: '1936-01-01', name: 'Responsive QG E2E' },
  });
  const game = (await gameResponse.json()) as { id: string };
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 393, height: 852 },
  ];

  try {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/game/${game.id}/dashboard`);
      const dashboardWorkspace = page.locator('aside[data-surface="workspace"]');
      await expect(dashboardWorkspace).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('section[class*="_mapStage_"]');
        const surface = document.querySelector<HTMLElement>('aside[data-surface="workspace"]');
        if (!stage || !surface) return null;
        const stageBounds = stage.getBoundingClientRect();
        const surfaceBounds = surface.getBoundingClientRect();
        return {
          bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          surfaceCoverage: surfaceBounds.height / stageBounds.height,
          surfaceBottom: surfaceBounds.bottom,
          surfaceRight: surfaceBounds.right,
          surfaceTop: surfaceBounds.top,
          stageTop: stageBounds.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });
      expect(layout).not.toBeNull();
      expect(layout?.bodyOverflow).toBe(false);
      expect(layout?.surfaceCoverage).toBeGreaterThanOrEqual(0.85);
      expect(layout?.surfaceTop).toBeGreaterThanOrEqual(layout?.stageTop ?? 0);
      expect(layout?.surfaceRight).toBeLessThanOrEqual(layout?.viewportWidth ?? 0);
      expect(layout?.surfaceBottom).toBeLessThanOrEqual(layout?.viewportHeight ?? 0);

      const summaryButton = page.getByRole('button', { name: 'Synthèse' });
      const advanceButton = page.getByRole('button', { name: 'Avancer le temps' });
      const activityButton = page.getByRole('button', {
        name: 'Ouvrir le suivi de l’activité IA',
      });
      await expect(summaryButton).toBeVisible();
      const summaryBounds = await summaryButton.boundingBox();
      const advanceBounds = await advanceButton.boundingBox();
      const activityBounds = await activityButton.boundingBox();
      expect(
        (advanceBounds?.x ?? 0) - ((summaryBounds?.x ?? 0) + (summaryBounds?.width ?? 0)),
      ).toBeGreaterThanOrEqual(6);
      expect(
        (activityBounds?.x ?? 0) - ((advanceBounds?.x ?? 0) + (advanceBounds?.width ?? 0)),
      ).toBeGreaterThanOrEqual(6);

      await page.getByRole('button', { name: 'Commandement' }).last().click();
      await expect(page).toHaveURL(new RegExp(`/game/${game.id}/history$`));
      const workspace = page.locator('aside[data-surface="workspace"]');
      await expect(workspace).toBeVisible();
      await expect(workspace.getByRole('tab', { name: 'Historique' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await workspace.getByRole('button', { name: 'Fermer' }).click();

      await page.getByRole('button', { name: 'Avancer le temps' }).click();
      const command = page.getByTestId('time-advance-command');
      await expect(command).toBeVisible();
      const commandBounds = await command.boundingBox();
      expect(commandBounds?.x).toBeGreaterThanOrEqual(0);
      expect((commandBounds?.x ?? 0) + (commandBounds?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width,
      );
      expect((commandBounds?.y ?? 0) + (commandBounds?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height,
      );
    }
  } finally {
    await request.delete(`/api/v1/games/${game.id}`, { maxRetries: 2 });
  }
});

test('runs the strategic workflow and persists preferences', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');

  const settingsResponse = await request.patch('/api/v1/llm/settings', {
    data: {
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic-e2e',
      apiKey: '',
      clearApiKey: true,
    },
  });
  expect(settingsResponse.ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: 'Nouvelle campagne' }).click();
  await page.getByRole('combobox', { name: 'Nation' }).fill('fra');
  await page.getByRole('option', { name: /FRA/ }).click();
  await page.getByLabel(/Nom de la campagne/).fill('Campagne E2E V3');
  await page.getByRole('button', { name: 'Lancer la campagne' }).click();
  await expect(page).toHaveURL(/\/game\/[0-9a-f-]+\/dashboard$/);

  const gameId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`/game/${gameId}/actions`);
  await page.getByPlaceholder(/Renforcer les défenses/).fill('Sécuriser la frontière orientale.');
  await page.getByRole('button', { name: 'Soumettre à validation' }).click();
  await expect(page.getByText('Sécuriser la frontière orientale.')).toBeVisible();

  await page.goto(`/game/${gameId}/diplomacy`);
  await page.getByRole('button', { name: 'Nouvelle conversation' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: /ENG$/ }).check();
  await page.getByRole('button', { name: 'Ouvrir le canal' }).click();
  await page.getByPlaceholder(/Rédiger un message/).fill('Proposons une coopération défensive.');
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Proposons une coopération défensive.')).toBeVisible();

  await page.goto(`/game/${gameId}/map`);
  await page.getByRole('button', { name: 'Avancer le temps' }).click();
  await page.getByRole('button', { name: 'Lancer la simulation' }).click();
  await expect(page).toHaveURL(new RegExp(`/game/${gameId}/map$`));
  await expect(page.getByText('Événement 1 sur 1')).toBeVisible();
  await expect(page.getByText('INTEL · GEO')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Situation stratégique actualisée' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terminer' })).toBeVisible();
  await expect(page.locator('path[class*="mapEventRegion"]').first()).toBeVisible();
  await expect(page.getByText('Tour 2')).toBeVisible();
  await page.getByRole('button', { name: 'Terminer' }).click();
  await expect(page.getByText('Événement 1 sur 1')).toHaveCount(0);
  await expect(page.getByText('INTEL · GEO')).toHaveCount(0);
  await page.goto(`/game/${gameId}/events`);
  await expect(
    page
      .getByLabel('Journal stratégique')
      .getByRole('heading', { name: 'Situation stratégique actualisée', exact: true }),
  ).toBeVisible();
  const replayButton = page.getByTestId('timeline-replay-button').first();
  const strategicEntry = replayButton.locator('xpath=ancestor::article');
  const strategicCopy = strategicEntry.locator('div').first();
  await expect(replayButton).toBeVisible();
  await expect(replayButton).toHaveAccessibleName(/Rejouer la séquence/);
  const replayBounds = await replayButton.boundingBox();
  const copyBounds = await strategicCopy.boundingBox();
  expect(replayBounds?.width).toBeLessThanOrEqual(120);
  expect(copyBounds?.width).toBeGreaterThan(replayBounds?.width ?? 0);
  await page.getByRole('button', { name: 'Voir sur la carte' }).click();
  await expect(page).toHaveURL(new RegExp(`/game/${gameId}/map$`));
  await expect(page.getByText('Événement 1 sur 1')).toBeVisible();
  await expect(page.getByText('INTEL · GEO')).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminer' }).click();

  await page.goto(`/game/${gameId}/events`);
  await page.getByRole('button', { name: 'Apparence et affichage' }).click();
  const appearance = page.getByRole('dialog', { name: 'Apparence et affichage' });
  await appearance.getByRole('button', { name: 'Sombre' }).click();
  await appearance.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'World journal' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'World journal' })).toBeVisible();

  await page.goto('/');
  const campaign = page.getByRole('article').filter({ hasText: 'Campagne E2E V3' });
  await campaign.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Campagne E2E V3')).toHaveCount(0);
});

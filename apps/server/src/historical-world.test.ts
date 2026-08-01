import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog.js';
import { config } from './config.js';
import { HistoricalWorldResolver } from './historical-world.js';

describe('HistoricalWorldResolver', () => {
  const catalog = new Catalog(config.dataDirectory);
  const resolver = new HistoricalWorldResolver(catalog, config.dataDirectory);

  it('selects both French offices at the exact campaign date', () => {
    const world1936 = resolver.resolve('1936-01-24', 'fr');
    const france1936 = world1936.polities.find((polity) => polity.code === 'FRA');
    expect(france1936?.officeHolders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'head_of_state', name: 'Albert Lebrun' }),
        expect.objectContaining({ role: 'head_of_government', name: 'Albert Sarraut' }),
      ]),
    );

    const world2000 = resolver.resolve('2000-01-01', 'fr');
    const france2000 = world2000.polities.find((polity) => polity.code === 'FRA');
    expect(france2000).toMatchObject({
      name: 'République française',
      capital: 'Paris',
      governmentType: 'semi_presidential_republic',
      baseline: { population: 60_912_500, baselineDate: '2000-01-01' },
    });
    expect(france2000?.officeHolders).toEqual([
      expect.objectContaining({ role: 'head_of_state', name: 'Jacques Chirac', primary: true }),
      expect.objectContaining({
        role: 'head_of_government',
        name: 'Lionel Jospin',
        primary: false,
      }),
    ]);
    expect(france2000?.officeHolders.some((holder) => holder.name === 'Albert Lebrun')).toBe(false);

    const world2025 = resolver.resolve('2025-01-01', 'fr');
    const france2025 = world2025.polities.find((polity) => polity.code === 'FRA');
    expect(france2025?.officeHolders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'head_of_state', name: 'Emmanuel Macron' }),
      ]),
    );
    expect(france2025?.officeHolders.some((holder) => holder.name === 'Albert Lebrun')).toBe(false);
  });

  it('changes active polities and strategic ownership across dated transitions', () => {
    const world1989 = resolver.resolve('1989-01-01');
    expect(world1989.polities.some((polity) => polity.code === 'SOV')).toBe(true);
    expect(world1989.polities.some((polity) => polity.code === 'RUS')).toBe(false);
    expect(world1989.regionOwners.get('Brandenburg')).toBe('GDR');

    const world2000 = resolver.resolve('2000-01-01');
    expect(world2000.polities.some((polity) => polity.code === 'SOV')).toBe(false);
    expect(world2000.polities.some((polity) => polity.code === 'RUS')).toBe(true);
    expect(world2000.polities.some((polity) => polity.code === 'SVK')).toBe(true);
    expect(world2000.regionOwners.get('Moscow')).toBe('RUS');
    expect(world2000.regionOwners.get('Kyiv')).toBe('UKR');
    expect(world2000.regionOwners.get('Western_Slovakia')).toBe('SVK');
    expect(world2000.regionOwners.get('Brandenburg')).toBe('GER');
    expect(world2000.regionOwners.get('Beiping')).toBe('PRC');
    expect(world2000.regionOwners.get('Taiwan')).toBe('CHI');
  });

  it('distinguishes Gibraltar from the United Kingdom proper at the campaign date', () => {
    expect(resolver.resolve('2000-01-01').regionStatuses.get('Gibraltar')).toEqual({
      status: 'dependent_territory',
      administeringNationCode: 'ENG',
      claimNationCodes: ['SPR'],
    });
    expect(resolver.resolve('2020-01-01').regionStatuses.get('Gibraltar')).toEqual({
      status: 'overseas_territory',
      administeringNationCode: 'ENG',
      claimNationCodes: ['SPR'],
    });
    expect(resolver.transitionsBetween('2000-01-01', '2020-01-01')).toContainEqual(
      expect.objectContaining({
        id: 'territory-status:2002-02-26:Gibraltar:overseas_territory',
        kind: 'territory',
        changes: expect.objectContaining({ territorialStatus: 'overseas_territory' }),
      }),
    );
  });

  it('rejects unsupported historical dates with explicit coverage', () => {
    expect(() => resolver.resolve('1869-12-31')).toThrow(/1870-01-01/);
    expect(() => resolver.resolve('2026-08-01')).toThrow(/2026-07-31/);
  });
});

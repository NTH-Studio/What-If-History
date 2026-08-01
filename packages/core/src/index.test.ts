import { describe, expect, it } from 'vitest';
import type { NationState, RegionState } from '@what-if-history/contracts';
import {
  addTime,
  applyEventChanges,
  applyNaturalEvolution,
  applyRegionalImpact,
  createStartingUnits,
  distributeRegionalPopulation,
  findStrategicRoute,
} from './index.js';

describe('addTime', () => {
  it('advances a date deterministically in UTC', () => {
    expect(addTime('1936-01-01', { amount: 1, unit: 'month' })).toBe('1936-02-01');
    expect(addTime('1936-01-01', { amount: 2, unit: 'week' })).toBe('1936-01-15');
  });

  it('refuses to advance beyond the simulation limit', () => {
    expect(() => addTime('9999-12-01', { amount: 1, unit: 'year' })).toThrow(
      'SIMULATION_END_REACHED',
    );
  });
});

describe('applyEventChanges', () => {
  it('clamps percentages and deduplicates occupied regions', () => {
    const state: NationState = {
      nationCode: 'FRA',
      stability: 95,
      warSupport: 10,
      manpower: 1_000,
      politicalPower: 100,
      treasury: 500,
      atWar: false,
      occupiedRegions: ['Paris'],
      population: 42_000_000,
      gdp: 70_000,
      happiness: 55,
      literacy: 80,
      unemployment: 12,
      inflation: 3,
      industrialCapacity: 68,
      health: 65,
      foodSecurity: 72,
      populationGrowthRate: 0.5,
      gdpGrowthRate: 2,
      capitalFeatureId: null,
      capitalStatus: 'established',
    };

    const result = applyEventChanges(new Map([['FRA', state]]), [
      {
        title: 'Test',
        description: 'Test event',
        event_type: 'political',
        severity: 'minor',
        affected_nations: ['FRA'],
        map_cue: { locations: [], camera: 'auto' },
        state_changes: {
          FRA: {
            stability: 20,
            war_support: -30,
            treasury: 50,
            occupied_regions: ['Paris', 'Lyon'],
          },
        },
      },
    ]);

    expect(result.get('FRA')).toMatchObject({
      stability: 100,
      warSupport: 0,
      treasury: 550,
      occupiedRegions: ['Paris', 'Lyon'],
    });
  });
});

describe('applyNaturalEvolution', () => {
  it('prorates population and GDP growth to the length of the turn', () => {
    const state: NationState = {
      nationCode: 'FRA',
      stability: 70,
      warSupport: 20,
      manpower: 1_000,
      politicalPower: 100,
      treasury: 500,
      atWar: false,
      occupiedRegions: [],
      population: 1_000_000,
      gdp: 10_000,
      happiness: 60,
      literacy: 80,
      unemployment: 10,
      inflation: 2,
      industrialCapacity: 70,
      health: 65,
      foodSecurity: 75,
      populationGrowthRate: 1,
      gdpGrowthRate: 4,
      capitalFeatureId: null,
      capitalStatus: 'established',
    };

    const evolved = applyNaturalEvolution(new Map([['FRA', state]]), {
      amount: 6,
      unit: 'month',
    }).get('FRA')!;

    expect(evolved.population).toBeCloseTo(1_005_000, -2);
    expect(evolved.gdp).toBeCloseTo(10_200, -1);
    expect(state.population).toBe(1_000_000);
  });
});

describe('createStartingUnits', () => {
  it('places every initial unit in its map region', () => {
    let sequence = 0;
    const units = createStartingUnits(
      '00000000-0000-4000-8000-000000000000',
      '1936-01-01T00:00:00.000Z',
      () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    );

    expect(units.map(({ name, regionId, centroid }) => ({ name, regionId, centroid }))).toEqual([
      {
        name: '1st Eritrean Division',
        regionId: 'Eritrea',
        centroid: [851.3, 288.3],
      },
      {
        name: '2nd Eritrean Division',
        regionId: 'Eritrea',
        centroid: [858.2, 290],
      },
      {
        name: 'Imperial Guard Kebur Zabagna',
        regionId: 'Shewa',
        centroid: [849.5, 313.8],
      },
      {
        name: '1st Panzer Division',
        regionId: 'Brandenburg',
        centroid: [748.4, 119.5],
      },
      {
        name: '1st Armored Division',
        regionId: 'Ile_de_France',
        centroid: [706.2, 139.2],
      },
      {
        name: 'Home Fleet',
        regionId: 'Scottish_Highlands',
        centroid: [680.4, 84.7],
      },
    ]);
  });
});

describe('grand strategy simulation', () => {
  const gameId = '00000000-0000-4000-8000-000000000000';
  const timestamp = '2000-01-02T00:00:00.000Z';

  it('preserves a national population exactly when distributing it across regions', () => {
    const regions = distributeRegionalPopulation(
      gameId,
      [{ nationCode: 'ENG', population: 50_000_000, industrialCapacity: 80, health: 75 }],
      [
        {
          regionId: 'Greater_London_Area',
          nationCode: 'ENG',
          terrain: 'urban',
          neighbors: ['Home_Counties'],
          cityWeight: 9,
        },
        {
          regionId: 'Home_Counties',
          nationCode: 'ENG',
          terrain: 'plains',
          neighbors: ['Greater_London_Area'],
          cityWeight: 1,
        },
      ],
      timestamp,
    );

    expect(regions.reduce((total, region) => total + region.population, 0)).toBe(50_000_000);
    expect(regions[0]!.population).toBe(45_000_000);
  });

  it('preserves a legacy fractional national population exactly', () => {
    const population = 42_250_809.71937029;
    const regions = distributeRegionalPopulation(
      gameId,
      [{ nationCode: 'FRA', population, industrialCapacity: 82, health: 76 }],
      [
        {
          regionId: 'Ile_de_France',
          nationCode: 'FRA',
          terrain: 'urban',
          neighbors: ['Normandy'],
          cityWeight: 8,
        },
        {
          regionId: 'Normandy',
          nationCode: 'FRA',
          terrain: 'plains',
          neighbors: ['Ile_de_France'],
          cityWeight: 2,
        },
      ],
      timestamp,
    );

    expect(regions.reduce((total, region) => total + region.population, 0)).toBe(population);
  });

  it('turns a populated nuclear target uninhabitable and removes population', () => {
    const target: RegionState = {
      gameId,
      regionId: 'Greater_London_Area',
      nationCode: 'ENG',
      population: 10_000_000,
      displacedPopulation: 0,
      woundedPopulation: 0,
      infrastructure: 100,
      industrialCapacity: 100,
      supply: 100,
      health: 100,
      habitability: 100,
      contamination: 0,
      radiation: 0,
      terrain: 'urban',
      neighbors: ['Home_Counties'],
      updatedAt: timestamp,
    };
    const neighbor = { ...target, regionId: 'Home_Counties', population: 5_000_000, neighbors: [] };
    const result = applyRegionalImpact(
      [target, neighbor],
      { kind: 'nuclear_strike', intensity: 100, targetRegionId: target.regionId },
      timestamp,
    );
    const changed = result.regions.find((region) => region.regionId === target.regionId)!;

    expect(result.deaths).toBeGreaterThan(5_000_000);
    expect(changed.population + changed.displacedPopulation).toBeLessThan(target.population);
    expect(changed.habitability).toBeLessThan(20);
    expect(changed.radiation).toBe(100);
    expect(result.affectedRegionIds).toContain('Home_Counties');
  });

  it('enforces land and naval route domains', () => {
    const seed = (regionId: string, terrain: RegionState['terrain'], neighbors: string[]) => ({
      gameId,
      regionId,
      nationCode: 'FRA',
      population: 1,
      displacedPopulation: 0,
      woundedPopulation: 0,
      infrastructure: 100,
      industrialCapacity: 100,
      supply: 100,
      health: 100,
      habitability: terrain === 'ocean' ? 0 : 100,
      contamination: 0,
      radiation: 0,
      terrain,
      neighbors,
      updatedAt: timestamp,
    });
    const regions = [
      seed('Paris', 'plains', ['Channel']),
      seed('Channel', 'ocean', ['Paris', 'London']),
      seed('London', 'coastal', ['Channel']),
    ];

    expect(findStrategicRoute(regions, 'Paris', 'London', 'land')).toBeNull();
    expect(findStrategicRoute(regions, 'Channel', 'London', 'naval')).toEqual([
      'Channel',
      'London',
    ]);
    expect(findStrategicRoute(regions, 'Paris', 'London', 'air')).toEqual(['Paris', 'London']);
  });
});

import type { GeneratedEvent, NationState, TimeJump, Unit } from '@what-if-history/contracts';

export * from './strategic.js';

export const SIMULATION_END_DATE = '9999-12-31';

export function addTime(currentDate: string, jump: TimeJump): string {
  const date = new Date(`${currentDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error('INVALID_DATE');
  }

  switch (jump.unit) {
    case 'day':
      date.setUTCDate(date.getUTCDate() + jump.amount);
      break;
    case 'week':
      date.setUTCDate(date.getUTCDate() + jump.amount * 7);
      break;
    case 'month':
      date.setUTCMonth(date.getUTCMonth() + jump.amount);
      break;
    case 'year':
      date.setUTCFullYear(date.getUTCFullYear() + jump.amount);
      break;
  }

  if (date.getUTCFullYear() > 9999) {
    throw new Error('SIMULATION_END_REACHED');
  }

  const result = date.toISOString().slice(0, 10);
  if (result > SIMULATION_END_DATE) {
    throw new Error('SIMULATION_END_REACHED');
  }
  return result;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const jumpYears = (jump: TimeJump) => {
  const days =
    jump.unit === 'day'
      ? jump.amount
      : jump.unit === 'week'
        ? jump.amount * 7
        : jump.unit === 'month'
          ? jump.amount * 30.4375
          : jump.amount * 365.25;
  return days / 365.25;
};

export function applyNaturalEvolution(
  states: ReadonlyMap<string, NationState>,
  jump: TimeJump,
): Map<string, NationState> {
  const years = jumpYears(jump);
  return new Map(
    [...states.entries()].map(([code, original]) => {
      const state = structuredClone(original);
      const populationRate = state.populationGrowthRate - (state.atWar ? 0.6 : 0);
      const gdpRate = state.gdpGrowthRate - (state.atWar ? 4 : 0);
      state.population = Math.max(0, state.population * (1 + (populationRate / 100) * years));
      state.gdp = Math.max(0, state.gdp * (1 + (gdpRate / 100) * years));
      if (state.atWar) {
        state.happiness = clamp(state.happiness - 3 * years, 0, 100);
        state.foodSecurity = clamp(state.foodSecurity - 2 * years, 0, 100);
        state.unemployment = clamp(state.unemployment + 1.5 * years, 0, 100);
      }
      return [code, state];
    }),
  );
}

export function applyEventChanges(
  states: ReadonlyMap<string, NationState>,
  events: GeneratedEvent[],
): Map<string, NationState> {
  const next = new Map(
    [...states.entries()].map(([code, state]) => [code, structuredClone(state)]),
  );

  for (const event of events) {
    for (const [code, changes] of Object.entries(event.state_changes)) {
      const state = next.get(code);
      if (!state) {
        throw new Error(`UNKNOWN_NATION_STATE:${code}`);
      }
      if (changes.stability !== undefined) {
        state.stability = clamp(state.stability + changes.stability, 0, 100);
      }
      if (changes.war_support !== undefined) {
        state.warSupport = clamp(state.warSupport + changes.war_support, 0, 100);
      }
      if (changes.treasury !== undefined) {
        state.treasury += changes.treasury;
      }
      if (changes.manpower !== undefined) {
        state.manpower = Math.max(0, state.manpower + changes.manpower);
      }
      if (changes.political_power !== undefined) {
        state.politicalPower += changes.political_power;
      }
      if (changes.population_percent !== undefined) {
        state.population = Math.max(0, state.population * (1 + changes.population_percent / 100));
      }
      if (changes.gdp_percent !== undefined) {
        state.gdp = Math.max(0, state.gdp * (1 + changes.gdp_percent / 100));
      }
      if (changes.happiness !== undefined) {
        state.happiness = clamp(state.happiness + changes.happiness, 0, 100);
      }
      if (changes.literacy !== undefined) {
        state.literacy = clamp(state.literacy + changes.literacy, 0, 100);
      }
      if (changes.unemployment !== undefined) {
        state.unemployment = clamp(state.unemployment + changes.unemployment, 0, 100);
      }
      if (changes.inflation !== undefined) {
        state.inflation = clamp(state.inflation + changes.inflation, -20, 200);
      }
      if (changes.industrial_capacity !== undefined) {
        state.industrialCapacity = clamp(
          state.industrialCapacity + changes.industrial_capacity,
          0,
          100,
        );
      }
      if (changes.health !== undefined) {
        state.health = clamp(state.health + changes.health, 0, 100);
      }
      if (changes.food_security !== undefined) {
        state.foodSecurity = clamp(state.foodSecurity + changes.food_security, 0, 100);
      }
      if (changes.at_war !== undefined) {
        state.atWar = changes.at_war;
      }
      if (changes.occupied_regions) {
        state.occupiedRegions = [
          ...new Set([...state.occupiedRegions, ...changes.occupied_regions]),
        ];
      }
    }
  }
  return next;
}

const STARTING_UNITS: Array<
  Omit<Unit, 'id' | 'gameId' | 'createdAt' | 'strength' | 'organization' | 'experience'>
> = [
  {
    name: '1st Eritrean Division',
    unitType: 'infantry',
    nationCode: 'ITA',
    regionId: 'Eritrea',
    centroid: [851.3, 288.3],
  },
  {
    name: '2nd Eritrean Division',
    unitType: 'infantry',
    nationCode: 'ITA',
    regionId: 'Eritrea',
    centroid: [858.2, 290],
  },
  {
    name: 'Imperial Guard Kebur Zabagna',
    unitType: 'infantry',
    nationCode: 'ETH',
    regionId: 'Shewa',
    centroid: [849.5, 313.8],
  },
  {
    name: '1st Panzer Division',
    unitType: 'armor',
    nationCode: 'GER',
    regionId: 'Brandenburg',
    centroid: [748.4, 119.5],
  },
  {
    name: '1st Armored Division',
    unitType: 'armor',
    nationCode: 'FRA',
    regionId: 'Ile_de_France',
    centroid: [706.2, 139.2],
  },
  {
    name: 'Home Fleet',
    unitType: 'naval',
    nationCode: 'ENG',
    regionId: 'Scottish_Highlands',
    centroid: [680.4, 84.7],
  },
];

export function createStartingUnits(
  gameId: string,
  createdAt: string,
  idFactory: () => string,
): Unit[] {
  return STARTING_UNITS.map((unit) => ({
    ...unit,
    id: idFactory(),
    gameId,
    strength: 100,
    organization: 100,
    experience: 0,
    createdAt,
  }));
}

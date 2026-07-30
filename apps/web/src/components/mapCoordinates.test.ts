import { describe, expect, it } from 'vitest';
import { MAP_HEIGHT, MAP_WIDTH, nationFocusBounds, svgPointToLeaflet } from './mapCoordinates';

describe('SVG map coordinates', () => {
  it('uses the exact dimensions declared by the historical SVG', () => {
    expect(MAP_WIDTH).toBe(1400.16);
    expect(MAP_HEIGHT).toBe(600);
  });

  it('converts top-origin SVG points to bottom-origin Leaflet points', () => {
    expect(svgPointToLeaflet([0, 0])).toEqual([600, 0]);
    expect(svgPointToLeaflet([1400.16, 600])).toEqual([0, 1400.16]);
    expect(svgPointToLeaflet([712.3, 148.6])).toEqual([451.4, 712.3]);
    expect(svgPointToLeaflet([445, 445])).toEqual([155, 445]);
  });

  it('frames the controlled nation around its capital without distant colonies', () => {
    const bounds = nationFocusBounds(
      [
        { nation_code: 'FRA', type: 'capital', coords: [706.2, 139.2] },
        { nation_code: 'FRA', type: 'major_city', coords: [719.1, 162.3] },
        { nation_code: 'FRA', type: 'major_city', coords: [631.9, 290.8] },
        { nation_code: 'GER', type: 'capital', coords: [748.4, 119.5] },
      ],
      'FRA',
    );

    expect(bounds?.[0][0]).toBeCloseTo(404.25);
    expect(bounds?.[0][1]).toBeCloseTo(652.65);
    expect(bounds?.[1][0]).toBeCloseTo(494.25);
    expect(bounds?.[1][1]).toBeCloseTo(772.65);
  });

  it('returns no focus when a nation has no known capital', () => {
    expect(nationFocusBounds([], 'FRA')).toBeUndefined();
  });
});

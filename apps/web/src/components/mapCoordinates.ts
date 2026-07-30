export const MAP_WIDTH = 1400.16;
export const MAP_HEIGHT = 600;

export type SvgPoint = readonly [x: number, y: number];
export type LeafletPoint = [latitude: number, longitude: number];
export type LeafletBounds = [southWest: LeafletPoint, northEast: LeafletPoint];

export function svgPointToLeaflet([x, y]: SvgPoint): LeafletPoint {
  return [MAP_HEIGHT - y, x];
}

export function nationFocusBounds(
  cities: ReadonlyArray<{
    nation_code: string;
    type: string;
    coords: SvgPoint;
  }>,
  nationCode: string,
): LeafletBounds | undefined {
  const capital = cities.find((city) => city.nation_code === nationCode && city.type === 'capital');
  if (!capital) return undefined;

  const nearbyCities = cities.filter((city) => {
    if (city.nation_code !== nationCode) return false;
    const deltaX = city.coords[0] - capital.coords[0];
    const deltaY = city.coords[1] - capital.coords[1];
    return Math.hypot(deltaX, deltaY) <= 55;
  });
  const minX = Math.min(...nearbyCities.map((city) => city.coords[0]));
  const maxX = Math.max(...nearbyCities.map((city) => city.coords[0]));
  const minY = Math.min(...nearbyCities.map((city) => city.coords[1]));
  const maxY = Math.max(...nearbyCities.map((city) => city.coords[1]));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfWidth = Math.max(60, (maxX - minX) / 2 + 24);
  const halfHeight = Math.max(45, (maxY - minY) / 2 + 20);

  const west = Math.max(0, centerX - halfWidth);
  const east = Math.min(MAP_WIDTH, centerX + halfWidth);
  const north = Math.max(0, centerY - halfHeight);
  const south = Math.min(MAP_HEIGHT, centerY + halfHeight);
  return [svgPointToLeaflet([west, south]), svgPointToLeaflet([east, north])];
}

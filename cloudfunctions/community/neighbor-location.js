'use strict';

const GRID = 'shanghai-gcj02-1km-v1';
const CELL_METERS = 1000;
const CHANGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const LATITUDE_SCALE = RADIUS * RAD;
const LONGITUDE_SCALE = LATITUDE_SCALE * Math.cos(31.23 * RAD);
// A coarse Shanghai coverage box, not an administrative-boundary or address lookup.
const BOUNDS = { south: 30.6, north: 32.0, west: 120.8, east: 122.2 };
function normalizeCell(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['grid', 'x', 'y'].includes(key)) ||
      value.grid !== GRID || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) return null;
  const minX = Math.floor(BOUNDS.west * LONGITUDE_SCALE / CELL_METERS);
  const maxX = Math.floor(BOUNDS.east * LONGITUDE_SCALE / CELL_METERS);
  const minY = Math.floor(BOUNDS.south * LATITUDE_SCALE / CELL_METERS);
  const maxY = Math.floor(BOUNDS.north * LATITUDE_SCALE / CELL_METERS);
  return value.x >= minX && value.x <= maxX && value.y >= minY && value.y <= maxY ? { grid: GRID, x: value.x, y: value.y } : null;
}
function toCell(point) {
  if (!point || point.coordinateSystem !== 'gcj02' || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < BOUNDS.south || point.latitude > BOUNDS.north || point.longitude < BOUNDS.west || point.longitude > BOUNDS.east) return null;
  return normalizeCell({ grid: GRID, x: Math.floor(point.longitude * LONGITUDE_SCALE / CELL_METERS), y: Math.floor(point.latitude * LATITUDE_SCALE / CELL_METERS) });
}
function distanceBand(left, right) {
  const a = normalizeCell(left); const b = normalizeCell(right);
  if (!a || !b) return '';
  // Quantized-cell distance is deliberately approximate; it is never a routing destination.
  const meters = Math.hypot(a.x - b.x, a.y - b.y) * CELL_METERS;
  if (meters < 1000) return '约1km内';
  if (meters < 3000) return '约1–3km';
  if (meters < 5000) return '约3–5km';
  if (meters < 10000) return '约5–10km';
  return '约10km以上';
}
module.exports = { GRID, CELL_METERS, CHANGE_INTERVAL_MS, normalizeCell, toCell, distanceBand };

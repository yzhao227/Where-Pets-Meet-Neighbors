'use strict';

const EARTH_RADIUS_METERS = 6371008.8;

function normalizePoint(value) {
  if (!value || value.coordinateSystem !== 'gcj02' ||
      !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
      value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) return null;
  return { latitude: value.latitude, longitude: value.longitude, coordinateSystem: 'gcj02' };
}

// Both inputs use the same map coordinate system. This is an approximate straight-line distance.
function distanceMeters(from, to) {
  const start = normalizePoint(from); const end = normalizePoint(to);
  if (!start || !end) return null;
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(start.latitude)) * Math.cos(radians(end.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.max(0, Math.min(1, value))));
}

function distanceLabel(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 100) return '100 m 内';
  if (meters < 950) return '约 ' + Math.round(meters / 100) * 100 + ' m';
  return '约 ' + (Math.round(meters / 100) / 10).toFixed(1) + ' km';
}

module.exports = { normalizePoint, distanceMeters, distanceLabel };

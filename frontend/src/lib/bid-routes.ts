export function bidDetailPath(id: string) {
  return `/bids/${encodeURIComponent(id)}`;
}

export function bidIdFromRouteParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

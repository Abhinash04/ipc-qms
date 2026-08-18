function normaliseAddress(value) {
  const raw = String(value || '').trim();
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

export { normaliseAddress };

/**
 * UUID za ime fajla u storage-u. Web i Node imaju crypto.randomUUID, React
 * Native ga nema bez dodatka — zato rezervni put. Ovo je ime fajla, ne tajna.
 */
export function randomId() {
  const source = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

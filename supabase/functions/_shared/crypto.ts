// Šifrovanje pristupnih podataka apartmana (docs/DECISIONS.md, odluka 4).
// AES-256-GCM, ključ PROPERTY_SECRET_KEY iz Supabase secrets.
// Zapis: base64(iv).base64(ciphertext).base64(tag)
//
// Ključ nikad ne napušta Edge Function. Baza vidi samo šifrovan zapis, klijent
// samo otvoren tekst i to tek pošto se dokaže da je vlasnik apartmana.

const IV_BYTES = 12;
const TAG_BYTES = 16;

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Očekuje se nasumičnih 32 bajta u base64 zapisu. Ako ključ nije tog oblika,
 * izvodi se SHA-256 iz zadatog teksta, da podešavanje ne pukne — ali pravi
 * nasumičan ključ je jedini ispravan izbor za pilot.
 */
async function importKey(secret: string) {
  let raw: Uint8Array;
  try {
    const decoded = fromBase64(secret);
    raw = decoded.length === 32 ? decoded : new Uint8Array(await sha256(secret));
  } catch {
    raw = new Uint8Array(await sha256(secret));
  }
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function sha256(value: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

export async function encryptSecret(secret: string, plaintext: string) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  // WebCrypto lepi oznaku na kraj šifrata; zapis ih drži razdvojeno.
  const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  return [toBase64(iv), toBase64(ciphertext), toBase64(tag)].join('.');
}

export async function decryptSecret(secret: string, record: string) {
  const parts = record.split('.');
  if (parts.length !== 3) throw new Error('ZAPIS_NEISPRAVAN');
  const [ivPart, ciphertextPart, tagPart] = parts as [string, string, string];

  const key = await importKey(secret);
  const iv = fromBase64(ivPart);
  const ciphertext = fromBase64(ciphertextPart);
  const tag = fromBase64(tagPart);

  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);

  const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed);
  return new TextDecoder().decode(opened);
}

/** Prazno polje se ne šifruje — čuva se kao null, da se razlikuje od šifrovane praznine. */
export async function encryptOptional(secret: string, value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return await encryptSecret(secret, value.trim());
}

export async function decryptOptional(secret: string, record: unknown) {
  if (typeof record !== 'string' || record === '') return null;
  try {
    return await decryptSecret(secret, record);
  } catch {
    return null;
  }
}

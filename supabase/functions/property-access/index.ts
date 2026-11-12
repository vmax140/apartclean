import { accountHandler, json } from '../_shared/account.ts';
import { decryptOptional, encryptOptional } from '../_shared/crypto.ts';

// Pristupni podaci apartmana: šifra sefa, WiFi lozinka i uputstvo za ključ.
// Vlasnik ih ovde upisuje i čita; spremač ih dobija kroz RPC get_access_info,
// u svom zadatku i u svom vremenskom okviru (SPEC sekcija 4).

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function text(value: unknown, max: number) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

Deno.serve(accountHandler(async (request, id, admin) => {
  const secret = Deno.env.get('PROPERTY_SECRET_KEY');
  if (!secret) return json(500, { error: 'CONFIGURATION_ERROR' });

  const body = await request.json().catch(() => null);
  if (!body) return json(400, { error: 'INVALID_INPUT' });

  // Vlasnik radi nad apartmanom, spremačica nad zadatkom — svaka radnja proverava svoje.
  const ownerActions = body.action === 'load' || body.action === 'save';
  if (ownerActions && (typeof body.propertyId !== 'string' || !uuid.test(body.propertyId))) {
    return json(400, { error: 'INVALID_INPUT' });
  }

  if (body.action === 'load') {
    const response = await admin('/rest/v1/rpc/get_property_access_for_owner', {
      method: 'POST',
      body: JSON.stringify({ target_property: body.propertyId, owner: id }),
    });
    if (!response.ok) return json(response.status === 403 ? 403 : 500, { error: 'ACCESS_LOAD_FAILED' });
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json(200, { access: null });
    return json(200, {
      access: {
        key_instructions: row.key_instructions ?? null,
        wifi_name: row.wifi_name ?? null,
        lockbox_code: await decryptOptional(secret, row.lockbox_code_encrypted),
        wifi_password: await decryptOptional(secret, row.wifi_password_encrypted),
      },
    });
  }

  // Spremačica traži pristupne podatke za svoj zadatak; baza proverava da li
  // sme (dodeljen zadatak, pravi status, vremenski okvir).
  if (body.action === 'cleaner') {
    if (typeof body.taskId !== 'string' || !uuid.test(body.taskId)) {
      return json(400, { error: 'INVALID_INPUT' });
    }
    const response = await admin('/rest/v1/rpc/get_access_info_for', {
      method: 'POST',
      body: JSON.stringify({ target_task: body.taskId, cleaner: id }),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      const code = typeof problem?.message === 'string' ? problem.message.split(':')[0] : '';
      if (code === 'NIJE_VAS_ZADATAK' || code === 'POGRESAN_STATUS'
          || code === 'VAN_VREMENSKOG_OKVIRA') {
        return json(403, { error: code });
      }
      return json(500, { error: 'ACCESS_LOAD_FAILED' });
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json(200, { access: null });
    return json(200, {
      access: {
        key_instructions: row.key_instructions ?? null,
        wifi_name: row.wifi_name ?? null,
        lockbox_code: await decryptOptional(secret, row.lockbox_code_encrypted),
        wifi_password: await decryptOptional(secret, row.wifi_password_encrypted),
      },
    });
  }

  if (body.action !== 'save') return json(400, { error: 'INVALID_INPUT' });

  const instructions = text(body.key_instructions, 1000);
  const wifiName = text(body.wifi_name, 100);
  const lockbox = text(body.lockbox_code, 50);
  const wifiPassword = text(body.wifi_password, 100);
  if (instructions === undefined || wifiName === undefined
    || lockbox === undefined || wifiPassword === undefined) {
    return json(400, { error: 'INVALID_INPUT' });
  }

  const response = await admin('/rest/v1/rpc/set_property_access', {
    method: 'POST',
    body: JSON.stringify({
      target_property: body.propertyId,
      owner: id,
      instructions,
      lockbox: await encryptOptional(secret, lockbox),
      wifi: wifiName,
      wifi_secret: await encryptOptional(secret, wifiPassword),
    }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.message === 'string' ? problem.message.split(':')[0] : '';
    if (code === 'NIJE_VAS_APARTMAN') return json(403, { error: 'NOT_YOUR_PROPERTY' });
    return json(500, { error: 'ACCESS_SAVE_FAILED' });
  }
  return json(200, { ok: true });
}));

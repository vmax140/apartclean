import { accountHandler, json } from '../_shared/account.ts';

// Odluka administratora o verifikaciji spremačice (SPEC sekcije 7 i 9).
//
// Redosled je namerno ovakav: prvo se brišu fajlovi, pa se tek onda upisuje
// odluka. Ako upis padne, dokumenti su ipak nestali i zahtev ostaje na čekanju —
// administrator ga ponovi. Obrnut redosled bi mogao da ostavi odluku upisanu uz
// lične dokumente koji i dalje stoje u storage-u, a to niko ne bi primetio.

const BUCKET = 'verification-docs';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

Deno.serve(accountHandler(async (request, id, admin) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.requestId !== 'string' || !uuid.test(body.requestId)
    || typeof body.approve !== 'boolean') {
    return json(400, { error: 'INVALID_INPUT' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
  if (!body.approve && reason.trim() === '') return json(400, { error: 'REASON_REQUIRED' });

  const roles = await admin(
    `/rest/v1/user_roles?user_id=eq.${id}&role=eq.admin&select=role`,
    { method: 'GET' },
  );
  if (!roles.ok) return json(500, { error: 'ROLE_CHECK_FAILED' });
  if (!(await roles.json()).length) return json(403, { error: 'ADMIN_ONLY' });

  const found = await admin(
    `/rest/v1/verification_requests?id=eq.${body.requestId}&select=status,doc_front_path,selfie_path`,
    { method: 'GET' },
  );
  if (!found.ok) return json(500, { error: 'REQUEST_LOAD_FAILED' });
  const [record] = await found.json();
  if (!record) return json(404, { error: 'REQUEST_NOT_FOUND' });
  if (record.status !== 'pending') return json(409, { error: 'ALREADY_DECIDED' });

  const paths = [record.doc_front_path, record.selfie_path].filter(
    (path: unknown): path is string => typeof path === 'string' && path !== '',
  );
  if (paths.length) {
    // Grupno brisanje: jedan poziv za oba fajla, i očekuje JSON telo — pojedinačni
    // DELETE ga odbija jer naš pomoćnik uvek šalje Content-Type: application/json.
    // Putanja koje više nema prosto nema ni u odgovoru, što nije greška.
    const removed = await admin(`/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!removed.ok) return json(502, { error: 'FILE_DELETE_FAILED' });
  }

  const decided = await admin('/rest/v1/rpc/decide_verification', {
    method: 'POST',
    body: JSON.stringify({
      request_id: body.requestId,
      approve: body.approve,
      reason,
      decided_by: id,
    }),
  });
  if (!decided.ok) {
    const problem = await decided.json().catch(() => null);
    const code = typeof problem?.message === 'string' ? problem.message.split(':')[0] : '';
    if (code === 'ZAHTEV_VEC_RESEN') return json(409, { error: 'ALREADY_DECIDED' });
    return json(500, { error: 'DECISION_FAILED' });
  }

  return json(200, { ok: true, filesDeleted: paths.length });
}));

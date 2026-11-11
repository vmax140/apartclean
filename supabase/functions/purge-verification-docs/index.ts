// Dnevno čišćenje dokumenata za verifikaciju.
//
// SPEC sekcija 9 traži da se slike dokumenta i selfija brišu odmah po odluci
// administratora, ali ne kaže šta biva sa zahtevima o kojima se nikad ne odluči:
// spremačica odustane, administrator ne otvori red čekanja, ili stigne nov zahtev
// pre nego što je stari rešen. Bez ovoga lični dokumenti ostaju da stoje zauvek.
//
// Posao briše:
//   1. fajlove zahteva koji su na čekanju duže od PURGE_AFTER_DAYS — zahtev se
//      pritom označava kao odbijen, da administrator ne gleda prazne okvire;
//   2. fajlove koji u storage-u stoje bez ijednog zahteva (zaostali posle greške).
//
// Poziva ga pg_cron jednom dnevno; ručno se ne zove iz aplikacije, pa prolazi
// samo poziv sa service role ključem.

const BUCKET = 'verification-docs';
const PURGE_AFTER_DAYS = 7;
const EXPIRY_REASON =
  'Zahtev je istekao jer o njemu nije odlučeno na vreme. Pošalji nov zahtev sa novim slikama.';

function json(status: number, payload: object) {
  return Response.json(payload, { status });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(500, { error: 'CONFIGURATION_ERROR' });

  const authorization = request.headers.get('authorization');
  if (authorization !== 'Bearer ' + serviceKey) return json(401, { error: 'UNAUTHORIZED' });

  const call = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        apikey: serviceKey,
        authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
    });

  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86_400_000).toISOString();

  // 1. Zahtevi kojima fajlovi treba da nestanu: oni koji predugo stoje na čekanju,
  //    i oni o kojima je odlučeno a brisanje iz nekog razloga nije prošlo
  //    (tu spadaju i zahtevi koje je zamenio noviji — triger ih odmah odbije).
  const [stale, undeleted] = await Promise.all([
    call(
      `/rest/v1/verification_requests?status=eq.pending&created_at=lt.${cutoff}` +
        '&select=id,doc_front_path,selfie_path',
    ),
    call(
      '/rest/v1/verification_requests?status=neq.pending&files_deleted_at=is.null' +
        '&or=(doc_front_path.not.is.null,selfie_path.not.is.null)' +
        '&select=id,doc_front_path,selfie_path',
    ),
  ]);
  if (!stale.ok || !undeleted.ok) return json(500, { error: 'QUERY_FAILED' });

  type Row = { id: string; doc_front_path: string | null; selfie_path: string | null };
  const expired = (await stale.json()) as Row[];
  const leftovers = (await undeleted.json()) as Row[];
  const requests = [...expired, ...leftovers];

  const stalePaths = requests
    .flatMap((row) => [row.doc_front_path, row.selfie_path])
    .filter((path): path is string => !!path);

  if (stalePaths.length) {
    const removed = await call(`/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: stalePaths }),
    });
    if (!removed.ok) return json(502, { error: 'FILE_DELETE_FAILED' });
  }

  const now = new Date().toISOString();
  const expiredIds = new Set(expired.map((row) => row.id));
  for (const row of requests) {
    const marked = await call(`/rest/v1/verification_requests?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        doc_front_path: null,
        selfie_path: null,
        files_deleted_at: now,
        // Samo zahtev koji je istekao menja status; o ostalima je već odlučeno.
        ...(expiredIds.has(row.id)
          ? { status: 'rejected', rejection_reason: EXPIRY_REASON, reviewed_at: now }
          : {}),
      }),
    });
    if (!marked.ok) return json(500, { error: 'UPDATE_FAILED' });
  }

  // 2. Fajlovi bez ijednog zahteva — ostatak posle prekinutog slanja ili greške.
  const listed = await call(`/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    body: JSON.stringify({ prefix: '', limit: 1000 }),
  });
  if (!listed.ok) return json(500, { error: 'LIST_FAILED' });

  const known = await call(
    '/rest/v1/verification_requests?select=doc_front_path,selfie_path' +
      '&or=(doc_front_path.not.is.null,selfie_path.not.is.null)',
  );
  if (!known.ok) return json(500, { error: 'QUERY_FAILED' });
  const live = new Set(
    ((await known.json()) as { doc_front_path: string | null; selfie_path: string | null }[])
      .flatMap((row) => [row.doc_front_path, row.selfie_path])
      .filter((path): path is string => !!path),
  );

  // Lista vraća foldere po korisniku, pa se u svaki ulazi posebno.
  const folders = (await listed.json()) as { name: string }[];
  const orphans: string[] = [];
  for (const folder of folders) {
    const inside = await call(`/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      body: JSON.stringify({ prefix: folder.name, limit: 1000 }),
    });
    if (!inside.ok) continue;
    for (const file of (await inside.json()) as { name: string }[]) {
      const path = `${folder.name}/${file.name}`;
      if (!live.has(path)) orphans.push(path);
    }
  }

  if (orphans.length) {
    const removed = await call(`/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      body: JSON.stringify({ prefixes: orphans }),
    });
    if (!removed.ok) return json(502, { error: 'FILE_DELETE_FAILED' });
  }

  return json(200, {
    ok: true,
    expiredRequests: expired.length,
    cleanedRequests: leftovers.length,
    deletedFiles: stalePaths.length + orphans.length,
  });
});

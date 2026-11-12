// Brisanje slika zadataka starijih od 30 dana (SPEC sekcije 2 i 9, pilot).
//
// Dva izuzetka, po docs/DECISIONS.md, odluka 17:
//   - slike vezane za prijavu štete koja još nije rešena ostaju, jer su dokaz;
//   - referentne slike se ne diraju — SPEC govori samo o slikama zadataka.

const BUCKET = 'task-photos';
const KEEP_DAYS = 30;

function json(status: number, payload: object) {
  return Response.json(payload, { status });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(500, { error: 'CONFIGURATION_ERROR' });
  if (request.headers.get('authorization') !== 'Bearer ' + serviceKey) {
    return json(401, { error: 'UNAUTHORIZED' });
  }

  const call = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        apikey: serviceKey,
        authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
    });

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();

  const listed = await call(
    `/rest/v1/task_photos?uploaded_at=lt.${cutoff}&select=id,storage_path&limit=1000`,
  );
  if (!listed.ok) return json(500, { error: 'QUERY_FAILED' });
  const photos = (await listed.json()) as { id: string; storage_path: string }[];
  if (!photos.length) return json(200, { ok: true, deleted: 0, kept: 0 });

  // Slike koje drži otvorena prijava štete.
  const reports = await call(
    '/rest/v1/property_reports?status=neq.resolved&select=photo_ids',
  );
  if (!reports.ok) return json(500, { error: 'QUERY_FAILED' });
  const held = new Set(
    ((await reports.json()) as { photo_ids: string[] }[]).flatMap((row) => row.photo_ids ?? []),
  );

  const removable = photos.filter((photo) => !held.has(photo.id));
  if (!removable.length) return json(200, { ok: true, deleted: 0, kept: photos.length });

  const removed = await call(`/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: removable.map((photo) => photo.storage_path) }),
  });
  if (!removed.ok) return json(502, { error: 'FILE_DELETE_FAILED' });

  // Redovi se brišu tek pošto fajlovi nestanu, da ne ostanu slike bez traga u bazi.
  const ids = removable.map((photo) => photo.id).join(',');
  const dropped = await call(`/rest/v1/task_photos?id=in.(${ids})`, { method: 'DELETE' });
  if (!dropped.ok) return json(500, { error: 'DELETE_FAILED' });

  return json(200, {
    ok: true,
    deleted: removable.length,
    kept: photos.length - removable.length,
  });
});

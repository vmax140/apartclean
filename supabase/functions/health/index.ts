// Provera da projekat radi, i ping koji ga drži budnim.
//
// Supabase Free pauzira projekat posle 7 dana neaktivnosti. Pauziran projekat ne
// pokreće svoj pg_cron, pa ping mora da stigne spolja — otuda zakazani GitHub
// Actions workflow (docs/DECISIONS.md, odluka 15).
//
// Namerno dodiruje bazu: običan odgovor funkcije ne mora da se računa kao
// aktivnost baze.

Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) return Response.json({ error: 'CONFIGURATION_ERROR' }, { status: 500 });

  const response = await fetch(url + '/rest/v1/regions?select=id&limit=1', {
    headers: { apikey: anonKey, authorization: 'Bearer ' + anonKey },
  });

  return Response.json(
    { ok: response.ok, database: response.ok ? 'up' : 'down', at: new Date().toISOString() },
    { status: response.ok ? 200 : 503 },
  );
});

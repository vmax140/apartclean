import { accountHandler, json } from '../_shared/account.ts';

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

Deno.serve(accountHandler(async (request, id, admin) => {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.documentIds) || body.documentIds.length > 20
    || !body.documentIds.every((value: unknown) => typeof value === 'string' && uuid.test(value))
    || typeof body.appVersion !== 'string' || !/^[0-9a-z.+-]{1,32}$/i.test(body.appVersion)) {
    return json(400, { error: 'INVALID_INPUT' });
  }

  const rawIp = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const ip = rawIp && /^[\da-f.:]{2,45}$/i.test(rawIp) ? rawIp : null;
  const response = await admin('/rest/v1/rpc/record_legal_acceptance', {
    method: 'POST',
    body: JSON.stringify({
      target_user: id,
      document_ids: body.documentIds,
      client_ip: ip,
      client_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      client_version: body.appVersion,
    }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    if (problem?.message === 'DOCUMENTS_CHANGED') return json(409, { error: 'DOCUMENTS_CHANGED' });
    return json(response.status === 403 ? 403 : 500, { error: 'ACCEPTANCE_FAILED' });
  }
  return json(200, { ok: true });
}));

import { accountHandler, json } from '../_shared/account.ts';

Deno.serve(accountHandler(async (request, id, admin) => {
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) return json(400, { error: 'CONFIRMATION_REQUIRED' });

  const profile = await admin('/rest/v1/rpc/anonymize_account', {
    method: 'POST',
    body: JSON.stringify({ target_user: id }),
  });
  if (!profile.ok) return json(500, { error: 'ANONYMIZATION_FAILED' });

  const avatar = await admin('/storage/v1/object/avatars', {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: [id + '.jpg'] }),
  });
  if (!avatar.ok) return json(503, { error: 'AVATAR_REMOVAL_FAILED' });

  const auth = await admin('/auth/v1/admin/users/' + id, {
    method: 'DELETE',
    body: JSON.stringify({ should_soft_delete: true }),
  });
  if (!auth.ok) return json(503, { error: 'AUTH_REMOVAL_FAILED' });
  return json(200, { ok: true });
}));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, payload: object) {
  return Response.json(payload, { status, headers: cors });
}

export function accountHandler(
  action: (request: Request, id: string, admin: (path: string, init: RequestInit) => Promise<Response>) => Promise<Response>,
) {
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'UNAUTHORIZED' });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json(500, { error: 'CONFIGURATION_ERROR' });
    try {
      const response = await fetch(url + '/auth/v1/user', {
        headers: { apikey: serviceKey, authorization },
      });
      if (!response.ok) return json(response.status >= 500 ? 503 : 401, { error: 'UNAUTHORIZED' });
      const { id } = await response.json();
      if (typeof id !== 'string') return json(401, { error: 'UNAUTHORIZED' });
      return await action(request, id, (path, init) => fetch(url + path, {
        ...init,
        headers: {
          apikey: serviceKey,
          authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
        },
      }));
    } catch {
      return json(503, { error: 'SERVICE_UNAVAILABLE' });
    }
  };
}

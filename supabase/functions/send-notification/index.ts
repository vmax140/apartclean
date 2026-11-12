// Dostava jednog obaveštenja: push na sve uređaje korisnika i, za važne vrste,
// mejl (SPEC sekcija 6, koraci 3–4).
//
// Funkcija je namerno popustljiva: ako ključa nema ili Expo ne odgovara, vraća
// uspeh sa opisom šta je preskočeno. Red u notifications već postoji i korisnik
// ga vidi u aplikaciji — push i mejl su dodatak, ne uslov.

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const RESEND_URL = 'https://api.resend.com/emails';

// Mejl ide samo za ono zbog čega vredi prekinuti čoveka. Ostalo je push i
// spisak u aplikaciji — besplatni nivo Resend-a je ograničen, a i previše
// mejlova navede ljude da ih potpuno isključe.
const EMAIL_TYPES = new Set([
  'task_offered',
  'task_ready',
  'task_no_show',
  'task_cancelled',
  'dispute_resolved',
]);

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

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

  const body = await request.json().catch(() => null);
  if (!body || typeof body.notificationId !== 'string') return json(400, { error: 'INVALID_INPUT' });

  const call = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        apikey: serviceKey,
        authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
    });

  const found = await call(
    `/rest/v1/notifications?id=eq.${body.notificationId}&select=id,user_id,type,title,body,data`,
  );
  if (!found.ok) return json(500, { error: 'NOTIFICATION_LOAD_FAILED' });
  const [notification] = await found.json();
  if (!notification) return json(404, { error: 'NOTIFICATION_NOT_FOUND' });

  const delivery: Record<string, unknown> = { at: new Date().toISOString() };

  // ===== PUSH =====
  const devices = await call(
    `/rest/v1/push_devices?user_id=eq.${notification.user_id}&select=expo_push_token`,
  );
  const tokens = devices.ok
    ? ((await devices.json()) as { expo_push_token: string }[])
        .map((row) => row.expo_push_token)
        .filter((token) => EXPO_TOKEN.test(token))
    : [];

  if (tokens.length === 0) {
    delivery.push = 'no_devices';
  } else {
    try {
      const response = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(
          tokens.map((token) => ({
            to: token,
            title: notification.title,
            body: notification.body,
            data: { ...notification.data, type: notification.type },
            sound: 'default',
            priority: 'high',
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await response.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      let sent = 0;
      for (const [index, entry] of (result.data ?? []).entries()) {
        if (entry.status === 'ok') {
          sent += 1;
          continue;
        }
        // Token koji više ne postoji samo troši pozive — briše se odmah.
        if (entry.details?.error === 'DeviceNotRegistered') {
          await call('/rest/v1/rpc/drop_push_device', {
            method: 'POST',
            body: JSON.stringify({ token: tokens[index] }),
          });
        }
      }
      delivery.push = { sent, of: tokens.length };
    } catch (problem) {
      delivery.push = { error: problem instanceof Error ? problem.message : 'unknown' };
    }
  }

  // ===== MEJL =====
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const sender = Deno.env.get('RESEND_FROM');
  if (!EMAIL_TYPES.has(notification.type)) {
    delivery.email = 'not_needed';
  } else if (!resendKey || !sender) {
    delivery.email = 'not_configured';
  } else {
    const person = await call(`/rest/v1/profiles?id=eq.${notification.user_id}&select=full_name`);
    const auth = await call(`/auth/v1/admin/users/${notification.user_id}`);
    const email = auth.ok ? ((await auth.json()) as { email?: string }).email : undefined;
    const name = person.ok
      ? ((await person.json()) as { full_name: string }[])[0]?.full_name
      : undefined;

    if (!email) {
      delivery.email = 'no_address';
    } else {
      try {
        const response = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            to: [email],
            subject: notification.title,
            text: `${name ? name + ',\n\n' : ''}${notification.body}\n\nApartClean`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        delivery.email = response.ok ? 'sent' : 'failed_' + response.status;
      } catch (problem) {
        delivery.email = { error: problem instanceof Error ? problem.message : 'unknown' };
      }
    }
  }

  await call('/rest/v1/rpc/record_delivery', {
    method: 'POST',
    body: JSON.stringify({ notification_id: notification.id, delivery }),
  });

  return json(200, { ok: true, delivery });
});

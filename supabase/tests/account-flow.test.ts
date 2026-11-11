import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { admin } from './helpers';

const callback = 'http://127.0.0.1:3000/prijava';
const password = 'Apartclean-Local-Test!123';
let api: string;
let anon: string;
let inbox: string;

beforeAll(() => {
  const status = JSON.parse(execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'pipe'] }).toString());
  api = status.API_URL;
  anon = status.ANON_KEY;
  inbox = status.MAILPIT_URL;
  if (new URL(api).hostname !== '127.0.0.1') throw new Error('The account integration test requires local Supabase');
});

afterAll(() => admin.end());

function post(path: string, body: object, token?: string) {
  return fetch(api + path, {
    method: 'POST',
    headers: {
      apikey: anon,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Sesija koju GoTrue vrati posle razmene PKCE koda. */
type Session = { access_token: string; user: { id: string; email: string } };

// Response.json() je tipiziran kao unknown, pa oblik odgovora tražimo na mestu poziva.
async function ok<T>(response: Response): Promise<T> {
  expect(response.ok, 'HTTP ' + response.status + ' from ' + new URL(response.url).pathname).toBe(true);
  return (await response.json()) as T;
}

function pkce() {
  const verifier = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

async function followEmail(email: string, verifier: string): Promise<Session> {
  const search = new URL('/api/v1/search', inbox);
  search.searchParams.set('query', 'to:' + email);
  let id: string | undefined;
  for (let attempt = 0; attempt < 15 && !id; attempt++) {
    const result = await ok<{ messages?: { ID: string }[] }>(await fetch(search));
    id = result.messages?.[0]?.ID;
    if (!id) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!id) throw new Error('Confirmation email did not arrive');
  const message = await ok<{ HTML: string }>(await fetch(inbox + '/api/v1/message/' + id));
  const href = message.HTML.match(/href="([^"]*\/verify\?[^"]+)"/)?.[1];
  if (!href) throw new Error('Confirmation link missing from email');
  const verifyUrl = new URL(href.replaceAll('&amp;', '&'));
  const redirect = await fetch(api + '/auth/v1/verify' + verifyUrl.search, { redirect: 'manual' });
  const location = redirect.headers.get('location');
  expect(location).toBeTruthy();
  const url = new URL(location!);
  expect(url.origin + url.pathname).toBe(callback);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('PKCE code missing from redirect');
  return ok<Session>(await post('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }));
}

it('rejects a signup without adulthood confirmation', async () => {
  const response = await post('/auth/v1/signup', { email: randomUUID() + '@example.com', password });
  expect(response.ok).toBe(false);
  expect(JSON.stringify(await response.json())).toContain('ADULT_CONFIRMATION_REQUIRED');
});

it('confirms email, assigns roles, records terms and anonymizes the account', async () => {
  const email = randomUUID() + '@example.com';
  const { verifier, challenge } = pkce();
  const signup = await ok<{ access_token?: string }>(await post('/auth/v1/signup?redirect_to=' + encodeURIComponent(callback), {
    email,
    password,
    data: { full_name: 'ApartClean Test', adult_confirmed: true },
    code_challenge: challenge,
    code_challenge_method: 's256',
  }));
  expect(signup.access_token).toBeUndefined();
  const session = await followEmail(email, verifier);
  const id = session.user.id;
  const token = session.access_token;
  expect((await post('/rest/v1/rpc/set_initial_roles', { roles: ['owner', 'cleaner'] }, token)).ok).toBe(true);

  const documents = await admin<{ id: string }[]>`select id from legal_documents where is_active`;
  const documentIds = documents.map((doc) => doc.id);
  expect(documentIds).toHaveLength(5);
  expect((await post('/rest/v1/legal_acceptances', { user_id: id, document_id: documentIds[0] }, token)).ok).toBe(false);
  const body = { documentIds, appVersion: '1B-test' };
  const partial = await post('/functions/v1/accept-legal', { ...body, documentIds: documentIds.slice(1) }, token);
  expect(partial.status, await partial.text()).toBe(409);
  expect((await admin`select status from profiles where id = ${id}`)[0]?.status).toBe('pending');
  expect((await post('/functions/v1/accept-legal', body, token)).ok).toBe(true);
  expect((await post('/functions/v1/accept-legal', body, token)).ok).toBe(true);

  const acceptances = await admin`select app_version, user_agent from legal_acceptances where user_id = ${id}`;
  expect(acceptances).toHaveLength(5);
  expect(acceptances.every((row) => row.app_version === '1B-test' && row.user_agent)).toBe(true);
  expect((await admin`select status from profiles where id = ${id}`)[0]?.status).toBe('active');
  expect((await post('/auth/v1/token?grant_type=password', { email, password })).ok).toBe(true);

  const deletion = await post('/functions/v1/delete-account', { confirmed: true }, token);
  expect(deletion.ok, await deletion.text()).toBe(true);
  expect((await admin`select status, full_name, phone, avatar_url from profiles where id = ${id}`)[0]).toEqual({
    status: 'deleted', full_name: '', phone: null, avatar_url: null,
  });
  expect(await admin`select id from legal_acceptances where user_id = ${id}`).toHaveLength(5);
  expect((await post('/auth/v1/token?grant_type=password', { email, password })).ok).toBe(false);
}, 25000);

it('signs in with a magic link without creating a new account', async () => {
  const { verifier, challenge } = pkce();
  const email = 'vlasnik.a@apartclean.test';
  const response = await post('/auth/v1/otp?redirect_to=' + encodeURIComponent(callback), {
    email,
    create_user: false,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  expect(response.ok, await response.text()).toBe(true);
  const session = await followEmail(email, verifier);
  expect(session.user.email).toBe(email);
}, 15000);

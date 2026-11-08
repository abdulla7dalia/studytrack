import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

async function fixture() {
  const rows = new Map();
  let user = { id: 'account-one' };
  const context = vm.createContext({ Response, URL, JSON, Number });
  const fields = { userId: 'user_id', username: 'username', grade: 'grade', age: 'age' };
  const db = {
    select: () => ({ from: () => ({ where: async (id) => {
      const row = rows.get(id);
      return row ? [{ username: row.username, grade: row.grade, age: row.age }] : [];
    } }) }),
    insert: () => ({ values: (row) => ({ onConflictDoNothing: () => ({ returning: async () => {
      if (rows.has(row.userId)) return [];
      rows.set(row.userId, row);
      return [{ userId: row.userId }];
    } }) }) })
  };
  const imports = {
    '@netlify/identity': { getUser: async () => user },
    'drizzle-orm': { eq: (_field, id) => id },
    '../../db/index.js': { db }, '../../db/schema.js': { accountProfiles: fields }
  };
  const module = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync('netlify/functions/profile.mts', 'utf8')), { context });
  await module.link((name) => {
    const values = imports[name];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const request = (method = 'GET', body, origin = 'https://example.test') => module.namespace.default(new Request('https://example.test/api/profile', {
    method, headers: { Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
  return { request, rows, setUser: (value) => { user = value; } };
}
const profile = { username: '  دلشاد  ', grade: '12', age: 17 };

test('profile saves immediately once and is readable after a new request', async () => {
  const f = await fixture();
  assert.equal((await (await f.request()).json()).profile, null);
  const saved = await f.request('POST', { ...profile, userId: 'spoofed-account' });
  assert.equal(saved.status, 201);
  assert.deepEqual((await saved.json()).profile, { username: 'دلشاد', grade: '12', age: 17 });
  assert.equal(f.rows.has('spoofed-account'), false);
  assert.equal((await (await f.request()).json()).profile.age, 17);
  assert.equal((await f.request('POST', { ...profile, age: 18 })).status, 409);
  assert.equal((await (await f.request()).json()).profile.age, 17);
});
test('simultaneous saves create exactly one immutable profile', async () => {
  const f = await fixture();
  const responses = await Promise.all([f.request('POST', profile), f.request('POST', { ...profile, username: 'Second' })]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(f.rows.size, 1);
  assert.equal((await f.request('PUT', profile)).status, 405);
  assert.equal((await f.request('DELETE')).status, 405);
});
test('profile data stays private to each signed-in account', async () => {
  const f = await fixture();
  await f.request('POST', profile);
  f.setUser({ id: 'account-two' });
  assert.equal((await (await f.request()).json()).profile, null);
  f.setUser(null);
  assert.equal((await f.request()).status, 401);
  assert.equal((await f.request('POST', profile)).status, 401);
});
test('rejects cross-origin saves and invalid profile fields', async () => {
  const f = await fixture();
  assert.equal((await f.request('POST', profile, 'https://different.test')).status, 403);
  for (const value of [null, { ...profile, username: ' ' }, { ...profile, username: 'a'.repeat(33) }, { ...profile, grade: '' }, { ...profile, grade: 'a'.repeat(41) }, { ...profile, age: 0 }, { ...profile, age: 121 }, { ...profile, age: 17.5 }, { ...profile, age: '17' }]) {
    assert.equal((await f.request('POST', value)).status, 400);
  }
  assert.equal(f.rows.size, 0);
});

async function clientFixture(fetch) {
  const nodes = new Map();
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', hidden: false, disabled: false, listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      reset() {}, reportValidity() { return true; }, focus() {}
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({ document: { querySelector: get }, fetch, AbortSignal, Number, String });
  const module = new vm.SourceTextModule(readFileSync('profile.js', 'utf8'), { context });
  await module.link(() => {}); await module.evaluate();
  return { get, load: module.namespace.loadProfile };
}
test('profile form appears once and changes to saved details after successful save', async () => {
  const f = await clientFixture(async (_url, options) => Response.json(options?.method === 'POST'
    ? { profile: { username: 'Student', grade: '12', age: 17 } } : { profile: null }));
  await f.load({ id: 'account-one' });
  assert.equal(f.get('#profileForm').hidden, false);
  f.get('#profileUsername').value = 'Student'; f.get('#profileGrade').value = '12'; f.get('#profileAge').value = '17';
  await f.get('#profileForm').listeners.submit({ preventDefault() {} });
  assert.equal(f.get('#profileForm').hidden, true);
  assert.equal(f.get('#profileSaved').hidden, false);
  assert.equal(f.get('#profileUsernameValue').textContent, 'Student');
  assert.equal(f.get('#profileStatus').textContent, 'Saved');
  await f.load(null);
  assert.equal(f.get('#profileSection').hidden, true);
  assert.equal(f.get('#profileUsernameValue').textContent, '');
});
test('late profile responses cannot reveal a previous account after sign-out', async () => {
  let complete;
  const f = await clientFixture(() => new Promise((resolve) => { complete = resolve; }));
  const pending = f.load({ id: 'account-one' });
  await f.load(null);
  complete(Response.json({ profile: { username: 'Previous', grade: '12', age: 17 } }));
  await pending;
  assert.equal(f.get('#profileSection').hidden, true);
  assert.equal(f.get('#profileUsernameValue').textContent, '');
});
test('profile load failure offers retry and never exposes the unsaved form', async () => {
  const f = await clientFixture(async () => Response.json({ error: 'Please retry.' }, { status: 503 }));
  await f.load({ id: 'account-one' });
  assert.equal(f.get('#profileForm').hidden, true);
  assert.equal(f.get('#profileRetry').hidden, false);
});

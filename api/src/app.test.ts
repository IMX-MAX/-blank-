import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, jwtVerify } from 'jose';
import { createApp } from './app';
import { pgliteDb } from './pglite-db';
import { SCHEMA_SQL } from './schema';
import { memoryStore } from './stores';

async function setup() {
  const pg = new PGlite();
  await pg.exec(SCHEMA_SQL);
  const store = memoryStore();
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'EdDSA' }] });
  const app = createApp({
    db: pgliteDb(pg),
    store,
    verify: async (token) => {
      try {
        const { payload } = await jwtVerify(token, jwks);
        return payload.sub ? { userId: payload.sub } : null;
      } catch {
        return null;
      }
    },
  });
  const tokenFor = (sub: string) =>
    new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setSubject(sub).setExpirationTime('5m').sign(privateKey);
  const call = async (token: string | null, method: string, path: string, body?: unknown, raw?: { bytes: Uint8Array; type: string }) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers['content-type'] = raw.type;
      payload = raw.bytes as unknown as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    return app.request(path, { method, headers, body: payload });
  };
  return { call, store, tokenFor };
}

test('auth is required and owners are isolated', async () => {
  const { call, tokenFor } = await setup();
  assert.equal((await call(null, 'GET', '/library')).status, 401);
  assert.equal((await call('junk', 'GET', '/library')).status, 401);
  const a = await tokenFor('user-a');
  const b = await tokenFor('user-b');
  const created = await call(a, 'POST', '/albums', { name: 'Mine', kind: 'album' });
  assert.equal(created.status, 201);
  const mine = (await (await call(a, 'GET', '/library')).json()) as { albums: unknown[] };
  const theirs = (await (await call(b, 'GET', '/library')).json()) as { albums: unknown[] };
  assert.equal(mine.albums.length, 1);
  assert.equal(theirs.albums.length, 0);
});

test('upload, track, playlist and delete flow', async () => {
  const { call, store, tokenFor } = await setup();
  const t = await tokenFor('user-a');
  const album = (await (await call(t, 'POST', '/albums', { name: 'Rec', artist: 'Me', kind: 'album' })).json()) as { id: string };
  const audio = new Uint8Array([1, 2, 3, 4]);
  const init = await call(t, 'POST', '/files/audio', { contentType: 'audio/mpeg' });
  assert.equal(init.status, 201);
  const { fileId, uploadUrl } = (await init.json()) as { fileId: string; uploadUrl: string | null };
  assert.equal(uploadUrl, null);
  assert.equal((await call(t, 'POST', '/tracks', { title: 'x', albumId: album.id, audioFileId: fileId })).status, 400);
  assert.equal((await call(t, 'PUT', `/files/audio/${fileId}`, undefined, { bytes: audio, type: 'audio/mpeg' })).status, 200);
  const track = await call(t, 'POST', '/tracks', { title: 'One', artist: 'Me', albumId: album.id, audioFileId: fileId, durationMs: 1000 });
  assert.equal(track.status, 201);
  const trackRow = (await track.json()) as { id: string };

  const file = await call(t, 'GET', `/files/audio/${fileId}`);
  assert.equal(file.status, 200);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio);
  assert.equal((await call(await tokenFor('user-b'), 'GET', `/files/audio/${fileId}`)).status, 404);

  const pl = (await (await call(t, 'POST', '/albums', { name: 'List', kind: 'playlist' })).json()) as { id: string };
  assert.equal((await call(t, 'POST', `/playlists/${pl.id}/tracks`, { trackIds: [trackRow.id] })).status, 201);
  let lib = (await (await call(t, 'GET', '/library')).json()) as { playlistTracks: unknown[]; tracks: unknown[] };
  assert.equal(lib.playlistTracks.length, 1);

  const cover = await call(t, 'PUT', `/albums/${album.id}/cover`, undefined, { bytes: new Uint8Array([9, 9]), type: 'image/png' });
  assert.equal(cover.status, 200);
  assert.equal(store.keys().length, 2);

  assert.equal((await call(t, 'DELETE', `/albums/${album.id}`)).status, 200);
  lib = (await (await call(t, 'GET', '/library')).json()) as { playlistTracks: unknown[]; tracks: unknown[] };
  assert.equal(lib.tracks.length, 0);
  assert.equal(lib.playlistTracks.length, 0);
  assert.equal(store.keys().length, 0);
});

test('rejects bad input', async () => {
  const { call, tokenFor } = await setup();
  const t = await tokenFor('user-a');
  assert.equal((await call(t, 'POST', '/albums', { name: '', kind: 'album' })).status, 400);
  assert.equal((await call(t, 'PUT', '/albums/not-a-uuid/cover', undefined, { bytes: new Uint8Array([1]), type: 'image/png' })).status, 400);
  assert.equal((await call(t, 'POST', '/files/audio', { contentType: 'text/html' })).status, 415);
});

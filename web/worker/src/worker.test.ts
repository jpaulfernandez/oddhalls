import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';
import { handle } from './app.js';
import {
  ACTIVITY_LIMIT,
  ActivityResponseSchema,
  EventResponseSchema,
  LikesResponseSchema,
  LikeToggleResponseSchema,
  likeKey,
  PICK_NOTE_MAX,
  PICKS_MAX,
  PickAlreadySentSchema,
  PickResponseSchema,
  PicksResponseSchema,
  SOCIAL_API_VERSION,
  socialRoutes,
} from './contracts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-admin-token';
const DEVICE_A = 'device-aaaaaaaa';
const DEVICE_B = 'device-bbbbbbbb';

let worker: Unstable_DevWorker;
let persistTo: string;

const post = (path: string, body: unknown, init: Parameters<Unstable_DevWorker['fetch']>[1] = {}) =>
  worker.fetch(path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...init });
const admin = (bookId: string, token: string | null = TOKEN) =>
  worker.fetch(socialRoutes.adminActivity(bookId), token ? { headers: { Authorization: `Bearer ${token}` } } : {});

const seedR2 = (key: string, content: string) => {
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'r2', 'object', 'put', `photobook/${key}`, '--local', '--persist-to', persistTo, '--pipe'],
    { cwd: root, input: content, stdio: ['pipe', 'pipe', 'pipe'] },
  );
};

const like = (bookId: string, targetId: string, deviceId: string, liked: boolean, displayName: string | null = null) =>
  post(socialRoutes.like, { bookId, targetType: 'photo', targetId, deviceId, displayName, liked });

beforeAll(async () => {
  persistTo = mkdtempSync(join(tmpdir(), 'photobook-worker-test-'));
  execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'photobook-social', '--local', '--persist-to', persistTo],
    { cwd: root, stdio: 'pipe' },
  );

  seedR2(
    'books/listed-book/manifest.json',
    JSON.stringify({
      title: 'Summer & <Autumn> "Trip"',
      slug: 'listed-book',
      listed: true,
      cover: 'https://cdn.example.com/books/listed-book/pages/hash-cover.jpg',
      pages: [{}, {}, {}],
      images: { a1: { share: 'https://cdn.example.com/books/listed-book/share.jpg' } },
    }),
  );
  seedR2(
    'books/unlisted-book/manifest.json',
    JSON.stringify({
      title: 'Secret Trip',
      slug: 'unlisted-book',
      listed: false,
      cover: 'https://cdn.example.com/books/unlisted-book/pages/hash-cover.jpg',
      pages: [{}, {}],
      images: { a1: { share: 'https://cdn.example.com/books/unlisted-book/share.jpg' } },
    }),
  );
  seedR2(
    'books/password-book/manifest.json',
    JSON.stringify({
      title: 'Family Archive',
      slug: 'password-book',
      listed: true,
      password: { version: 1, salt: 's', hash: 'h' },
      pages: [{}, {}, {}, {}],
      images: { a1: { share: 'https://cdn.example.com/books/password-book/secret-photo.jpg' } },
    }),
  );
  seedR2(
    'site.json',
    JSON.stringify({
      viewer: 'https://viewer.example.com',
      books: [
        {
          slug: 'listed-book',
          title: 'Summer & <Autumn> "Trip"',
          cover: 'https://cdn.example.com/books/listed-book/pages/hash-cover.jpg',
          pages: 3,
          publishedAt: '2026-10-10T12:00:00Z',
          locked: false,
        },
        {
          slug: 'password-book',
          title: 'Family Archive',
          cover: null,
          pages: 4,
          publishedAt: '2026-10-12T12:00:00Z',
          locked: true,
        },
      ],
    }),
  );

  worker = await unstable_dev(join(root, 'src/index.ts'), {
    config: join(root, 'wrangler.toml'),
    persistTo,
    vars: { ADMIN_TOKEN: TOKEN },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
    logLevel: 'error',
    local: true,
  });
});

afterAll(async () => {
  await worker?.stop();
  if (persistTo) rmSync(persistTo, { recursive: true, force: true });
});

describe('basics', () => {
  it('reports health with CORS and no-store', async () => {
    const res = await worker.fetch(socialRoutes.health);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: SOCIAL_API_VERSION, preview: true });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers preflight', async () => {
    const res = await worker.fetch(socialRoutes.like, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('404s unknown routes as JSON with CORS', async () => {
    const res = await worker.fetch('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects invalid JSON, schema failures and oversized bodies with 400/413', async () => {
    const bad = await post(socialRoutes.like, '{nope');
    expect(bad.status).toBe(400);
    const schema = await post(socialRoutes.like, { bookId: 'b', targetType: 'photo', targetId: 'x', liked: true });
    expect(schema.status).toBe(400);
    expect(await schema.json()).toHaveProperty('error');
    const big = await post(socialRoutes.events, JSON.stringify({ pad: 'x'.repeat(70 * 1024) }));
    expect(big.status).toBe(413);
  });
});

describe('likes', () => {
  const book = 'likes-book';

  it('toggles idempotently and counts per device', async () => {
    let res = await like(book, 'a1', DEVICE_A, true, 'Ana');
    expect(LikeToggleResponseSchema.parse(await res.json())).toEqual({ liked: true, count: 1 });
    res = await like(book, 'a1', DEVICE_A, true);
    expect(await res.json()).toEqual({ liked: true, count: 1 });
    res = await like(book, 'a1', DEVICE_B, true, 'Ben');
    expect(await res.json()).toEqual({ liked: true, count: 2 });
    await post(socialRoutes.like, {
      bookId: book,
      targetType: 'page',
      targetId: 'p1',
      deviceId: DEVICE_A,
      liked: true,
    });

    const list = LikesResponseSchema.parse(
      await (await worker.fetch(`${socialRoutes.likes(book)}?device=${DEVICE_A}`)).json(),
    );
    expect(list.counts).toEqual({ [likeKey('photo', 'a1')]: 2, [likeKey('page', 'p1')]: 1 });
    expect([...list.mine].sort()).toEqual([likeKey('page', 'p1'), likeKey('photo', 'a1')]);

    const other = LikesResponseSchema.parse(
      await (await worker.fetch(`${socialRoutes.likes(book)}?device=${DEVICE_B}`)).json(),
    );
    expect(other.mine).toEqual([likeKey('photo', 'a1')]);

    res = await like(book, 'a1', DEVICE_A, false);
    expect(await res.json()).toEqual({ liked: false, count: 1 });
    res = await like(book, 'a1', DEVICE_A, false);
    expect(await res.json()).toEqual({ liked: false, count: 1 });
  });

  it('returns empty mine for a missing or invalid device and isolates books', async () => {
    for (const q of ['', '?device=x', '?device=has space!!!!']) {
      const res = await worker.fetch(`${socialRoutes.likes(book)}${q}`);
      expect(res.status).toBe(200);
      const parsed = LikesResponseSchema.parse(await res.json());
      expect(parsed.mine).toEqual([]);
      expect(parsed.counts[likeKey('photo', 'a1')]).toBe(1);
    }
    const empty = LikesResponseSchema.parse(await (await worker.fetch(socialRoutes.likes('another-book'))).json());
    expect(empty).toEqual({ counts: {}, mine: [] });
  });
});

describe('events and admin activity', () => {
  const book = 'events-book';
  const base = { bookId: book, displayName: 'Ana', deviceId: DEVICE_A };

  it('requires the admin bearer token', async () => {
    expect((await admin(book, null)).status).toBe(401);
    expect((await admin(book, 'wrong')).status).toBe(401);
    expect((await admin(book, `${TOKEN}x`)).status).toBe(401);
    const noAuthHeader = await worker.fetch(socialRoutes.adminActivity(book), { headers: { Authorization: TOKEN } });
    expect(noAuthHeader.status).toBe(401);
  });

  it('logs events and returns them newest first with collection ids parsed', async () => {
    const photo = await post(socialRoutes.events, {
      ...base,
      targetType: 'photo',
      targetId: 'a1',
      action: 'download',
      pageId: 'p1',
    });
    expect(photo.status).toBeLessThan(300);
    const photoId = EventResponseSchema.parse(await photo.json()).id;
    await new Promise((r) => setTimeout(r, 5));
    const zip = await post(socialRoutes.events, {
      ...base,
      targetType: 'collection',
      targetId: ['a1', 'a2', 'a3'],
      action: 'zip',
    });
    const zipId = EventResponseSchema.parse(await zip.json()).id;
    expect(zipId).not.toBe(photoId);
    await like(book, 'a1', DEVICE_B, true, 'Ben');

    const res = await admin(book);
    expect(res.status).toBe(200);
    const activity = ActivityResponseSchema.parse(await res.json());
    expect(activity.bookId).toBe(book);
    expect(activity.truncated).toBe(false);
    expect(activity.events.map((e) => e.id)).toEqual([zipId, photoId]);
    expect(activity.events[0]).toMatchObject({ targetType: 'collection', targetId: ['a1', 'a2', 'a3'], pageId: null });
    expect(activity.events[1]).toMatchObject({ targetType: 'photo', targetId: 'a1', pageId: 'p1', displayName: 'Ana' });
    expect(activity.likes).toHaveLength(1);
    expect(activity.likes[0]).toMatchObject({
      targetType: 'photo',
      targetId: 'a1',
      deviceId: DEVICE_B,
      displayName: 'Ben',
    });
  });

  it('rejects invalid events', async () => {
    const noName = await post(socialRoutes.events, {
      ...base,
      displayName: '',
      targetType: 'photo',
      targetId: 'a',
      action: 'download',
    });
    expect(noName.status).toBe(400);
    const badAction = await post(socialRoutes.events, { ...base, targetType: 'photo', targetId: 'a', action: 'steal' });
    expect(badAction.status).toBe(400);
    const arrayOnPhoto = await post(socialRoutes.events, {
      ...base,
      targetType: 'photo',
      targetId: ['a', 'b'],
      action: 'download',
    });
    expect(arrayOnPhoto.status).toBe(400);
  });

  it('exposes the cap the contract promises', () => {
    expect(ACTIVITY_LIMIT).toBeGreaterThan(0);
  });
});

describe('friends picks (plan 72)', () => {
  const book = 'picks-book';
  const adminPicks = (bookId: string, token: string | null = TOKEN) =>
    worker.fetch(socialRoutes.adminPicks(bookId), token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  const send = (bookId: string, deviceId: string, extra: Record<string, unknown> = {}) =>
    post(socialRoutes.picks, {
      bookId,
      deviceId,
      displayName: 'Mia',
      assetIds: ['a3', 'a1', 'a2'],
      note: ' Loved these ',
      ...extra,
    });

  it('round trips: 201 with sentAt, then the admin route returns the pick in order', async () => {
    const res = await send(book, DEVICE_A);
    expect(res.status).toBe(201);
    const { sentAt } = PickResponseSchema.parse(await res.json());

    const list = PicksResponseSchema.parse(await (await adminPicks(book)).json());
    expect(list.bookId).toBe(book);
    expect(list.picks).toEqual([
      { deviceId: DEVICE_A, displayName: 'Mia', assetIds: ['a3', 'a1', 'a2'], note: 'Loved these', sentAt },
    ]);
  });

  it('requires the admin bearer token on the read, and has no public read', async () => {
    for (const token of [null, 'wrong', `${TOKEN}x`]) {
      const res = await adminPicks(book, token);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
    }
    expect((await worker.fetch(socialRoutes.picks)).status).toBe(405);
    expect((await worker.fetch(`/v1/books/${book}/picks`)).status).toBe(404);
  });

  it('locks a device after its first send: 409 with the first time, the row unchanged', async () => {
    const first = PicksResponseSchema.parse(await (await adminPicks(book)).json()).picks[0];
    await new Promise((r) => setTimeout(r, 5));
    const again = await send(book, DEVICE_A, { displayName: 'Other', assetIds: ['z9'], note: 'changed' });
    expect(again.status).toBe(409);
    expect(PickAlreadySentSchema.parse(await again.json()).sentAt).toBe(first?.sentAt);
    const after = PicksResponseSchema.parse(await (await adminPicks(book)).json());
    expect(after.picks).toEqual([first]);
  });

  it('keeps devices and books separate', async () => {
    expect((await send(book, DEVICE_B, { displayName: 'Tom', assetIds: ['a1'] })).status).toBe(201);
    expect((await send('other-picks-book', DEVICE_A)).status).toBe(201);
    const list = PicksResponseSchema.parse(await (await adminPicks(book)).json());
    expect(list.picks.map((p) => p.displayName)).toEqual(['Mia', 'Tom']);
    const other = PicksResponseSchema.parse(await (await adminPicks('other-picks-book')).json());
    expect(other.picks).toHaveLength(1);
    const none = PicksResponseSchema.parse(await (await adminPicks('no-picks-book')).json());
    expect(none.picks).toEqual([]);
  });

  it('validates: bad JSON, no name, no ids, over 500 ids, a long note, an oversized body', async () => {
    const vbook = 'picks-validation';
    expect((await post(socialRoutes.picks, '{nope')).status).toBe(400);
    expect((await send(vbook, DEVICE_A, { displayName: '' })).status).toBe(400);
    expect((await send(vbook, DEVICE_A, { assetIds: [] })).status).toBe(400);
    const tooMany = Array.from({ length: PICKS_MAX + 1 }, (_, i) => `asset-${i}`);
    expect((await send(vbook, DEVICE_A, { assetIds: tooMany })).status).toBe(400);
    expect((await send(vbook, DEVICE_A, { note: 'x'.repeat(PICK_NOTE_MAX + 1) })).status).toBe(400);
    expect((await post(socialRoutes.picks, JSON.stringify({ pad: 'x'.repeat(70 * 1024) }))).status).toBe(413);
    // None of the rejected sends locked the device.
    expect((await send(vbook, DEVICE_A)).status).toBe(201);
    const preflight = await worker.fetch(socialRoutes.picks, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
  });

  it('plan 124: refuses more ids than a client preview cap, without locking the device', async () => {
    const cbook = 'picks-cap';
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `asset-${i}`);
    expect((await send(cbook, DEVICE_A, { assetIds: ids(21), cap: 20 })).status).toBe(400);
    expect((await send(cbook, DEVICE_A, { assetIds: ids(20), cap: 20 })).status).toBe(201);
  });
});

describe('link preview cards and feed', () => {
  it('serves full card for a listed book with summary_large_image, escaped title, and redirect', async () => {
    const res = await worker.fetch(socialRoutes.preview('listed-book'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');

    const html = await res.text();
    // Escaped title in title tag and og:title
    expect(html).toContain('<title id="doc-title">Summer &amp; &lt;Autumn&gt; "Trip"</title>');
    expect(html).toContain('property="og:title" content="Summer & <Autumn> &quot;Trip&quot;"');
    expect(html).toContain('name="twitter:title" content="Summer & <Autumn> &quot;Trip&quot;"');

    // Description: page count, no likes, downloads or visitor count
    const descMatch = /property="og:description" content="([^"]+)"/.exec(html);
    expect(descMatch?.[1]).toBe('A photo book · 3 pages');
    expect(descMatch?.[1]).not.toMatch(/like|download|visitor|view|count/i);

    // Image: full cover image and summary_large_image
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(
      'property="og:image" content="https://cdn.example.com/books/listed-book/pages/hash-cover.jpg"',
    );
    expect(html).toContain(
      'name="twitter:image" content="https://cdn.example.com/books/listed-book/pages/hash-cover.jpg"',
    );

    // Site name and canonical redirect
    expect(html).toContain('property="og:site_name" content="Photobook"');
    expect(html).toContain('property="og:url" content="http://placeholder/b/listed-book"');
    expect(html).toContain('<link id="canonical-link" rel="canonical" href="https://viewer.example.com/listed-book">');
    expect(html).toContain(
      '<meta id="refresh-meta" http-equiv="refresh" content="0; url=https://viewer.example.com/listed-book">',
    );
    expect(html).toContain('location.replace("https://viewer.example.com/listed-book")');
    expect(html).toContain('<link rel="alternate" type="application/atom+xml" title="Feed" href="/feed.xml">');

    // Listed book has no noindex tag
    expect(html).not.toContain('content="noindex"');
  });

  it('serves card for unlisted book with full image and noindex meta tag', async () => {
    const res = await worker.fetch(socialRoutes.preview('unlisted-book'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('content="noindex"');
    expect(html).toContain(
      'property="og:image" content="https://cdn.example.com/books/unlisted-book/pages/hash-cover.jpg"',
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('serves card for password book with title only, summary card, and NO image or photo URLs', async () => {
    const res = await worker.fetch(socialRoutes.preview('password-book'));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('property="og:title" content="Family Archive"');
    const descMatch = /property="og:description" content="([^"]+)"/.exec(html);
    expect(descMatch?.[1]).toBe('A protected photo book');
    expect(descMatch?.[1]).not.toMatch(/like|download|visitor|view|count/i);
    expect(html).toContain('name="twitter:card" content="summary"');

    // No og:image, no twitter:image, no cover or photo URL anywhere in the body
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
    expect(html).not.toContain('secret-photo.jpg');
    expect(html).not.toContain('hash-cover.jpg');
  });

  it('answers 404 with plain HTML page for unknown slug', async () => {
    const res = await worker.fetch(socialRoutes.preview('nonexistent-book'));
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('Not found');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('twitter:');
  });

  it('answers 404 on preview and feed and reports preview: false when BOOKS binding is missing', async () => {
    const fakeEnv = { DB: {} as D1Database, ADMIN_TOKEN: 'token' };

    const health = await handle(new Request('http://localhost/v1/health'), fakeEnv);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: SOCIAL_API_VERSION, preview: false });

    const card = await handle(new Request('http://localhost/b/listed-book'), fakeEnv);
    expect(card.status).toBe(404);

    const feed = await handle(new Request('http://localhost/feed.xml'), fakeEnv);
    expect(feed.status).toBe(404);
  });

  it('serves Atom feed with listed books newest first and no img for locked books', async () => {
    const res = await worker.fetch(socialRoutes.feed);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/atom+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');

    const xmlText = await res.text();
    expect(xmlText).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xmlText).toContain('<title>Photobook</title>');
    expect(xmlText).toMatch(/<link rel="self" href="https?:\/\/[^/]+\/feed\.xml" \/>/);
    expect(xmlText).toContain('<updated>2026-10-12T12:00:00Z</updated>');

    // Entry 1 is password-book (published 2026-10-12)
    // Entry 2 is listed-book (published 2026-10-10)
    const passwordIndex = xmlText.indexOf('Family Archive');
    const listedIndex = xmlText.indexOf('Summer &amp; &lt;Autumn&gt; &quot;Trip&quot;');
    expect(passwordIndex).toBeGreaterThan(-1);
    expect(listedIndex).toBeGreaterThan(-1);
    expect(passwordIndex).toBeLessThan(listedIndex);

    // Password book (locked) entry has NO <img> tag
    const passwordSection = xmlText.slice(passwordIndex, listedIndex);
    expect(passwordSection).not.toContain('<img');
    expect(passwordSection).toContain('<summary>4 pages</summary>');

    // Listed book entry has <img> in content
    const listedSection = xmlText.slice(listedIndex);
    expect(listedSection).toContain(
      '<content type="html">&lt;img src="https://cdn.example.com/books/listed-book/pages/hash-cover.jpg" alt="Summer &amp; &lt;Autumn&gt; &quot;Trip&quot;" /&gt;</content>',
    );
    expect(listedSection).toContain('<summary>3 pages</summary>');
  });
});

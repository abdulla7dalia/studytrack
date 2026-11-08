import { getUser } from '@netlify/identity';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { trackerData } from '../../db/schema.js';

export default async (req: Request) => {
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'PUT'].includes(req.method)) return reply({ error: 'Method not allowed' }, 405);
  if (req.method === 'PUT' && req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin' }, 403);
  const user = await getUser();
  if (!user) return reply({ error: 'Please sign in again.' }, 401);
  try {
    if (req.method === 'GET') {
      const [row] = await db.select().from(trackerData).where(eq(trackerData.userId, user.id));
      return reply({ data: row?.data ?? null, version: row?.updatedAt.toISOString() ?? null });
    }
    const raw = await req.text();
    if (raw.length > 1000000) return reply({ error: 'Your tracking history is too large to save.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid data' }, 400); }
    const d = body.data;
    if (!d || !Array.isArray(d.sessions) || d.sessions.length > 10000 || !d.settings ||
        !Array.isArray(d.settings.subjects) || d.settings.subjects.length < 1 || d.settings.subjects.length > 100 ||
        !d.settings.subjects.every((s: any) => typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 24 && Number.isInteger(s.color) && s.color >= 0 && s.color < 8) ||
        !Number.isFinite(d.settings.goalMin) || d.settings.goalMin < 30 || d.settings.goalMin > 960 ||
        !d.sessions.every((s: any) => typeof s.id === 'string' && typeof s.subject === 'string' && s.subject.length <= 24 && Number.isFinite(s.durationSec) && s.durationSec > 0 && Number.isFinite(s.endedAt) && typeof s.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.day) && ['manual', 'stopwatch', 'pomodoro'].includes(s.mode))) return reply({ error: 'Invalid tracking data' }, 400);
    if (d.settings.adhkar !== undefined) {
      const items = d.settings.adhkar;
      if (!Array.isArray(items) || items.length > 100 ||
          !items.every((a: any) => a && typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 80 &&
            typeof a.text === 'string' && a.text.trim().length > 0 && a.text.length <= 2000 &&
            typeof a.meaning === 'string' && a.meaning.length <= 2000 &&
            typeof a.reference === 'string' && a.reference.length <= 500) ||
          new Set(items.map((a: any) => a.id)).size !== items.length) {
        return reply({ error: 'Invalid adhkar data' }, 400);
      }
      d.settings.adhkar = items.map((a: any) => ({ id: a.id, text: a.text.trim(), meaning: a.meaning, reference: a.reference }));
    }
    if (d.timer !== undefined) {
      const t = d.timer;
      if (!t || !['stopwatch', 'pomodoro'].includes(t.mode) || !['focus', 'break'].includes(t.phase) ||
          typeof t.running !== 'boolean' || !Number.isFinite(t.accMs) || t.accMs < 0 ||
          !Number.isFinite(t.startedAt) || t.startedAt < 0 ||
          typeof t.subject !== 'string' || t.subject.length > 24 || ![25, 50].includes(t.pomoMin)) {
        return reply({ error: 'Invalid timer data' }, 400);
      }
      d.timer = { mode: t.mode, phase: t.phase, running: t.running, accMs: t.accMs,
        startedAt: t.startedAt, subject: t.subject, pomoMin: t.pomoMin };
    }
    const now = new Date();
    let saved;
    if (body.version === null) {
      [saved] = await db.insert(trackerData).values({ userId: user.id, data: d, updatedAt: now }).onConflictDoNothing().returning();
    } else {
      const { and } = await import('drizzle-orm');
      const version = new Date(body.version);
      if (Number.isNaN(version.getTime())) return reply({ error: 'Invalid version' }, 400);
      [saved] = await db.update(trackerData).set({ data: d, updatedAt: now }).where(and(eq(trackerData.userId, user.id), eq(trackerData.updatedAt, version))).returning();
    }
    if (!saved) return reply({ error: 'Your data changed on another device. Reload before making more changes.' }, 409);
    return reply({ version: now.toISOString() });
  } catch { return reply({ error: 'Could not reach your saved data. Please try again.' }, 503); }
};
export const config = { path: '/api/tracker' };

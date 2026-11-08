import { getUser } from '@netlify/identity';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { accountProfiles } from '../../db/schema.js';

export default async (req: Request) => {
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!['GET', 'POST'].includes(req.method)) return reply({ error: 'Method not allowed' }, 405);
  if (req.method === 'POST' && req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin' }, 403);
  try {
    const user = await getUser();
    if (!user) return reply({ error: 'Please sign in.' }, 401);
    const read = async () => {
      const [row] = await db.select({ username: accountProfiles.username, grade: accountProfiles.grade, age: accountProfiles.age })
        .from(accountProfiles).where(eq(accountProfiles.userId, user.id));
      return row ?? null;
    };
    if (req.method === 'GET') return reply({ profile: await read() });
    const raw = await req.text();
    if (raw.length > 2048) return reply({ error: 'Profile is too large.' }, 413);
    let value;
    try { value = JSON.parse(raw); } catch { return reply({ error: 'Invalid profile.' }, 400); }
    if (!value || typeof value.username !== 'string' || value.username.trim().length < 2 || value.username.trim().length > 32 ||
        typeof value.grade !== 'string' || value.grade.trim().length < 1 || value.grade.trim().length > 40 ||
        !Number.isInteger(value.age) || value.age < 1 || value.age > 120) {
      return reply({ error: 'Enter a username (2–32 characters), grade, and age (1–120).' }, 400);
    }
    const profile = { username: value.username.trim(), grade: value.grade.trim(), age: value.age };
    // The account primary key makes first-save-only atomic, even across tabs.
    const [saved] = await db.insert(accountProfiles).values({ userId: user.id, ...profile }).onConflictDoNothing().returning({ userId: accountProfiles.userId });
    if (!saved) return reply({ error: 'Your profile has already been saved.', profile: await read() }, 409);
    return reply({ profile }, 201);
  } catch { return reply({ error: 'Could not load or save your profile. Please retry.' }, 503); }
};
export const config = { path: '/api/profile' };

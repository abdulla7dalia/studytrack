/** Read the Hawler row only; never substitute a different city's timetable. */
export function parseErbilTimetable(html: string) {
  const text = (value: string) => value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const table = html.match(/<table\b[^>]*\bid\s*=\s*["']bang["'][^>]*>([\s\S]*?)<\/table\s*>/i)?.[1];
  if (!table) throw new Error('Timetable missing');
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
    .map((row) => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((cell) => text(cell[1])))
    .filter((cells) => cells[0] === 'هەولێر');
  if (rows.length !== 1) throw new Error('Hawler row missing or ambiguous');
  const values = rows[0].slice(1).filter(Boolean);
  const names = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  if (values.length !== names.length) throw new Error('Incomplete timetable');
  let previous = -1;
  return Object.fromEntries(names.map((name, index) => {
    const value = values[index].replace(/[٠-٩۰-۹]/g, (digit) => String(
      digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660)));
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new Error('Invalid prayer time');
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) throw new Error('Invalid prayer time');
    // The source uses a 12-hour clock without period markers.
    // Dawn/sunrise are AM; Dhuhr can be before noon or at/after noon.
    const pm = index >= 3 || (index === 2 && (hour === 12 || hour < 6));
    hour = hour % 12 + (pm ? 12 : 0);
    const minutes = hour * 60 + minute;
    if (minutes <= previous) throw new Error('Prayer times out of order');
    previous = minutes;
    return [name, `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`];
  }));
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  try {
    const source = 'https://ba8.org/KatiBang';
    const response = await fetch(source, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error('Source unavailable');
    const html = await response.text();
    if (html.length > 2000000) throw new Error('Unexpected source response');
    const timings = parseErbilTimetable(html);
    return Response.json({ timings, source, city: 'هەولێر', fetchedAt: new Date().toISOString() }, { headers });
  } catch {
    return Response.json({ error: 'The Hawler timetable on ba8.org could not be loaded. Please retry or check the source page.' }, { status: 502, headers });
  }
};
export const config = { path: '/api/prayer-times' };

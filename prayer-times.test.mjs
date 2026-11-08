import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler, { parseErbilTimetable } from '../netlify/functions/prayer-times.mts';

function row(city, times) {
  return `<tr><td class="location">${city}</td>${times.map((time) => `<td><b>${time}</b></td>`).join('')}<td> </td></tr>`;
}
const times = ['٥:١٣', '٦:٣٦', '١١:٥٦', '٢:٤٤', '٥:٠٩', '٦:٢٤'];
const html = `<table id="bang">${row('سلێمانی', ['5:03', '6:25', '11:48', '2:38', '5:07', '6:24'])}${row('هەولێر', times)}</table>`;

test('selects Hawler and converts its Arabic-digit 12-hour times correctly', () => {
  assert.deepEqual(parseErbilTimetable(html), {
    Fajr: '05:13', Sunrise: '06:36', Dhuhr: '11:56', Asr: '14:44', Maghrib: '17:09', Isha: '18:24'
  });
});
test('handles noon, summer Dhuhr, and Persian digits', () => {
  for (const [dhuhr, expected] of [['۱۲:۰۱', '12:01'], ['۱:۰۷', '13:07']]) {
    assert.equal(parseErbilTimetable(`<table id='bang'>${row('هەولێر', ['۵:۱۳', '۶:۳۶', dhuhr, '۲:۴۴', '۵:۰۹', '۶:۲۴'])}</table>`).Dhuhr, expected);
  }
});
test('rejects missing, duplicate, incomplete, invalid, and unordered timetable rows', () => {
  for (const invalid of [
    '<p>Unavailable</p>',
    `<table id="bang">${row('سلێمانی', times)}</table>`,
    `<table id="bang">${row('هەولێر', times)}${row('هەولێر', times)}</table>`,
    `<table id="bang">${row('هەولێر', times.slice(0, 5))}</table>`,
    html.replace('٥:١٣', '٥:٩٩'), html.replace('٥:١٣', '١٣:٠٠'),
    html.replace('٦:٣٦', '٤:٣٦')
  ]) assert.throws(() => parseErbilTimetable(invalid));
});
test('API returns sourced timings and fails visibly when the source fails', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://ba8.org/KatiBang');
      return new Response(html);
    };
    const response = await handler(new Request('https://example.test/api/prayer-times'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.city, 'هەولێر');
    assert.equal(result.timings.Asr, '14:44');
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    const failure = await handler(new Request('https://example.test/api/prayer-times'));
    assert.equal(failure.status, 502);
    assert.equal((await failure.json()).timings, undefined);
    const disallowed = await handler(new Request('https://example.test/api/prayer-times', { method: 'POST' }));
    assert.equal(disallowed.status, 405);
  } finally { globalThis.fetch = originalFetch; }
});

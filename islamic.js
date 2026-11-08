import { nextPrayer, formatRemaining } from './prayer-countdown.js';
const $ = (selector) => document.querySelector(selector);
const zone = 'Asia/Baghdad';
let prayerDay = '';
let prayerLoading = false;
let prayerFetchedAt = 0;
let prayerData = null;
let page = 1;
let readerStarted = false;
let imageRequest = 0;

function erbilNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { date: `${parts.day}-${parts.month}-${parts.year}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function renderPrayers() {
  if (!prayerData) return;
  const names = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  $('#prayerTimes').replaceChildren(...names.map((name) => {
    const card = document.createElement('div');
    card.className = 'prayer-time';
    card.dataset.prayer = name;
    const label = document.createElement('span');
    label.textContent = name;
    const time = document.createElement('strong');
    time.textContent = formatPrayerTime(prayerData[name]);
    card.append(label, time);
    return card;
  }));
  $('#prayerStatus').textContent = '';
  updatePrayerCountdown();
}

export function formatPrayerTime(time) {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function updatePrayerCountdown() {
  const clock = $('#prayerCountdown');
  if (!prayerData || prayerDay !== erbilNow().date) { clock.hidden = true; return; }
  const next = nextPrayer(prayerData);
  clock.hidden = false;
  const label = `${next.name}${next.tomorrow ? ' · Tomorrow (estimated)' : ' · Next prayer'}`;
  if ($('#nextPrayerName').textContent !== label) $('#nextPrayerName').textContent = label;
  $('#nextPrayerRemaining').textContent = formatRemaining(next.secondsLeft);
  $('#nextPrayerTime').textContent = formatPrayerTime(next.time);
  document.querySelectorAll('#prayerTimes .prayer-time').forEach((card) => {
    const highlighted = card.dataset.prayer === next.name;
    card.classList.toggle('is-next', highlighted);
    const text = card.dataset.prayer + (highlighted ? ' · Next' : '');
    if (card.firstElementChild.textContent !== text) card.firstElementChild.textContent = text;
  });
}

async function loadPrayers() {
  const now = erbilNow();
  if (prayerLoading) return;
  if (prayerDay === now.date && Date.now() - prayerFetchedAt < 5 * 60 * 1000) { renderPrayers(); return; }
  prayerLoading = true;
  prayerData = null;
  $('#prayerCountdown').hidden = true;
  $('#prayerTimes').replaceChildren();
  $('#prayerTimes').setAttribute('aria-busy', 'true');
  $('#prayerRetry').hidden = true;
  $('#prayerStatus').textContent = 'Loading today’s prayer times…';
  $('#prayerDate').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  try {
    const response = await fetch('/api/prayer-times', { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!response.ok) throw new Error('Prayer service unavailable');
    const result = await response.json();
    const timings = result.timings;
    if (result.city !== 'هەولێر' || !['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every((name) => /^\d{2}:\d{2}$/.test(timings?.[name]))) throw new Error('Invalid prayer times');
    prayerData = timings;
    prayerDay = now.date;
    prayerFetchedAt = Date.now();
    renderPrayers();
  } catch {
    $('#prayerStatus').textContent = 'The Hawler timetable from ba8.org could not load. Please retry.';
    $('#prayerRetry').hidden = false;
  } finally {
    prayerLoading = false;
    $('#prayerTimes').setAttribute('aria-busy', 'false');
  }
}

function showPage(value) {
  const requested = Number(value);
  if (!Number.isInteger(requested) || requested < 1 || requested > 604) return;
  page = requested;
  const request = ++imageRequest;
  $('#mushafPage').value = String(page);
  $('#mushafPrevious').disabled = page === 1;
  $('#mushafNext').disabled = page === 604;
  $('#mushafExternal').href = `https://quran.com/page/${page}`;
  $('#mushafStatus').textContent = `Loading page ${page}…`;
  $('#mushafPaper').setAttribute('aria-busy', 'true');
  $('#mushafImage').hidden = true;
  const nextImage = new Image();
  nextImage.alt = `Madinah mushaf, page ${page}`;
  nextImage.id = 'mushafImage';
  nextImage.decoding = 'async';
  const timeout = setTimeout(() => fail(), 20000);
  function fail() {
    if (request !== imageRequest) return;
    clearTimeout(timeout);
    nextImage.onload = null;
    nextImage.onerror = null;
    $('#mushafPaper').setAttribute('aria-busy', 'false');
    $('#mushafStatus').textContent = `Page ${page} could not load. Press Go to retry.`;
  }
  nextImage.onload = () => {
    clearTimeout(timeout);
    if (request !== imageRequest) return;
    $('#mushafImage').replaceWith(nextImage);
    $('#mushafPaper').setAttribute('aria-busy', 'false');
    $('#mushafStatus').textContent = `Page ${page} of 604`;
  };
  nextImage.onerror = fail;
  nextImage.src = `https://www.mp3quran.net/api/quran_pages_arabic/${String(page).padStart(3, '0')}.png`;
}

$('#prayerRetry').addEventListener('click', () => { prayerFetchedAt = 0; loadPrayers(); });
$('#mushafForm').addEventListener('submit', (event) => { event.preventDefault(); showPage($('#mushafPage').value); });
$('#mushafPrevious').addEventListener('click', () => showPage(page - 1));
$('#mushafNext').addEventListener('click', () => showPage(page + 1));
export function openIslamic() {
  loadPrayers();
  if ($('#mushafPart').open && !readerStarted) { readerStarted = true; showPage(1); }
}
setInterval(() => {
  if ($('#view-islamic').hidden || document.visibilityState !== 'visible') return;
  updatePrayerCountdown();
  if (prayerData && prayerDay !== erbilNow().date) loadPrayers();
}, 1000);
setInterval(() => { if (!$('#view-islamic').hidden && document.visibilityState === 'visible') loadPrayers(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#view-islamic').hidden) loadPrayers(); });

$('#mushafPart').addEventListener('toggle', () => {
  if ($('#mushafPart').open && !$('#view-islamic').hidden) openIslamic();
});

const defaultAdhkar = [...document.querySelectorAll('#adhkarList .dhikr')].map((article, index) => ({
  id: `default-${index}`, text: article.querySelector('.arabic').textContent,
  meaning: article.querySelector('p:not(.arabic)').textContent, reference: article.querySelector('small').textContent
}));
let adhkarAccount;
export function configureAdhkar(account) { adhkarAccount = account; renderAdhkar(); }
export function renderAdhkar() {
  if (!adhkarAccount) return;
  const editable = adhkarAccount.canEdit();
  const items = adhkarAccount.getItems() ?? defaultAdhkar;
  $('#adhkarFields').disabled = !editable || items.length >= 100;
  $('#adhkarAccountHint').textContent = editable
    ? ''
    : 'Sign in to edit adhkar.';
  $('#adhkarList').replaceChildren(...items.map((item) => {
    const article = document.createElement('article');
    article.className = 'dhikr';
    const text = document.createElement('p');
    text.className = 'arabic'; text.dir = 'auto'; text.textContent = item.text;
    article.append(text);
    if (item.meaning) {
      const meaning = document.createElement('p'); meaning.dir = 'auto'; meaning.textContent = item.meaning; article.append(meaning);
    }
    if (item.reference) {
      const reference = document.createElement('small'); reference.dir = 'auto'; reference.textContent = item.reference; article.append(reference);
    }
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'link dhikr-remove'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove dhikr: ${item.text.slice(0, 60)}`);
    remove.disabled = !editable;
    remove.addEventListener('click', () => {
      if (!adhkarAccount.canEdit()) return;
      const remaining = (adhkarAccount.getItems() ?? defaultAdhkar).filter((entry) => entry.id !== item.id);
      adhkarAccount.setItems(remaining); renderAdhkar();
      $('#adhkarStatus').textContent = 'Removed.';
      const buttons = [...document.querySelectorAll('#adhkarList .dhikr-remove')];
      (buttons[Math.min(items.indexOf(item), buttons.length - 1)] ?? $('#dhikrText')).focus();
    });
    article.append(remove); return article;
  }));
  if (!items.length) $('#adhkarList').textContent = 'No adhkar yet. Add a supplication below.';
  if (items.length >= 100) $('#adhkarAccountHint').textContent = 'You have 100 adhkar. Remove one before adding another.';
}
$('#adhkarForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!adhkarAccount?.canEdit()) return;
  const items = adhkarAccount.getItems() ?? defaultAdhkar;
  const text = $('#dhikrText').value.trim();
  if (!text || items.length >= 100) {
    $('#adhkarStatus').textContent = !text ? 'Write a dhikr before adding it.' : 'You can save up to 100 adhkar.';
    return;
  }
  adhkarAccount.setItems([...items, { id: crypto.randomUUID(), text,
    meaning: $('#dhikrMeaning').value.trim(), reference: $('#dhikrReference').value.trim() }]);
  event.target.reset(); renderAdhkar(); $('#dhikrText').focus();
  $('#adhkarStatus').textContent = 'Added.';
});

const prayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export function nextPrayer(timings, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentSeconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second) + now.getMilliseconds() / 1000;
  const secondsAt = (name) => {
    const [hour, minute] = timings[name].split(':').map(Number);
    return hour * 3600 + minute * 60;
  };
  const name = prayerNames.find((prayer) => secondsAt(prayer) > currentSeconds) ?? 'Fajr';
  const tomorrow = secondsAt(name) <= currentSeconds;
  const secondsLeft = Math.ceil(secondsAt(name) + (tomorrow ? 86400 : 0) - currentSeconds);
  return { name, tomorrow, secondsLeft, time: timings[name] };
}

export function formatRemaining(seconds) {
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
}

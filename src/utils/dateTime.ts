import { getLocale, type Locale } from '../i18n';

const formatters = new Map<Locale, Intl.DateTimeFormat>();
function formatter() {
  const locale = getLocale();
  let value = formatters.get(locale);
  if (value) return value;
  value = new Intl.DateTimeFormat(locale, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});
  formatters.set(locale, value);
  return value;
}

export function formatLocalDateTime(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : formatter().format(timestamp);
}

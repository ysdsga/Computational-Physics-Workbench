const localDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

export function formatLocalDateTime(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : localDateTimeFormatter.format(timestamp);
}

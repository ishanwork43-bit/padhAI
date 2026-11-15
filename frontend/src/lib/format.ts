export function bytes(value: number): string {
  if (value === 0) return '0 B';
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.max(1, Math.round(value / 1024))} KiB`;
}
export function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}
export function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return date(value);
}
export function pageLabel(value: number | null): string {
  return value === null ? 'Text document' : `Page ${value}`;
}

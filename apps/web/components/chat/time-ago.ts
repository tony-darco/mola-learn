/**
 * Relative-time label for a turn's hover row. Fixed bucket thresholds per
 * spec: minutes up to an hour, hours up to a day, days up to a month (30d),
 * months up to a year, years after that.
 */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return unit(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");

  const days = Math.floor(hours / 24);
  if (days < 30) return unit(days, "day");

  const months = Math.floor(days / 30);
  if (months < 12) return unit(months, "month");

  const years = Math.floor(months / 12);
  return unit(years, "year");
}

function unit(n: number, name: string): string {
  return n === 1 ? `a ${name} ago` : `${n} ${name}s ago`;
}

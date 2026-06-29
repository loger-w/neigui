function normalize(dates: string[]): string[] {
  return Array.from(new Set(dates)).sort();
}

export function snapToTradingDay(targetDate: string, dates: string[]): string {
  if (dates.length === 0) return targetDate;
  const sorted = normalize(dates);
  let snapped: string | null = null;
  for (const d of sorted) {
    if (d <= targetDate) snapped = d;
    else break;
  }
  return snapped ?? targetDate;
}

export function prevTradingDay(currentDate: string, dates: string[]): string | null {
  if (dates.length === 0) return null;
  const sorted = normalize(dates);
  let prev: string | null = null;
  for (const d of sorted) {
    if (d < currentDate) prev = d;
    else break;
  }
  return prev;
}

export function nextTradingDay(
  currentDate: string,
  dates: string[],
  maxDate?: string,
): string | null {
  if (dates.length === 0) return null;
  const sorted = normalize(dates);
  for (const d of sorted) {
    if (d > currentDate) {
      if (maxDate !== undefined && d > maxDate) return null;
      return d;
    }
  }
  return null;
}

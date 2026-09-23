// Extracted from meloming-back a91393b2 src/schedule/schedule.service.ts
// (toWhereOverlap / kstMonthRange). The month boundary uses the previous UTC
// day at 15:00, corresponding to 00:00 KST on the requested first day.
export function toWhereOverlap(from?: string, to?: string) {
  if (!from && !to) return undefined;
  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (fromDate && toDate) {
    return {
      OR: [
        { AND: [{ startAt: { lt: toDate } }, { endAt: { gte: fromDate } }] },
        { AND: [{ startAt: { gte: fromDate, lt: toDate } }, { endAt: null }] },
      ],
    };
  }
  if (fromDate) return { OR: [
    { endAt: { gte: fromDate } },
    { AND: [{ endAt: null }, { startAt: { gte: fromDate } }] },
  ] };
  if (toDate) return { startAt: { lt: toDate } };
  return undefined;
}

export function kstMonthRange(ym: string): { from: string; to: string } | undefined {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return undefined;
  const [year, month] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 0, 15));
  const next = new Date(Date.UTC(year!, month!, 0, 15));
  return { from: start.toISOString(), to: next.toISOString() };
}

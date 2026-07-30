// Converts a start/end date (YYYY-MM-DD, from an <input type="date">) into
// full-day ISO timestamp bounds so the range is inclusive of the entire end
// day, not just midnight. Returns { start: string|null, end: string|null }.
export function toDateRangeBounds(startDate, endDate) {
  const start = startDate ? `${startDate}T00:00:00.000Z` : null;
  const end = endDate ? `${endDate}T23:59:59.999Z` : null;
  return { start, end };
}

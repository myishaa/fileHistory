const indiaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const indiaMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
});

function formatParts(formatter: Intl.DateTimeFormat, date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

export function formatIndiaDate(date = new Date()) {
  const parts = formatParts(indiaDateFormatter, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatIndiaMonth(date = new Date()) {
  const parts = formatParts(indiaMonthFormatter, date);
  return `${parts.year}-${parts.month}`;
}

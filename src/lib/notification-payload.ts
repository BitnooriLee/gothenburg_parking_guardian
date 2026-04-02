/** Bilingual cleaning alert copy (SV + EN). */
export function buildCleaningAlertBody(streetName: string, deadlineTimeSv: string): string {
  return `⚠️ Street Cleaning Alert! / Städgata! Move your car from ${streetName} before ${deadlineTimeSv}.`;
}

export function formatDeadlineStockholm(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Otega Restaurant is open 24/7.
// This module is kept for compatibility and future use if hours change per branch.

export function isWithinBusinessHours() {
	const tz = process.env.RESTAURANT_TIMEZONE || "Africa/Lagos";
	const hours = process.env.BIZ_HOURS || "24/7";

	if (hours === "24/7") return true;

	// Fallback: parse HH:mm-HH:mm range if ever set
	try {
		const fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hour: "2-digit",
			minute: "2-digit",
			hour12: false
		});
		const parts = fmt.formatToParts(new Date());
		const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
		const minutes = Number(map.hour) * 60 + Number(map.minute);

		const [start, end] = hours.split("-");
		const toMin = (hhmm) => {
			const [h, m] = hhmm.split(":").map(Number);
			return h * 60 + m;
		};
		return minutes >= toMin(start) && minutes < toMin(end);
	} catch {
		return true;
	}
}

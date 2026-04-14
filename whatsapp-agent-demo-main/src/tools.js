import { loadFaq } from "./faq.js";
import { isWithinBusinessHours } from "./bizHours.js";
import { notifyHandoff } from "./twilio.js";
import { getSupabase } from "./supabase.js";

const BRANCHES = {
	"1": { name: "Wuse 2", address: "Glovis Mall, 176 Aminu Kano Crescent, beside H-Medix, Wuse 2" },
	"2": { name: "Kubwa", address: "Gado Nasko Road, beside Access Bank, Phase 4, Kubwa" },
	"3": { name: "Lugbe", address: "Novare Gateway Mall, Airport Road, Lugbe" }
};

export { BRANCHES };

function templateEnvVars(text) {
	if (!text) return text;
	return text.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? "");
}

export async function lookupRestaurantFaq({ question }) {
	const q = question || "";
	const faq = loadFaq();
	const hit = faq.entries.find((e) => e._regexes.some((r) => r.test(q)));
	if (!hit) return null;
	return templateEnvVars(hit.answer);
}

export function getBranchSelectionMessage() {
	return (
		`Which Otega branch would you like?\n\n` +
		`1. Wuse 2 — Glovis Mall, 176 Aminu Kano Crescent\n` +
		`2. Kubwa — Gado Nasko Road, beside Access Bank\n` +
		`3. Lugbe — Novare Gateway Mall, Airport Road\n\n` +
		`Reply with 1, 2, or 3.`
	);
}

export function parseBranchSelection(text) {
	const t = text.trim();
	if (t === "1" || /wuse/i.test(t)) return BRANCHES["1"];
	if (t === "2" || /kubwa/i.test(t)) return BRANCHES["2"];
	if (t === "3" || /lugbe/i.test(t)) return BRANCHES["3"];
	return null;
}

export async function createReservation({ from, draft }) {
	const reservationId = `RSV-${Math.floor(Math.random() * 900000 + 100000)}`;
	const branch = draft.branch ?? { name: "Wuse 2 (Main)" };

	// Persist to Supabase
	try {
		const sb = getSupabase();
		await sb.from("reservations").insert({
			reservation_id: reservationId,
			phone: from,
			name: draft.name,
			party_size: draft.partySize,
			date: draft.date,
			time: draft.time,
			branch: branch.name,
			notes: draft.notes ?? null,
			created_at: new Date().toISOString()
		});
	} catch (err) {
		console.error("[reservation] failed to persist:", err.message);
	}

	return { reservationId, branch, ...draft, status: "CONFIRMED" };
}

export async function handoffToHuman({ from, summary, branch }) {
	const available = isWithinBusinessHours();
	const handoffId = `HUM-${Math.floor(Math.random() * 90000 + 10000)}`;

	// Persist to Supabase
	try {
		const sb = getSupabase();
		await sb.from("handoffs").insert({
			handoff_id: handoffId,
			phone: from,
			summary,
			branch: branch ?? "Not specified",
			status: "PENDING",
			created_at: new Date().toISOString()
		});
	} catch (err) {
		console.error("[handoff] failed to persist:", err.message);
	}

	// Notify Otega staff via WhatsApp
	await notifyHandoff({ from, summary, branch });

	return { handoffId, available, from, summary };
}

export function getDeliveryMessage() {
	return (
		`🛵 *Order for delivery via:*\n\n` +
		`• *Chowdeck:* https://chowdeck.com (search "Otega Restaurant")\n` +
		`• *Glovo:* https://glovoapp.com/ng/en/abuja (search "Otega")\n\n` +
		`Or call us directly for delivery:\n` +
		`📞 07039427479 | 09055000161\n\n` +
		`Available 24/7 from all 3 branches! 🕐`
	);
}

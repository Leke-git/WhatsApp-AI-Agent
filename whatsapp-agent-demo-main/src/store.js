import { getSupabase } from "./supabase.js";

const processedMessageSids = new Set();

export function hasProcessed(messageSid) {
	return processedMessageSids.has(messageSid);
}

export function markProcessed(messageSid) {
	processedMessageSids.add(messageSid);
}

export async function getSession(userId) {
	const sb = getSupabase();
	const { data } = await sb
		.from("sessions")
		.select("data")
		.eq("phone", userId)
		.single();

	const raw = data?.data;
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	return parsed ?? { history: [], flow: null, reservationDraft: {}, branch: null };
}

export async function setSession(userId, session) {
	const sb = getSupabase();
	await sb.from("sessions").upsert(
		{ phone: userId, data: JSON.parse(JSON.stringify(session)), updated_at: new Date().toISOString() },
		{ onConflict: "phone" }
	);
}

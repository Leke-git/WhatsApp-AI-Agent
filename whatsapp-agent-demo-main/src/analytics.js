import { getSupabase } from "./supabase.js";

export async function logIntent({ phone, intent, branch = null, message = null }) {
	try {
		const sb = getSupabase();
		await sb.from("analytics").insert({
			phone,
			intent,
			branch,
			message,
			created_at: new Date().toISOString()
		});
	} catch (err) {
		// Non-fatal — never let analytics break the agent
		console.error("[analytics] failed to log:", err.message);
	}
}

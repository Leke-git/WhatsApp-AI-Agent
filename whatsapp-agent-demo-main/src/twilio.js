import twilio from "twilio";

export function getTwilioClient() {
	const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
	if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
		throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
	}
	return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export function validateTwilioWebhook({ req, publicUrl }) {
	const signature = req.headers["x-twilio-signature"];
	if (!signature) return false;
	const authToken = process.env.TWILIO_AUTH_TOKEN;
	return twilio.validateRequest(authToken, signature, publicUrl, req.body);
}

/**
 * Send a plain WhatsApp text message.
 */
export async function sendWhatsAppMessage({ to, body }) {
	const client = getTwilioClient();
	const from = process.env.TWILIO_WHATSAPP_FROM;
	if (!from) throw new Error("Missing TWILIO_WHATSAPP_FROM");
	return client.messages.create({ from, to, body });
}

/**
 * Send a WhatsApp message with up to 3 quick-reply buttons.
 * Falls back to plain text if the sandbox doesn't support buttons.
 *
 * buttons: [{ id: string, title: string }]  — max 3, title max 20 chars
 */
export async function sendWhatsAppButtons({ to, body, buttons }) {
	const client = getTwilioClient();
	const from = process.env.TWILIO_WHATSAPP_FROM;
	if (!from) throw new Error("Missing TWILIO_WHATSAPP_FROM");

	// Twilio sandbox doesn't support interactive messages — fall back to numbered list
	const isSandbox = from.includes("14155238886");

	if (isSandbox) {
		const numbered = buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
		return client.messages.create({
			from,
			to,
			body: `${body}\n\n${numbered}\n\nReply with a number or type your question.`
		});
	}

	// Production: use Twilio Content API interactive buttons
	// Requires TWILIO_CONTENT_SID_BUTTONS template pre-approved by Meta
	// For now, same numbered fallback until template is approved
	const numbered = buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
	return client.messages.create({
		from,
		to,
		body: `${body}\n\n${numbered}\n\nReply with a number or type your question.`
	});
}

/**
 * Notify Otega staff of a handoff request via WhatsApp.
 */
export async function notifyHandoff({ from, summary, branch }) {
	const client = getTwilioClient();
	const staffNumber = process.env.HANDOFF_NOTIFY_NUMBER;
	const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;

	if (!staffNumber || !twilioFrom) {
		console.warn("[handoff] HANDOFF_NOTIFY_NUMBER not set — skipping staff notification");
		return;
	}

	const msg =
		`🔔 *Customer needs human support*\n` +
		`From: ${from}\n` +
		`Branch: ${branch || "Not specified"}\n` +
		`Issue: ${summary}`;

	return client.messages.create({
		from: twilioFrom,
		to: staffNumber.startsWith("whatsapp:") ? staffNumber : `whatsapp:${staffNumber}`,
		body: msg
	});
}

import OpenAI from "openai";
import {
	lookupRestaurantFaq,
	createReservation,
	handoffToHuman,
	getDeliveryMessage,
	getBranchSelectionMessage,
	parseBranchSelection
} from "./tools.js";
import { logIntent } from "./analytics.js";
import { sendWhatsAppButtons } from "./twilio.js";

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
	baseURL: process.env.OPENAI_BASE_URL
});

const RESTAURANT = {
	name: "Otega Restaurant",
	phone: "07039427479 | 09055000161",
	timezone: "Africa/Lagos"
};

// ── Welcome message with buttons ─────────────────────────────────────────────

export async function sendWelcome({ to }) {
	await sendWhatsAppButtons({
		to,
		body:
			`👋 Welcome to *Otega Restaurant* — Abuja's favourite affordable fine dining! 🍽️\n\n` +
			`We're open *24/7* across 3 branches in Wuse 2, Kubwa, and Lugbe.\n\n` +
			`How can I help you today?`,
		buttons: [
			{ id: "menu", title: "📋 View Menu" },
			{ id: "reserve", title: "🍽️ Reserve a Table" },
			{ id: "delivery", title: "🛵 Delivery & Orders" }
		]
	});
}

// ── Field extraction ──────────────────────────────────────────────────────────

async function extractReservationFields({ userText }) {
	const model = process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";

	const system = `
Extract reservation details from the user's message.
Return JSON only — no preamble, no markdown:
{
  "partySize": number|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:mm"|null,
  "name": string|null,
  "notes": string|null,
  "cancel": boolean
}
Rules:
- If user wants to cancel/stop, set cancel=true and everything else null.
- If no value present, use null.
- Interpret relative dates like "today", "tonight", "tomorrow" using timezone: Africa/Lagos.
- Convert times like "7pm" → "19:00".
- Today's date for reference: ${new Date().toISOString().split("T")[0]}.
`.trim();

	const result = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: userText }
		],
		response_format: { type: "json_object" }
	});

	try {
		return JSON.parse(result.choices[0].message.content);
	} catch {
		return {};
	}
}

function mergeDraft(draft, parsed) {
	const next = { ...draft };
	for (const key of ["partySize", "date", "time", "name", "notes"]) {
		const v = parsed?.[key];
		if (v !== null && v !== undefined && v !== "") next[key] = v;
	}
	return next;
}

function missingFields(draft) {
	const missing = [];
	if (!draft.partySize) missing.push("partySize");
	if (!draft.date) missing.push("date");
	if (!draft.time) missing.push("time");
	if (!draft.name) missing.push("name");
	return missing;
}

function nextQuestion(missing) {
	switch (missing[0]) {
		case "partySize": return "How many people will be dining?";
		case "date": return "What day works for you — today, tomorrow, or another date?";
		case "time": return "What time would you like the reservation?";
		case "name": return "And what name should I put the reservation under?";
		default: return "Could you share more details?";
	}
}

// ── Intent classification ─────────────────────────────────────────────────────

async function classifyIntent({ userText, history }) {
	const model = process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";

	const system = `
You are the WhatsApp assistant for Otega Restaurant, Abuja.
Otega serves Nigerian cuisine — jollof rice, native rice, asun, soups and swallows, and more.
Open 24/7 at 3 branches: Wuse 2, Kubwa, Lugbe.

Classify the user's message into one intent and return JSON only:
{
  "intent": "FAQ"|"RESERVATION"|"DELIVERY"|"HANDOFF"|"MENU"|"BRANCH"|"GENERAL",
  "faqQuery": string|null,
  "handoffSummary": string|null,
  "reply": string|null
}

Intent rules:
- FAQ: questions about hours, location, parking, pricing, dietary, ambience
- MENU: asking to see the menu or specific dishes
- RESERVATION: wants to book a table
- DELIVERY: wants food delivered or asks about ordering
- HANDOFF: wants a human, has a complaint, or asks for a manager
- BRANCH: asking which branch or about a specific location
- GENERAL: greetings, thanks, or unclear — reply warmly and offer help

For GENERAL, write a short friendly reply in the "reply" field.
For all others, set "reply" to null.
`.trim();

	const result = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: system },
			...history.slice(-6),
			{ role: "user", content: userText }
		],
		response_format: { type: "json_object" }
	});

	try {
		return JSON.parse(result.choices[0].message.content);
	} catch {
		return { intent: "GENERAL", reply: "How can I help you? You can ask about our menu, make a reservation, or order delivery." };
	}
}

// ── Main agent ────────────────────────────────────────────────────────────────

export async function runAgent({ from, userText, session }) {
	const model = process.env.OPENAI_MODEL || "llama-3.3-70b-versatile";
	const normalizedText = userText.trim();

	// ── RESERVATION flow ──────────────────────────────────────────────────────
	if (session.flow === "RESERVATION") {

		// Step 1: waiting for branch selection
		if (!session.reservationDraft.branch) {
			const branch = parseBranchSelection(normalizedText);
			if (!branch) {
				return {
					reply: `Please reply with 1, 2, or 3 to choose your branch:\n\n1. Wuse 2\n2. Kubwa\n3. Lugbe`,
					newSession: session
				};
			}
			session.reservationDraft.branch = branch;
			await logIntent({ phone: from, intent: "RESERVATION_BRANCH", branch: branch.name, message: normalizedText });

			// Try to extract any other fields already in this message
			const parsed = await extractReservationFields({ userText: normalizedText });
			session.reservationDraft = mergeDraft(session.reservationDraft, parsed);

			const missing = missingFields(session.reservationDraft);
			return {
				reply: missing.length > 0
					? `Great — *${branch.name}* it is!\n\n${nextQuestion(missing)}`
					: `Got it — one moment...`,
				newSession: session
			};
		}

		// Step 2: collecting remaining fields
		const parsed = await extractReservationFields({ userText: normalizedText });

		if (parsed.cancel) {
			session.flow = null;
			session.reservationDraft = {};
			return {
				reply: "No problem — reservation cancelled. Is there anything else I can help you with?",
				newSession: session
			};
		}

		session.reservationDraft = mergeDraft(session.reservationDraft, parsed);

		const missing = missingFields(session.reservationDraft);
		if (missing.length > 0) {
			return { reply: nextQuestion(missing), newSession: session };
		}

		// All fields collected — confirm
		const result = await createReservation({ from, draft: session.reservationDraft });
		await logIntent({ phone: from, intent: "RESERVATION_CONFIRMED", branch: result.branch?.name, message: normalizedText });

		session.flow = null;
		session.reservationDraft = {};

		const reply =
			`✅ *Reservation Confirmed!*\n\n` +
			`📍 Branch: ${result.branch.name}\n` +
			`👤 Name: ${result.name}\n` +
			`👥 Party size: ${result.partySize}\n` +
			`📅 Date: ${result.date}\n` +
			`🕐 Time: ${result.time}\n` +
			`🔖 Ref: ${result.reservationId}\n\n` +
			`See you at Otega! For changes, call 07039427479. 🍽️`;

		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
		return { reply, newSession: session };
	}

	// ── HANDOFF flow ──────────────────────────────────────────────────────────
	if (session.flow === "HANDOFF") {
		const result = await handoffToHuman({ from, summary: normalizedText, branch: session.branch });
		await logIntent({ phone: from, intent: "HANDOFF_SUBMITTED", branch: session.branch, message: normalizedText });

		session.flow = null;

		const reply =
			`✅ Got it — I've notified our team.\n\n` +
			`🔖 Ref: ${result.handoffId}\n\n` +
			`Someone from Otega will reach out to you shortly. You can also call us directly:\n` +
			`📞 07039427479 | 09055000161`;

		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
		return { reply, newSession: session };
	}

	// ── Normal mode ───────────────────────────────────────────────────────────
	const plan = await classifyIntent({ userText: normalizedText, history: session.history });
	await logIntent({ phone: from, intent: plan.intent, branch: session.branch ?? null, message: normalizedText });

	// Handle button-number shortcuts (1/2/3 on welcome screen)
	if (!session.flow && (normalizedText === "1" || normalizedText === "2" || normalizedText === "3")) {
		const shortcuts = { "1": "MENU", "2": "RESERVATION", "3": "DELIVERY" };
		plan.intent = shortcuts[normalizedText];
	}

	// FAQ
	if (plan.intent === "FAQ" || plan.intent === "BRANCH") {
		const answer = await lookupRestaurantFaq({ question: plan.faqQuery || normalizedText });
		if (answer) {
			session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: answer }];
			return { reply: answer, newSession: session };
		}
	}

	// Menu
	if (plan.intent === "MENU") {
		const answer = await lookupRestaurantFaq({ question: "menu" });
		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: answer }];
		return { reply: answer, newSession: session };
	}

	// Delivery
	if (plan.intent === "DELIVERY") {
		const reply = getDeliveryMessage();
		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
		return { reply, newSession: session };
	}

	// Reservation — start flow
	if (plan.intent === "RESERVATION") {
		session.flow = "RESERVATION";
		session.reservationDraft = {};

		// Pre-extract any details already in the message
		const parsed = await extractReservationFields({ userText: normalizedText });
		if (!parsed.cancel) {
			session.reservationDraft = mergeDraft({}, parsed);
		}

		const reply = getBranchSelectionMessage();
		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
		return { reply, newSession: session };
	}

	// Handoff — ask for details first
	if (plan.intent === "HANDOFF") {
		session.flow = "HANDOFF";
		const reply =
			`👤 I'll connect you with our team right away.\n\n` +
			`Please briefly describe what you need help with (and which branch if relevant):`;
		session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
		return { reply, newSession: session };
	}

	// General / fallback
	const reply =
		plan.reply?.trim() ||
		`I'm here to help! You can:\n\n1 — View our menu\n2 — Make a reservation\n3 — Order delivery\n\nOr just ask me anything about Otega! 😊`;

	session.history = [...session.history.slice(-10), { role: "user", content: normalizedText }, { role: "assistant", content: reply }];
	return { reply, newSession: session };
}

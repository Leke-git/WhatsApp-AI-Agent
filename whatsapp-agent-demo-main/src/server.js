import "dotenv/config";
import express from "express";
import morgan from "morgan";

import { validateTwilioWebhook, sendWhatsAppMessage } from "./twilio.js";
import { hasProcessed, markProcessed, getSession, setSession } from "./store.js";
import { runAgent, sendWelcome } from "./agent.js";

const app = express();
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
	res.status(200).send("ok");
});

app.post("/twilio/whatsapp", async (req, res) => {
	try {
		const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
		if (!publicUrl) return res.status(500).send("Missing PUBLIC_WEBHOOK_URL");

		const valid = validateTwilioWebhook({ req, publicUrl });
		if (!valid) return res.status(403).send("Invalid Twilio signature");

		const messageSid = req.body.MessageSid;
		const from = req.body.From;
		const body = (req.body.Body || "").trim();

		if (!messageSid || !from) return res.status(400).send("Bad request");

		if (hasProcessed(messageSid)) return res.status(200).send("duplicate");
		markProcessed(messageSid);

		if (!body) {
			await sendWhatsAppMessage({ to: from, body: "Send a message and I'll help! 😊" });
			return res.status(200).send("ok");
		}

		const session = await getSession(from);
		
		// Reset session with keyword
		if (body.toLowerCase() === "restart") {
    		await setSession(from, { history: [], flow: null, reservationDraft: {}, branch: null });
    		await sendWelcome({ to: from });
    		return res.status(200).send("ok");
		}
		
		// First-time user — send welcome with buttons
		const isFirstMessage = session.history.length === 0 && !session.flow;
		if (isFirstMessage) {
			await sendWelcome({ to: from });
			// Mark session as started so we don't re-send welcome
			session.history = [
				{ role: "user", content: body },
				{ role: "assistant", content: "Welcome to Otega Restaurant! Reply 1 for Menu, 2 to Reserve, 3 for Delivery." }
			];
			await setSession(from, session);
			return res.status(200).send("ok");
		}

		const { reply, newSession } = await runAgent({ from, userText: body, session });

		await setSession(from, newSession);
		await sendWhatsAppMessage({ to: from, body: reply });

		res.status(200).send("ok");
	} catch (err) {
		console.error(err);
		res.status(500).send("server error");
	}
});

// Export for Vercel serverless. For local dev, start with: node src/server.js
if (process.env.NODE_ENV !== "production") {
	const port = Number(process.env.PORT || 3000);
	app.listen(port, () => console.log(`Listening on :${port}`));
}

export default app;

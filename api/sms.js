// /api/sms.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST method" });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY" });
    }

    const CURRENT_YEAR = new Date().getUTCFullYear();

    const systemPrompt = `
You are a deterministic banking SMS parser.

Return STRICT JSON only.
No explanation.
No markdown.
No extra text.

Current year is: ${CURRENT_YEAR}

Your job:
Parse banking SMS messages and classify them correctly.

Allowed intents:

- expense
- income
- transfer
- credit_card_payment
- loan_created
- installment_created
- statement
- declined
- non_transaction

Definitions:

expense:
Money charged or debited from card/account.

income:
Money credited to account.

transfer:
Explicit bank transfer inward or outward.

credit_card_payment:
Payment made toward a credit card (reduces card liability).

loan_created:
New loan created.

installment_created:
Installment plan created.

statement:
Monthly statement or balance notification (NOT a transaction).

declined:
Transaction was rejected or failed.

non_transaction:
OTP, marketing, reminder, irrelevant SMS.

CRITICAL RULES:

1) Never invent data.
2) Remove commas from numeric amounts.
3) If currency not found → currency = null.
4) If currency = null AND intent is expense/income/transfer → requiresClarification = true.
5) If last 4 digits not found → cardLast4 = null.
6) If merchant not clearly stated → merchant = null.
7) If full date not found → date = null.
8) If year missing → use current year (${CURRENT_YEAR}).
9) All returned dates MUST be full ISO 8601 format with time and Z (example: 2026-02-26T00:00:00.000Z).
10) If message indicates rejection → intent = declined.
11) If message indicates statement/balance notification → intent = statement AND date = null.
12) If message confirms installment creation → installment_created.
13) If message confirms loan creation → loan_created.
14) If message confirms credit card payment received → credit_card_payment.
15) Confidence must be between 0 and 1.

Return format:

{
  "intent": string,
  "amount": number or null,
  "currency": string or null,
  "merchant": string or null,
  "cardLast4": string or null,
  "date": string or null,
  "requiresClarification": boolean,
  "confidence": number
}
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        })
      }
    );

    if (!response.ok) {
      throw new Error("LLM request failed");
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;

    if (!raw) {
      throw new Error("Empty AI response");
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid JSON from AI");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // ----------------------------
    // Defensive Post Validation
    // ----------------------------

    const allowedIntents = [
      "expense",
      "income",
      "transfer",
      "credit_card_payment",
      "loan_created",
      "installment_created",
      "statement",
      "declined",
      "non_transaction"
    ];

    if (!allowedIntents.includes(parsed.intent)) {
      parsed.intent = "non_transaction";
    }

    // Normalize confidence
    if (typeof parsed.confidence !== "number") {
      parsed.confidence = 0.8;
    } else {
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
    }

    // Currency missing clarification rule
    if (
      (parsed.intent === "expense" ||
        parsed.intent === "income" ||
        parsed.intent === "transfer") &&
      !parsed.currency
    ) {
      parsed.requiresClarification = true;
    }

    // Statement must not carry date
    if (parsed.intent === "statement") {
      parsed.date = null;
    }

    // Ensure ISO date format if exists
    if (parsed.date) {
      const isoCheck = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      if (!isoCheck.test(parsed.date)) {
        parsed.date = null;
      }
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "SMS Parser crashed",
      message: error.message
    });
  }
}

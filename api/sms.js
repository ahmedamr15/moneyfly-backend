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
You are a STRICT deterministic banking SMS parser.

Return STRICT JSON only.
No explanation.
No markdown.
No extra text.

Current year is: ${CURRENT_YEAR}

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

CRITICAL RULES:

1) NEVER modify decimal values. Preserve decimal precision EXACTLY.
   Example: 17.49 must stay 17.49 (NOT 1749).
2) Remove commas only (1,000.50 → 1000.50).
3) If currency missing → currency = null.
4) If currency null AND intent is expense/income/transfer → requiresClarification = true.
5) If last 4 digits not found → cardLast4 = null.
6) If merchant unclear → merchant = null.
7) If no date → date = null.
8) If year missing → use ${CURRENT_YEAR}.
9) All dates MUST be full ISO 8601 with time and Z.
   Example: 2026-02-26T15:30:00.000Z
10) For format "01-26 الساعة 15:30":
    Treat as month-day.
11) For format "26-02":
    Treat as day-month.
12) Statement messages → intent = statement AND date = null.
13) Rejected/failed → intent = declined.
14) Installment confirmation → installment_created.
15) Loan creation → loan_created.
16) Credit card payment received → credit_card_payment.

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

    // ----------------------
    // Defensive Validation
    // ----------------------

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

    // Decimal protection
    if (parsed.amount !== null) {
      parsed.amount = Number(parsed.amount);
      if (isNaN(parsed.amount)) parsed.amount = null;
    }

    // Confidence normalization
    if (typeof parsed.confidence !== "number") {
      parsed.confidence = 0.8;
    } else {
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
    }

    // Currency clarification enforcement
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

    // Enforce ISO date format strictly
    if (parsed.date) {
      const isoCheck = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/;
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

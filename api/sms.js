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

    const systemPrompt = `
You are a deterministic banking SMS parser.

Return STRICT JSON only.
No explanation.
No markdown.
No extra text.

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
Explicit bank transfer outward or inward.

credit_card_payment:
Payment made toward a credit card (reduces card liability).

loan_created:
New loan created.

installment_created:
Installment plan created.

statement:
Monthly statement or balance notification.

declined:
Transaction was rejected.

non_transaction:
OTP, marketing, reminder, or irrelevant SMS.

IMPORTANT RULES:

1) Never invent data.
2) If currency not found → currency = null.
3) If last 4 digits not found → cardLast4 = null.
4) If merchant not clear → merchant = null.
5) If date missing → date = null.
6) If year missing → assume current year.
7) Remove commas from numeric amounts.
8) If message contains words meaning rejected or failed → intent = declined.
9) If message contains statement keywords → intent = statement.
10) If message confirms installment plan creation → installment_created.
11) If message confirms credit card payment received → credit_card_payment.
12) Confidence between 0 and 1.

Return format:

{
  "intent": "...",
  "amount": number or null,
  "currency": "ISO" or null,
  "merchant": string or null,
  "cardLast4": string or null,
  "date": ISO8601 string or null,
  "requiresClarification": boolean,
  "confidence": number
}

requiresClarification:
true only if amount or intent cannot be determined safely.
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
        }),
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

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "SMS Parser crashed",
      message: error.message,
    });
  }
}

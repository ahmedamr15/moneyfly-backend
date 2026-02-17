import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message, accounts, categories } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const safeAccounts = accounts || [];
    const safeCategories = categories || [];

    const systemPrompt = `
You are a deterministic financial transaction extraction engine.

The sentence may contain MULTIPLE financial actions.
You MUST extract ALL actions.
Each action must be a separate transaction.
Never merge separate actions.
Never ignore any number.

ACCOUNTS:
${JSON.stringify(safeAccounts)}

CATEGORIES:
${JSON.stringify(safeCategories)}

TRANSFER RULES:
- If source AND destination exist → transfer
- If only source → expense
- If only destination → income

Return STRICT JSON ONLY.

Format:

{
  "transactions": [
    {
      "type": "expense | income | transfer",
      "amount": number,
      "category": string | null,
      "subcategory": string | null,
      "sourceAccount": string | null,
      "destinationAccount": string | null,
      "confidence": number
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `${systemPrompt}\nUser sentence:\n${message}`
    });

    const text = response.text;

    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: cleaned
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message
    });
  }
}

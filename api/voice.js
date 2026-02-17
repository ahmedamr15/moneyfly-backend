import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = "models/gemini-2.5-flash";

/*
--------------------------------------------------
DUMP CATEGORIES (Temporary until app sends them)
--------------------------------------------------
*/

const EXISTING_CATEGORIES = [
  {
    name: "Food",
    subcategories: ["Pizza", "Coffee", "Restaurant"]
  },
  {
    name: "Smoking",
    subcategories: ["Cigarettes"]
  },
  {
    name: "Shopping",
    subcategories: ["Clothes", "Shoes"]
  },
  {
    name: "Utilities",
    subcategories: ["Electricity", "Water", "Gas"]
  },
  {
    name: "Salary",
    subcategories: ["Main Salary"]
  },
  {
    name: "Other",
    subcategories: []
  }
];

const REJECTED_SUGGESTIONS = [];

/*
--------------------------------------------------
HELPER: Clean AI Markdown if returned
--------------------------------------------------
*/

function cleanJSON(text) {
  if (!text) return null;

  let cleaned = text.trim();

  // Remove markdown blocks if exist
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/```json/g, "")
                     .replace(/```/g, "")
                     .trim();
  }

  return cleaned;
}

/*
--------------------------------------------------
VOICE ENDPOINT
--------------------------------------------------
*/

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {

    const prompt = `
You are a financial transaction parser.

Return STRICT JSON only.
No markdown.
No explanation.
No extra text.

Existing categories:
${JSON.stringify(EXISTING_CATEGORIES)}

Rejected suggestions:
${JSON.stringify(REJECTED_SUGGESTIONS)}

Rules:
1. Extract ALL financial transactions.
2. If multiple amounts → create multiple transactions.
3. Detect expense or income.
4. Match category and subcategory if exists.
5. If subcategory does not exist but category exists → suggest it.
6. If category does not exist → suggest new category.
7. Detect language.

Return JSON in this format:

{
  "transactions": [
    {
      "type": "expense | income",
      "amount": number,
      "currency": "EGP",
      "category": {
        "name": string,
        "exists": true | false
      },
      "subcategory": {
        "name": string,
        "exists": true | false
      },
      "note": string
    }
  ],
  "categorySuggestions": [
    {
      "category": string,
      "subcategory": string
    }
  ],
  "meta": {
    "confidence": number,
    "language": "ar | en",
    "multipleTransactions": true | false
  }
}

User message:
"${message}"
`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });

    const rawText = response?.text;

    const cleaned = cleanJSON(rawText);

    if (!cleaned) {
      return res.status(500).json({
        error: "AI returned empty response",
        raw: rawText
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: rawText
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });

  }
}

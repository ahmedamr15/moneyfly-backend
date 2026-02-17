const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const MODEL = "models/gemini-2.5-flash";

function cleanJSON(text) {
  if (!text) return null;

  let cleaned = text.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/```json/g, "")
                     .replace(/```/g, "")
                     .trim();
  }

  return cleaned;
}

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {

    const prompt = `
Return STRICT JSON only.

User message:
"${message}"

Return format:
{
  "transactions": [
    {
      "type": "expense | income",
      "amount": number,
      "category": string
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });

    const rawText = response?.text;

    const cleaned = cleanJSON(rawText);

    if (!cleaned) {
      return res.status(500).json({
        error: "Empty AI response",
        raw: rawText
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({
        error: "Invalid AI response",
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
};

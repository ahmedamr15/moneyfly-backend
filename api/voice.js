import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
Extract transaction information from this sentence:

"${message}"

Return ONLY valid JSON in this format:
{
  "type": "expense | income",
  "amount": number,
  "category": "food | transport | salary | utilities | other"
}
`
    });

    const text = response.text;

    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (err) {
      return res.status(500).json({
        error: "AI response invalid",
        raw: text
      });
    }

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}

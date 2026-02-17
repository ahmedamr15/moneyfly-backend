const { GoogleGenAI } = require("@google/genai");

module.exports = async function (req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
Extract transaction info from this:
"${message}"

Return ONLY valid JSON:
{
  "type": "expense | income",
  "amount": number,
  "category": "food | transport | salary | utilities | other"
}
`
    });

    const text = response.text;

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
};

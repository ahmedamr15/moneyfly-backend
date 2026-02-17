module.exports = async function (req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3-flash-preview:generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Extract transaction data from:
"${message}"

Return ONLY JSON in this format:
{
  "type": "expense | income",
  "amount": number,
  "category": "food | transport | salary | utilities | other"
}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await geminiResponse.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    const parsed = JSON.parse(text);

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: "Server crashed",
      details: error.message
    });
  }
};

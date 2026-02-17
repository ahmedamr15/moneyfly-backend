export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
                  text: `
You are a financial transaction parser.

Return ONLY valid JSON with this structure:

{
  "type": "income | expense | transfer",
  "amount": number,
  "category": "string",
  "note": "string"
}

User message:
"${message}"
`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await geminiResponse.json();

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!text) {
      return res.status(500).json({
        error: "Invalid AI response",
        raw: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "AI did not return valid JSON",
        raw: text
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

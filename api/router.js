module.exports = async function (req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // تأكد أنك وضعت GEMINI_API_KEY في إعدادات Vercel
    const API_KEY = process.env.GEMINI_API_KEY; 
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are a financial assistant. Extract transactions from this text: "${req.body.message}". 
            Return ONLY valid JSON in this format: 
            {"transactions": [{"type": "expense|income", "amount": number, "category": string, "item": string}]}`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          response_mime_type: "application/json" // ميزة جبارة في جيمناي بتجبره على JSON
        }
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates[0].content.parts[0].text) {
      const aiText = data.candidates[0].content.parts[0].text.trim();
      return res.status(200).json(JSON.parse(aiText));
    } else {
      return res.status(500).json({ error: "Gemini Error", details: data });
    }

  } catch (error) {
    return res.status(500).json({ error: "Server Crash", message: error.message });
  }
};

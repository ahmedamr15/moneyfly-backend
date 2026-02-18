module.exports = async function (req, res) {
  // إعدادات الـ CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const API_KEY = process.env.GROQ_API_KEY;
    if (!API_KEY) throw new Error("Missing GROQ_API_KEY");

    const userMessage = req.body.message || "اكلت ب ٢٠٠ جنيه";

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "Return ONLY a JSON array of financial transactions. Example: [{\"type\":\"expense\",\"amount\":200,\"item\":\"food\"}]"
          },
          { role: "user", content: userMessage }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: "Groq API Error", details: data.error });
    }

    const content = data.choices[0]?.message?.content;
    return res.status(200).json(JSON.parse(content));

  } catch (error) {
    return res.status(500).json({ 
      error: "Function Crashed", 
      message: error.message 
    });
  }
};

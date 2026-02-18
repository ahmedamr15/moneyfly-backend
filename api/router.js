const Groq = require("groq-sdk");

// التأكد من وجود المفتاح
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

module.exports = async function (req, res) {
  // تفعيل الـ CORS عشان تقدر تكلمه من أي مكان
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userMessage = req.body.message || "اكلت ب ٢٠٠ جنيه";

    const chatCompletion = await groq.chat.completions.create({
      "messages": [
        {
          "role": "system",
          "content": "Extract transactions into a JSON array. Format: [{\"type\": \"expense|income|transfer\", \"amount\": number, \"item\": string}]. Return ONLY JSON."
        },
        {
          "role": "user",
          "content": userMessage
        }
      ],
      "model": "llama-3.1-8b-instant",
      "temperature": 0.1,
      "response_format": { "type": "json_object" }
    });

    const content = chatCompletion.choices[0]?.message?.content;
    return res.status(200).json(JSON.parse(content));

  } catch (error) {
    console.error("Groq Error:", error);
    return res.status(500).json({ 
      error: "Internal Server Error", 
      message: error.message,
      hint: "Check if GROQ_API_KEY is set in Vercel Environment Variables"
    });
  }
};

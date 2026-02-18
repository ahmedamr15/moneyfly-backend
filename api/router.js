module.exports = async function (req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const API_KEY = process.env.OPENROUTER_API_KEY;
    const URL = "https://openrouter.ai/api/v1/chat/completions";

    const response = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "HTTP-Referer": "https://moneyfly.vercel.app", // اختياري
        "X-Title": "Moneyfly", // اختياري
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "meta-llama/llama-3.2-3b-instruct:free",
        "messages": [
          {
            "role": "system",
            "content": "You are a finance expert. Extract transactions into JSON: {\"transactions\": [{\"type\": \"expense|income\", \"amount\": number, \"category\": string, \"item\": string}]}. Support Arabic and English."
          },
          {
            "role": "user",
            "content": req.body.message || "What is the meaning of life?"
          }
        ],
        "temperature": 0.1 // لضمان دقة استخراج الأرقام
      })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]) {
      // محاولة إرجاع النص مباشرة أو تحويله لـ JSON
      const aiContent = data.choices[0].message.content;
      try {
        return res.status(200).json(JSON.parse(aiContent));
      } catch (parseError) {
        // في حال الموديل رجع نص عادي بدلاً من JSON
        return res.status(200).json({ text: aiContent });
      }
    } else {
      return res.status(500).json({ error: "API Error", details: data });
    }

  } catch (error) {
    return res.status(500).json({ error: "Server Crash", message: error.message });
  }
};

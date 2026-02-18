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
        "Content-Type": "application/json",
        "HTTP-Referer": "https://moneyfly.vercel.app", 
        "X-Title": "Moneyfly"
      },
      body: JSON.stringify({
        "model": "qwen/qwen3-4b:free",
        "messages": [
          {
            "role": "system",
            "content": "You are a financial expert. Extract transactions into JSON: {\"transactions\": [{\"type\": \"expense|income\", \"amount\": number, \"category\": string, \"item\": string}]}. Return ONLY JSON."
          },
          {
            "role": "user",
            "content": req.body.message || "اشتريت غدا بـ 100 جنيه"
          }
        ],
        "temperature": 0.1
      })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]) {
      let aiContent = data.choices[0].message.content.trim();
      
      // تنظيف النص لو الموديل أضاف علامات Markdown
      aiContent = aiContent.replace(/```json|```/g, "").trim();

      try {
        return res.status(200).json(JSON.parse(aiContent));
      } catch (e) {
        return res.status(200).json({ 
          error: "Failed to parse JSON", 
          raw_text: aiContent 
        });
      }
    } else {
      return res.status(500).json({ error: "API Error", details: data });
    }

  } catch (error) {
    return res.status(500).json({ error: "Server Crash", message: error.message });
  }
};

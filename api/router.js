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
        "HTTP-Referer": "https://moneyfly-app.com", // اختياري لترتيبك في OpenRouter
        "X-Title": "Moneyfly App" 
      },
      body: JSON.stringify({
        "model": "google/gemma-3-12b-it:free",
        "messages": [
          {
            "role": "system",
            "content": "You are an expert bilingual financial assistant (Arabic/English). Extract transaction details into a strict JSON format: {\"transactions\": [{\"type\": \"expense|income\", \"amount\": number, \"category\": string, \"item\": string}]}. Only return JSON."
          },
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": req.body.message || "اشتريت قهوة بـ 30 جنيه"
              }
              // هنا ممكن مستقبلاً تضيف الـ image_url لو المستخدم بعت صورة فاتورة
            ]
          }
        ],
        "response_format": { "type": "json_object" }
      })
    });

    const data = await response.json();

    if (data.choices && data.choices[0]) {
      // استخراج النص وتحويله لـ JSON
      const content = data.choices[0].message.content;
      return res.status(200).json(JSON.parse(content));
    } else {
      return res.status(500).json({ error: "AI Error", details: data });
    }

  } catch (error) {
    return res.status(500).json({ error: "Server Crash", message: error.message });
  }
};

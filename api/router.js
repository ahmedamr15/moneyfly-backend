module.exports = async function (req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    const API_KEY = process.env.OPENROUTER_API_KEY;
    const URL = "https://openrouter.ai/api/v1/chat/completions";

    // الخطوة 1: الطلب الأول (كما في الـ Documentation)
    const response1 = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "openrouter/free", // الموديل التلقائي المجاني
        "messages": [
          {
            "role": "user",
            "content": req.body.message || "How many r's are in the word 'strawberry'?"
          }
        ],
        "reasoning": { "enabled": true } // تفعيل ميزة التفكير
      })
    });

    const result1 = await response1.json();
    
    // التحقق من صحة الرد الأول
    if (!result1.choices) {
        return res.status(200).json({ error: "First call failed", details: result1 });
    }

    const assistantMsg = result1.choices[0].message;

    // الخطوة 2: بناء المحادثة الثانية (Preserving reasoning_details)
    const messages = [
      {
        role: 'user',
        content: req.body.message || "How many r's are in the word 'strawberry'?",
      },
      {
        role: 'assistant',
        content: assistantMsg.content,
        reasoning_details: assistantMsg.reasoning_details, // الاحتفاظ بالتفكير السابق
      },
      {
        role: 'user',
        content: "Are you sure? Think carefully.",
      },
    ];

    // الخطوة 3: الطلب الثاني (المتابعة)
    const response2 = await fetch(URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "model": "openrouter/free",
        "messages": messages
      })
    });

    const result2 = await response2.json();

    // إرسال النتيجة النهائية لـ Hoppscotch
    return res.status(200).json({
      initial_reasoning: assistantMsg.reasoning_details,
      final_answer: result2.choices?.[0]?.message?.content || "No final answer",
      full_response: result2
    });

  } catch (error) {
    return res.status(500).json({ error: "Server Crash", message: error.message });
  }
};

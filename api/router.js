try {
    const response1 = await fetch(URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "model": "google/gemini-2.0-flash-thinking-exp:free",
            "messages": [{ "role": "user", "content": "How many r's in strawberry?" }]
        })
    });

    const result1 = await response1.json();

    // حماية: التأكد من أن الـ API رد ببيانات سليمة
    if (!result1.choices || result1.choices.length === 0) {
        return res.status(500).json({
            error: "OpenRouter API Error",
            details: result1.error || "No choices returned",
            raw: result1 // عشان تشوف الـ Error الحقيقي في Hoppscotch
        });
    }

    const assistantMessage = result1.choices[0].message;
    // ... باقي الكود
}

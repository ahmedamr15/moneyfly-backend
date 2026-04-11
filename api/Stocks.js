export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;

    // 1. Guard against missing API Key
    if (!apiKey) {
        return res.status(500).json({ error: "Environment variable TWELVE_DATA_KEY is not set in Vercel." });
    }

    // 2. Short list for testing (We can expand this once we see it live)
    const symbols = ["AAPL", "BTC/USD", "PAXG/USD"];
    const symbolsString = symbols.join(",");
    const url = `https://api.twelvedata.com/price?symbol=${symbolsString}&apikey=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        // 3. Check if Twelve Data returned an error (like 'Invalid API Key')
        if (data.status === "error") {
            return res.status(400).json({ 
                error: "Twelve Data API Error", 
                message: data.message 
            });
        }

        // 4. Return the data to your iOS app
        return res.status(200).json({
            status: "success",
            timestamp: new Date().toISOString(),
            prices: data
        });

    } catch (error) {
        return res.status(500).json({ 
            error: "Function Crash", 
            details: error.message 
        });
    }
}

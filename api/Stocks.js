const axios = require('axios');

export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: "API Key is missing from Vercel Environment Variables" });
    }

    // Start with a very small list to verify it works
    const symbols = ["AAPL", "MSFT", "PAXGUSDT"]; 
    const symbolsString = symbols.join(",");

    try {
        const url = `https://api.twelvedata.com/price?symbol=${symbolsString}&apikey=${apiKey}`;
        const response = await axios.get(url);
        
        // Twelve Data sometimes returns 200 OK but with an error message in the body
        if (response.data.status === "error") {
            return res.status(400).json({ error: response.data.message });
        }

        res.status(200).json({
            success: true,
            data: response.data
        });

    } catch (error) {
        res.status(500).json({ 
            error: "Axios Fetch Failed", 
            details: error.message 
        });
    }
}

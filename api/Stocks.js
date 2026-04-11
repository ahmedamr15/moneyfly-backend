export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;

    // Let's go back to a very safe list to identify the problem
    // 1. We'll use the ISIN for Juhayna and a standard ticker for Apple
    const symbols = ["AAPL", "BTC/USD", "EGS30901C010"];

    try {
        const priceRes = await fetch(`https://api.twelvedata.com/price?symbol=${symbols.join(",")}&apikey=${apiKey}`);
        const priceData = await priceRes.json();

        // CHECK: If Twelve Data sent an error instead of prices
        if (priceData.status === "error" || priceData.code === 400) {
            return res.status(400).json({ 
                error: "Twelve Data Error", 
                raw_response: priceData 
            });
        }

        // If it worked, we check the structure
        return res.status(200).json({
            status: "success",
            raw_data_received: priceData
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

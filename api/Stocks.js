export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;

    // We'll test the EGX ticker format. If this fails, we swap to a different free provider for EGX.
    const symbols = [
        "AAPL", "MSFT", "NVDA", "BTC/USD", "PAXG/USD", 
        "JUFO:EGX", "TMGH:EGX" 
    ];

    try {
        const priceRes = await fetch(`https://api.twelvedata.com/price?symbol=${symbols.join(",")}&apikey=${apiKey}`);
        const priceData = await priceRes.json();

        // 1. Get the USD/EGP rate for your conversion
        const rateRes = await fetch(`https://api.twelvedata.com/exchange_rate?symbol=USD/EGP&apikey=${apiKey}`);
        const rateData = await rateRes.json();
        const egpRate = parseFloat(rateData.rate) || 50.0; // Fallback if rate fails

        const formatted = [];

        // 2. Loop through results and only keep successful ones
        for (const [key, value] of Object.entries(priceData)) {
            if (value.price) {
                let price = parseFloat(value.price);
                let priceUsd = price;

                // Convert if it's an Egyptian ticker
                if (key.includes(":EGX")) {
                    priceUsd = price / egpRate;
                }

                formatted.push({
                    id: key,
                    name: key.split(':')[0], // Clean up "JUFO:EGX" to "JUFO"
                    price_local: price.toFixed(2),
                    price_usd: priceUsd.toFixed(2),
                    currency: key.includes(":EGX") ? "EGP" : "USD"
                });
            }
        }

        return res.status(200).json({
            status: "success",
            last_updated: new Date().toISOString(),
            usd_egp_rate: egpRate.toFixed(2),
            data: formatted
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

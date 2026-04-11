export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;

    // 1. Define our Tickers
    // Note: Use ISINs for EGX to ensure 100% compatibility with Twelve Data Free
    const symbols = [
        "AAPL", "MSFT", "NVDA", "TSLA",             // US
        "BTC/USD", "ETH/USD", "PAXG/USD",           // Crypto/Gold
        "EGS30901C010", "EGS305I1C011", "EGS38191C010", // Egypt (Juhayna, Edita, Abu Qir)
        "2222.SR", "1120.SR"                        // Saudi (Aramco, Al Rajhi)
    ];

    try {
        // 2. Fetch Prices and the USD/EGP rate in parallel
        const [priceRes, rateRes] = await Promise.all([
            fetch(`https://api.twelvedata.com/price?symbol=${symbols.join(",")}&apikey=${apiKey}`),
            fetch(`https://api.twelvedata.com/exchange_rate?symbol=USD/EGP&apikey=${apiKey}`)
        ]);

        const priceData = await priceRes.json();
        const rateData = await rateRes.json();
        const egpToUsdRate = parseFloat(rateData.rate);

        // 3. Format for your iOS App
        const formattedStocks = Object.keys(priceData).map(symbol => {
            let price = parseFloat(priceData[symbol].price);
            let finalPriceUsd = price;
            let currency = "USD";

            // If it's an Egyptian stock (starting with EGS), convert to USD
            if (symbol.startsWith("EGS")) {
                finalPriceUsd = price / egpToUsdRate;
                currency = "EGP";
            } else if (symbol.endsWith(".SR")) {
                finalPriceUsd = price / 3.75; // SAR is pegged to USD at 3.75
                currency = "SAR";
            }

            return {
                id: symbol,
                price_local: price.toFixed(2),
                price_usd: finalPriceUsd.toFixed(2),
                currency: currency
            };
        });

        return res.status(200).json({
            status: "success",
            last_updated: new Date().toISOString(),
            usd_egp_rate: egpToUsdRate.toFixed(4),
            data: formattedStocks
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

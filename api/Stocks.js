export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;
    const egxSymbols = ["JUFO.CA", "TMGH.CA", "SWDY.CA"]; // Yahoo Finance format
    const usSymbols = ["AAPL", "MSFT", "BTC/USD"];

    try {
        // 1. Fetch US/Crypto from Twelve Data
        const tdRes = await fetch(`https://api.twelvedata.com/price?symbol=${usSymbols.join(",")}&apikey=${apiKey}`);
        const tdData = await tdRes.json();

        // 2. Fetch Exchange Rate (USD/EGP)
        const rateRes = await fetch(`https://api.twelvedata.com/exchange_rate?symbol=USD/EGP&apikey=${apiKey}`);
        const rateData = await rateRes.json();
        const egpRate = parseFloat(rateData.rate) || 53.0;

        // 3. Fetch Egyptian Stocks from Yahoo Finance Mirror
        // We use a public 'query1.finance.yahoo.com' endpoint which is generally free to use
        const egxPrices = await Promise.all(egxSymbols.map(async (sym) => {
            const yfRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);
            const yfData = await yfRes.json();
            const price = yfData.chart.result[0].meta.regularMarketPrice;
            return {
                id: sym,
                name: sym.replace(".CA", ""),
                price_local: price.toFixed(2),
                price_usd: (price / egpRate).toFixed(2),
                currency: "EGP"
            };
        }));

        // 4. Format Twelve Data Results
        const usPrices = Object.keys(tdData).map(key => ({
            id: key,
            name: key,
            price_local: parseFloat(tdData[key].price).toFixed(2),
            price_usd: parseFloat(tdData[key].price).toFixed(2),
            currency: "USD"
        }));

        // 5. Combine and Return
        return res.status(200).json({
            status: "success",
            last_updated: new Date().toISOString(),
            data: [...usPrices, ...egxPrices]
        });

    } catch (error) {
        return res.status(500).json({ error: "Hybrid Fetch Failed", details: error.message });
    }
}

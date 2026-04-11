export default async function handler(req, res) {
    const apiKey = process.env.TWELVE_DATA_KEY;
    
    // Symbols to track
    const egxSymbols = ["JUFO.CA", "TMGH.CA", "SWDY.CA"]; 
    const usSymbols = ["AAPL", "MSFT", "BTC/USD"];

    try {
        // 1. Get the USD/EGP rate from Twelve Data (we know this works great)
        const rateRes = await fetch(`https://api.twelvedata.com/exchange_rate?symbol=USD/EGP&apikey=${apiKey}`);
        const rateData = await rateRes.json();
        const egpRate = parseFloat(rateData.rate) || 53.11;

        // 2. Get Live EGX Prices from the v7 Quote Endpoint (The most accurate)
        const yfUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${egxSymbols.join(",")}`;
        const yfRes = await fetch(yfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const yfData = await yfRes.json();
        
        // Map the Egyptian results
        const egxPrices = yfData.quoteResponse.result.map(quote => ({
            id: quote.symbol,
            name: quote.symbol.replace(".CA", ""),
            price_local: quote.regularMarketPrice.toFixed(2), // This will show 26.60
            price_usd: (quote.regularMarketPrice / egpRate).toFixed(2),
            currency: "EGP"
        }));

        // 3. Get US/Crypto from Twelve Data
        const tdRes = await fetch(`https://api.twelvedata.com/price?symbol=${usSymbols.join(",")}&apikey=${apiKey}`);
        const tdData = await tdRes.json();

        const usPrices = Object.keys(tdData).map(key => ({
            id: key,
            name: key.split('/')[0],
            price_local: parseFloat(tdData[key].price).toFixed(2),
            price_usd: parseFloat(tdData[key].price).toFixed(2),
            currency: "USD"
        }));

        // 4. Send back the combined, accurate data
        return res.status(200).json({
            status: "success",
            last_updated: new Date().toISOString(),
            usd_egp_rate: egpRate.toFixed(2),
            data: [...usPrices, ...egxPrices]
        });

    } catch (error) {
        return res.status(500).json({ error: "Fetch Failed", details: error.message });
    }
}

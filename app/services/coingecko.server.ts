// Using CoinGecko API - Free, no API key needed for public endpoints
const API_BASE_URL = "https://api.coingecko.com/api/v3";

interface CoinPrice {
  usd: number;
  // Add other currencies if needed
}

interface CoinPricesResponse {
  [id: string]: CoinPrice;
}

interface HistoryResponse {
    prices: [number, number][]; // [timestamp, price]
    market_caps: [number, number][];
    total_volumes: [number, number][];
}

/**
 * Fetches current prices for given crypto IDs from CoinGecko.
 * @param ids Array of coin IDs (e.g., ['bitcoin', 'ethereum'])
 * @returns Object with coin IDs as keys and their prices
 */
export async function fetchCryptoPrices(ids: string[]): Promise<CoinPricesResponse> {
  if (!ids || ids.length === 0) {
    console.log("fetchCryptoPrices: No IDs provided, returning empty object.");
    return {};
  }
  const idsString = ids.join(",");
  const url = `${API_BASE_URL}/simple/price?ids=${idsString}&vs_currencies=usd`;
  console.log(`fetchCryptoPrices: Fetching URL: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Log more details on failure
      const errorBody = await response.text();
      console.error(`fetchCryptoPrices: CoinGecko API request failed! Status: ${response.status}, StatusText: ${response.statusText}, Body: ${errorBody}`);
      throw new Error(`CoinGecko API request failed: ${response.status} ${response.statusText}`);
    }
    const data: CoinPricesResponse = await response.json();
    console.log(`fetchCryptoPrices: Received data for IDs [${idsString}]:`, data);
    return data;
  } catch (error) {
    console.error("fetchCryptoPrices: Error during fetch:", error);
    throw error; // Re-throw to be caught by the loader
  }
}


/**
 * Fetches historical market data for a specific coin from CoinGecko.
 * @param id Coin ID (e.g., 'bitcoin')
 * @param days Number of days for historical data
 * @returns Object containing prices, market caps, and total volumes
 */
export async function fetchCryptoHistory(id: string, days: number = 90): Promise<HistoryResponse> {
  const url = `${API_BASE_URL}/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  console.log(`fetchCryptoHistory: Fetching URL: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
       // Log more details on failure
      const errorBody = await response.text();
      console.error(`fetchCryptoHistory: CoinGecko API request failed! Status: ${response.status}, StatusText: ${response.statusText}, Body: ${errorBody}`);
      throw new Error(`CoinGecko API request failed for history: ${response.status} ${response.statusText}`); // Include status
    }
    const data: HistoryResponse = await response.json();
    console.log(`fetchCryptoHistory: Received history data for ID [${id}]`);
    // Remove the last entry if it's for the current partial day
    if (data.prices && data.prices.length > 0) {
        const lastTimestamp = data.prices[data.prices.length - 1][0];
        const now = Date.now();
        // If the last data point is less than ~23 hours old, it might be incomplete for 'daily' interval
        if (now - lastTimestamp < 23 * 60 * 60 * 1000) {
             data.prices.pop();
             data.market_caps?.pop();
             data.total_volumes?.pop();
             console.log(`fetchCryptoHistory: Removed potentially incomplete last data point for ID [${id}]`);
        }
    }
    return data;
  } catch (error) {
    console.error(`fetchCryptoHistory: Error during fetch for ID [${id}]:`, error);
    throw error; // Re-throw to be caught by the loader
  }
}

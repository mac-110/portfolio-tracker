import { type AllPrices, type PriceData } from "~/routes/_index"; // Import the shared type

// --- GoldAPI.io Configuration ---
const GOLDAPI_API_KEY = 'goldapi-1awqnsm8rxzcft-io'; // User provided key
const API_BASE_URL = "https://www.goldapi.io/api";

// --- GoldAPI.io Response Interfaces ---
interface GoldApiResponse {
  timestamp: number;
  metal: string; // e.g., "XAU", "XAG"
  currency: string; // e.g., "USD"
  exchange: string;
  symbol: string;
  prev_close_price?: number; // Optional for historical?
  open_price?: number;     // Optional for historical?
  low_price?: number;      // Optional for historical?
  high_price?: number;     // Optional for historical?
  open_time?: number;      // Optional for historical?
  price: number; // The spot price we need (per ounce) - Assuming this is the closing price for historical
  ch?: number;             // Optional for historical?
  chp?: number;            // Optional for historical?
  ask?: number;            // Optional for historical?
  bid?: number;            // Optional for historical?
  price_gram_24k: number;
  price_gram_22k: number;
  price_gram_21k: number;
  price_gram_20k: number;
  price_gram_18k: number;
  price_gram_16k: number;
  price_gram_14k: number;
  price_gram_10k: number;
  // Historical specific fields (if any - based on potential API behavior)
  date?: string; // e.g., "2023-10-26" - API might return the requested date
}

// Structure for potential error responses
interface GoldApiError {
    error: string; // Error message
}

// Type guard to check if the response is an error
function isGoldApiError(response: any): response is GoldApiError {
    return typeof response === 'object' && response !== null && 'error' in response;
}


/**
 * Fetches current prices for given commodity symbols (XAU, XAG) from GoldAPI.io.
 * @param symbols Array of commodity symbols (currently supports 'XAU', 'XAG')
 * @returns Object with symbols as keys and their prices in the AllPrices format.
 */
export async function fetchCommodityPrices(symbols: string[]): Promise<AllPrices> {
  const serviceName = "fetchCommodityPrices";
  const supportedSymbols = ['XAU', 'XAG']; // Only fetch supported symbols
  const symbolsToFetch = symbols.filter(s => supportedSymbols.includes(s.toUpperCase()));

  if (!symbolsToFetch || symbolsToFetch.length === 0) {
    console.log(`${serviceName}: No supported symbols (XAU, XAG) provided.`);
    return {};
  }
  if (!GOLDAPI_API_KEY || GOLDAPI_API_KEY.startsWith('goldapi-') === false) {
      console.warn(`${serviceName}: GoldAPI.io API Key is not set or looks invalid. Commodity prices will not be fetched.`);
      return {};
  }

  const results: AllPrices = {};
  const errors: string[] = [];

  // GoldAPI free tier seems to allow batch requests, but let's fetch individually for simplicity and clearer error handling
  for (const symbol of symbolsToFetch) {
    const upperSymbol = symbol.toUpperCase(); // Ensure uppercase
    const url = `${API_BASE_URL}/${upperSymbol}/USD`; // Endpoint structure: /api/{symbol}/USD

    console.log(`${serviceName}: Fetching URL for ${upperSymbol}: ${url}`);
    // Note: GoldAPI free tier has limits (e.g., 1 req/sec, 500 req/month). No explicit delay added here, but keep in mind.

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-access-token': GOLDAPI_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`${serviceName}: API request failed for ${upperSymbol}! Status: ${response.status}, Body: ${errorBody}`);
        errors.push(`${upperSymbol}: HTTP ${response.status}`);
        continue; // Skip to next symbol
      }

      const data: GoldApiResponse | GoldApiError = await response.json();

      if (isGoldApiError(data)) {
          console.warn(`${serviceName}: GoldAPI.io API error for ${upperSymbol}: ${data.error}`);
          errors.push(`${upperSymbol}: ${data.error}`);
          continue; // Skip to next symbol
      }

      // Check if the response contains the expected price field
      if (data && typeof data.price === 'number') {
        results[upperSymbol] = { usd: data.price }; // Store using uppercase symbol
        console.log(`${serviceName}: Received price for ${upperSymbol}: ${data.price}`);
      } else {
        console.warn(`${serviceName}: Could not parse price for ${upperSymbol} from response:`, data);
        errors.push(`${upperSymbol}: Invalid price data`);
      }
    } catch (error: any) {
      console.error(`${serviceName}: Error during fetch for ${upperSymbol}:`, error);
      errors.push(`${upperSymbol}: Fetch failed (${error.message})`);
    }
  }

  if (errors.length > 0) {
      console.warn(`${serviceName}: Encountered errors for some symbols:`, errors);
      // Optionally, you could throw an error here if *all* requests failed
  }
  console.log(`${serviceName}: Returning results:`, results);
  return results;
}


/**
 * Fetches the price for a specific commodity symbol (XAU, XAG) on a given date from GoldAPI.io.
 * @param symbol The commodity symbol ('XAU' or 'XAG').
 * @param date The date in 'YYYYMMDD' format.
 * @returns PriceData object containing the price in USD, or null if an error occurs.
 */
export async function fetchCommodityPriceOnDate(symbol: string, date: string): Promise<PriceData | null> {
    const serviceName = "fetchCommodityPriceOnDate";
    const upperSymbol = symbol.toUpperCase();
    const supportedSymbols = ['XAU', 'XAG'];

    if (!supportedSymbols.includes(upperSymbol)) {
        console.warn(`${serviceName}: Unsupported symbol '${symbol}'. Only XAU and XAG are supported.`);
        return null;
    }

    // Basic validation for date format (YYYYMMDD)
    if (!/^\d{8}$/.test(date)) {
        console.warn(`${serviceName}: Invalid date format '${date}'. Expected YYYYMMDD.`);
        return null;
    }

    if (!GOLDAPI_API_KEY || GOLDAPI_API_KEY.startsWith('goldapi-') === false) {
        console.warn(`${serviceName}: GoldAPI.io API Key is not set or looks invalid. Historical commodity price will not be fetched.`);
        return null;
    }

    const url = `${API_BASE_URL}/${upperSymbol}/USD/${date}`; // Endpoint structure: /api/{symbol}/USD/{date}
    console.log(`${serviceName}: Fetching URL for ${upperSymbol} on ${date}: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-access-token': GOLDAPI_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`${serviceName}: API request failed for ${upperSymbol} on ${date}! Status: ${response.status}, Body: ${errorBody}`);
            // Handle specific errors like "No data available for the specified date" if the API provides them
            return null;
        }

        const data: GoldApiResponse | GoldApiError = await response.json();

        if (isGoldApiError(data)) {
            console.warn(`${serviceName}: GoldAPI.io API error for ${upperSymbol} on ${date}: ${data.error}`);
            return null;
        }

        // Check if the response contains the expected price field
        if (data && typeof data.price === 'number') {
            console.log(`${serviceName}: Received price for ${upperSymbol} on ${date}: ${data.price}`);
            return { usd: data.price };
        } else {
            console.warn(`${serviceName}: Could not parse price for ${upperSymbol} on ${date} from response:`, data);
            return null;
        }
    } catch (error: any) {
        console.error(`${serviceName}: Error during fetch for ${upperSymbol} on ${date}:`, error);
        return null;
    }
}

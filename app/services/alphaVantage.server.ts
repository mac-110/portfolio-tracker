import { type AllPrices } from "~/routes/_index"; // Import the shared type

// --- IMPORTANT: User's API Key is set below ---
const ALPHA_VANTAGE_API_KEY = '7GAGSE3KBU6OX1RC'; // User provided key
const API_BASE_URL = "https://www.alphavantage.co/query";

// --- Alpha Vantage API Response Interfaces ---

// Structure for the GLOBAL_QUOTE response (Stocks)
interface AlphaVantageGlobalQuote {
  "Global Quote": {
    "01. symbol": string;
    "02. open": string;
    "03. high": string;
    "04. low": string;
    "05. price": string; // Stock price
    "06. volume": string;
    "07. latest trading day": string;
    "08. previous close": string;
    "09. change": string;
    "10. change percent": string;
  };
}

// Structure for potential error responses or rate limit messages
interface AlphaVantageError {
    "Error Message"?: string;
    "Information"?: string; // Often used for rate limit messages
    "Note"?: string; // Sometimes used for API key usage notes
}

// Type guard to check if the response is an error/note
function isAlphaVantageError(response: any): response is AlphaVantageError {
    return typeof response === 'object' && response !== null &&
           ('Error Message' in response || 'Information' in response || 'Note' in response);
}

// --- Helper: Shared Fetch Logic with Delay ---
async function fetchWithDelay(url: string, assetId: string, serviceName: string): Promise<any> {
    console.log(`${serviceName}: Fetching URL for ${assetId}: ${url.replace(ALPHA_VANTAGE_API_KEY, '***')}`);
    // Add a delay between requests to help avoid rate limits (adjust if needed)
    // ~13 seconds delay aims for under 5 calls/minute.
    await new Promise(resolve => setTimeout(resolve, 13000));

    const response = await fetch(url);
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`${serviceName}: API request failed for ${assetId}! Status: ${response.status}, Body: ${errorBody}`);
        throw new Error(`HTTP ${response.status}`); // Throw to be caught by caller
    }
    return response.json();
}

/**
 * Fetches current prices for given stock symbols from Alpha Vantage.
 * Uses the GLOBAL_QUOTE function.
 * @param symbols Array of stock symbols (e.g., ['AAPL', 'MSFT'])
 * @returns Object with stock symbols as keys and their prices in the AllPrices format.
 */
export async function fetchStockPrices(symbols: string[]): Promise<AllPrices> {
  const serviceName = "fetchStockPrices";
  if (!symbols || symbols.length === 0) {
    console.log(`${serviceName}: No symbols provided.`);
    return {};
  }
  // Use a placeholder if the actual key isn't set, but log a warning.
  if (ALPHA_VANTAGE_API_KEY === 'YOUR_ALPHAVANTAGE_API_KEY' || !ALPHA_VANTAGE_API_KEY) {
      console.warn(`${serviceName}: Alpha Vantage API Key is not set or invalid. Stock prices will not be fetched.`);
      return {};
  }

  const results: AllPrices = {};
  const errors: string[] = [];

  for (const symbol of symbols) {
    const url = `${API_BASE_URL}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    try {
      const data: AlphaVantageGlobalQuote | AlphaVantageError = await fetchWithDelay(url, symbol, serviceName);

      if (isAlphaVantageError(data)) {
          let errorMessage = data["Error Message"] || data["Information"] || data["Note"] || "Unknown API message";
          console.warn(`${serviceName}: Alpha Vantage API message for ${symbol}: ${errorMessage}`);
          // Specific check for common free tier messages
          if (errorMessage.includes("free plan") || errorMessage.includes("premium endpoint")) {
             errorMessage = `Free tier limit or premium endpoint issue for ${symbol}.`;
          }
          errors.push(`${symbol}: ${errorMessage}`);
          continue;
      }

      if (data["Global Quote"] && data["Global Quote"]["05. price"]) {
        const price = parseFloat(data["Global Quote"]["05. price"]);
        if (!isNaN(price)) {
          results[symbol] = { usd: price };
          console.log(`${serviceName}: Received price for ${symbol}: ${price}`);
        } else {
          console.warn(`${serviceName}: Could not parse price for ${symbol} from response:`, data);
          errors.push(`${symbol}: Invalid price data`);
        }
      } else {
        console.warn(`${serviceName}: No 'Global Quote' data found for ${symbol}. Response:`, data);
        // Check if the quote object is empty, often indicating an invalid symbol for GLOBAL_QUOTE
        if (!data["Global Quote"] || Object.keys(data["Global Quote"]).length === 0) {
             errors.push(`${symbol}: No data found (possibly invalid symbol or API issue)`);
        } else {
             errors.push(`${symbol}: Unexpected response structure`);
        }
      }
    } catch (error: any) {
      console.error(`${serviceName}: Error during fetch for ${symbol}:`, error);
      errors.push(`${symbol}: Fetch failed (${error.message})`);
    }
  }

  if (errors.length > 0) {
      console.warn(`${serviceName}: Encountered errors for some symbols:`, errors);
  }
  console.log(`${serviceName}: Returning results:`, results);
  return results;
}

// Removed fetchCommodityPrices function as it was causing errors with the free API key.
// console.log("fetchCommodityPrices function removed due to API issues with XAU/XAG on free tier.");

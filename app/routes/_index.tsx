import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form, useFetcher } from "@remix-run/react";
import { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { fetchCryptoPrices, fetchCryptoHistory } from "~/services/coingecko.server";
import { fetchStockPrices } from "~/services/alphaVantage.server";
// Import the new GoldAPI service
import { fetchCommodityPrices } from "~/services/goldapi.server";

// --- Asset Type Definition ---
interface Asset {
  id: string; // Unique identifier (e.g., 'bitcoin', 'AAPL', 'XAU')
  type: 'crypto' | 'stock' | 'commodity' | 'real_estate' | 'other';
  symbol: string; // Ticker symbol or common abbreviation (e.g., 'BTC', 'AAPL', 'XAU')
  name: string; // User-friendly name (e.g., 'Bitcoin', 'Apple Inc.', 'Gold')
  quantity: number; // Amount of the asset (e.g., number of shares, ounces of gold)
  purchaseValue?: number; // Optional: Original total purchase value
  currentValue?: number; // Used for manual entry like real estate
}

// Interface for asset with calculated values
interface CalculatedAsset extends Asset {
    price?: number; // Current market price per unit (share, ounce, coin, etc.)
    calculatedValue?: number; // Calculated current value (quantity * price or manual entry)
}

// --- Price Data Structure (Unified) ---
// Use the asset ID as the key (e.g., 'bitcoin', 'AAPL', 'XAU')
export interface PriceData {
    usd: number; // Price in USD
}
export interface AllPrices {
    [assetId: string]: PriceData;
}


// --- LocalStorage Key ---
const PORTFOLIO_STORAGE_KEY = "portfolioData";

export const meta: MetaFunction = () => {
  return [
    { title: "Portfolio Tracker" },
    { name: "description", content: "Track your asset portfolio" },
  ];
};

// --- Helper: Get Portfolio from LocalStorage (Client-Side) ---
const getClientPortfolio = (): Asset[] => {
  if (typeof window === 'undefined') return [];
  const storedData = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
  try {
    const parsedData = storedData ? JSON.parse(storedData) : [];
    // Ensure numeric types are correctly parsed
    return parsedData.map((asset: any) => ({
        ...asset,
        quantity: parseFloat(asset.quantity || "0"),
        purchaseValue: asset.purchaseValue ? parseFloat(asset.purchaseValue) : undefined,
        currentValue: asset.currentValue ? parseFloat(asset.currentValue) : undefined,
    }));
  } catch (e) {
    console.error("Failed to parse portfolio from localStorage", e);
    return [];
  }
};

// --- Helper: Save Portfolio to LocalStorage (Client-Side) ---
const saveClientPortfolio = (portfolio: Asset[]) => {
  if (typeof window === 'undefined') return;
  // Ensure calculated fields (price, calculatedValue) are not saved
  const dataToSave = portfolio.map(({ price, calculatedValue, ...asset }) => asset);
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(dataToSave));
};


// --- Server-Side Loader ---
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const cryptoIdsParam = url.searchParams.get("cryptoIds");
  const stockSymbolsParam = url.searchParams.get("stockSymbols");
  // Add commodity symbols parameter
  const commoditySymbolsParam = url.searchParams.get("commoditySymbols");

  const cryptoIds = cryptoIdsParam ? cryptoIdsParam.split(',').filter(id => id.trim() !== '') : [];
  const stockSymbols = stockSymbolsParam ? stockSymbolsParam.split(',').filter(sym => sym.trim() !== '') : [];
  // Parse commodity symbols
  const commoditySymbols = commoditySymbolsParam ? commoditySymbolsParam.split(',').filter(sym => sym.trim() !== '') : [];

  console.log(`Loader: Received request for cryptoIds: [${cryptoIds.join(', ')}], stockSymbols: [${stockSymbols.join(', ')}], commoditySymbols: [${commoditySymbols.join(', ')}]`);

  // Determine the asset ID for history fetch (still based on the first crypto ID)
  const historyAssetId = cryptoIds.length > 0 ? cryptoIds[0] : null;

  try {
    // Fetch current prices for crypto, stocks, and commodities in parallel
    const cryptoPricesPromise = fetchCryptoPrices(cryptoIds);
    const stockPricesPromise = fetchStockPrices(stockSymbols);
    // Fetch commodity prices using the new service
    const commodityPricesPromise = fetchCommodityPrices(commoditySymbols);

    // Fetch history ONLY if we have a valid historyAssetId (crypto)
    const historyPromise = historyAssetId
      ? fetchCryptoHistory(historyAssetId, 90)
      : Promise.resolve(null);

    // Wait for all promises
    const [
        cryptoPricesResult,
        stockPricesResult,
        commodityPricesResult, // Add commodity result
        historyDataResult
    ] = await Promise.all([
      cryptoPricesPromise,
      stockPricesPromise,
      commodityPricesPromise, // Add promise
      historyPromise
    ]);

    // Merge crypto, stock, and commodity prices
    const currentPrices: AllPrices = {
        ...(cryptoPricesResult || {}),
        ...(stockPricesResult || {}),
        ...(commodityPricesResult || {}), // Merge commodity prices
    };
    console.log("Loader: Merged Prices (Crypto/Stock/Commodity):", currentPrices);


    let chartData: any[] = [];
    let chartAssetName = historyAssetId ?? 'N/A';

    if (historyDataResult) {
      chartData = historyDataResult.prices.map(entry => ({
        date: new Date(entry[0]).toLocaleDateString(),
        value: entry[1]
      }));
      console.log(`Loader: Successfully processed history for ${chartAssetName}`);
    } else if (historyAssetId) {
        console.log(`Loader: History fetch was attempted for ${historyAssetId} but resulted in null/error.`);
    } else {
        console.log(`Loader: No crypto IDs provided, skipping history fetch.`);
        chartAssetName = 'N/A';
    }

    console.log(`Loader: Returning merged prices and chart data for ${chartAssetName}`);

    return json({
      currentPrices, // Return merged prices
      chartData,
      chartAssetName
    });

  } catch (error: any) {
    console.error("Loader: Error during data fetching:", error.message);
    if (error.cause) {
        console.error("Loader: Caused by:", error.cause);
    }
    // Return empty/error state, ensuring currentPrices is defined
    return json({
      currentPrices: {},
      chartData: [],
      chartAssetName: 'Error'
    }, { status: 500 });
  }
}

// --- Server-Side Action ---
export async function action({ request }: ActionFunctionArgs) {
  // No changes needed here for now
  return redirect(request.url);
}


// --- Client-Side Component ---
export default function Index() {
  const initialLoaderData = useLoaderData<typeof loader>();
  const priceFetcher = useFetcher<typeof loader>();

  const [portfolio, setPortfolio] = useState<Asset[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [clientChartData, setClientChartData] = useState<any[]>([]);

  // Get current prices (merged crypto/stock/commodity) from fetcher or initial load
  const currentPrices = useMemo(() => {
    const prices = priceFetcher.data?.currentPrices ?? initialLoaderData.currentPrices;
    console.log("Memo: currentPrices updated (Crypto/Stock/Commodity):", prices);
    return prices || {};
  }, [priceFetcher.data?.currentPrices, initialLoaderData.currentPrices]);

  // Chart data and name logic remains the same
   const serverChartData = useMemo(() => {
    const data = priceFetcher.data?.chartData ?? initialLoaderData.chartData;
     console.log("Memo: serverChartData updated:", data);
    return data || [];
  }, [priceFetcher.data?.chartData, initialLoaderData.chartData]);

   const chartAssetName = useMemo(() => {
    const name = priceFetcher.data?.chartAssetName ?? initialLoaderData.chartAssetName;
     console.log("Memo: chartAssetName updated:", name);
    return name || 'N/A';
  }, [priceFetcher.data?.chartAssetName, initialLoaderData.chartAssetName]);


  // Effect 1: Load portfolio from localStorage on mount
  useEffect(() => {
    console.log("Effect 1: Component mounted, loading portfolio from localStorage.");
    setPortfolio(getClientPortfolio());
  }, []);

  // Effect 2: Fetch prices/history based on the loaded portfolio (Crypto/Stock/Commodity)
  useEffect(() => {
    console.log("Effect 2: Checking if price fetch is needed.");
    if (portfolio.length > 0 && priceFetcher.state === 'idle') {
      // Get IDs/Symbols for fetchable types (Crypto/Stock/Commodity)
      const cryptoIds = portfolio
        .filter(asset => asset.type === 'crypto' && asset.id)
        .map(asset => asset.id);
      const stockSymbols = portfolio
        .filter(asset => asset.type === 'stock' && asset.id)
        .map(asset => asset.id);
      // Add commodity symbols (XAU, XAG)
      const commoditySymbols = portfolio
        .filter(asset => asset.type === 'commodity' && (asset.id === 'XAU' || asset.id === 'XAG'))
        .map(asset => asset.id);

      // Construct the query string (Crypto/Stock/Commodity)
      const cryptoQuery = cryptoIds.length > 0 ? `&cryptoIds=${cryptoIds.join(',')}` : '';
      const stockQuery = stockSymbols.length > 0 ? `&stockSymbols=${stockSymbols.join(',')}` : '';
      // Add commodity query
      const commodityQuery = commoditySymbols.length > 0 ? `&commoditySymbols=${commoditySymbols.join(',')}` : '';
      const query = `?index${cryptoQuery}${stockQuery}${commodityQuery}`; // Combine queries

      // Determine if a fetch is necessary based on combined IDs and chart name
      const currentFetchedIds = Object.keys(priceFetcher.data?.currentPrices ?? {}).sort().join(',');
      const neededCryptoIds = cryptoIds.sort();
      const neededStockIds = stockSymbols.sort();
      // Add needed commodity IDs
      const neededCommodityIds = commoditySymbols.sort();
      // Combine and sort all needed IDs (Crypto/Stock/Commodity)
      const neededIds = [...neededCryptoIds, ...neededStockIds, ...neededCommodityIds].sort().join(',');

      const currentChartName = priceFetcher.data?.chartAssetName ?? initialLoaderData.chartAssetName;
      // Chart name still based on first crypto ID
      const neededChartName = cryptoIds.length > 0 ? cryptoIds[0] : 'N/A';

      // Fetch if data is missing, IDs changed, or chart name changed
      if (!priceFetcher.data || neededIds !== currentFetchedIds || neededChartName !== currentChartName) {
        console.log(`Effect 2: Fetching data. Query: ${query}, Needed IDs: [${neededIds}], Current IDs: [${currentFetchedIds}], Needed Chart: ${neededChartName}, Current Chart: ${currentChartName}`);
        priceFetcher.load(query);
      } else {
        console.log("Effect 2: Data already up-to-date, skipping fetch.");
      }
    } else if (priceFetcher.state !== 'idle') {
       console.log(`Effect 2: Fetcher is busy (${priceFetcher.state}), skipping fetch check.`);
    } else {
       console.log("Effect 2: Portfolio is empty, skipping fetch check.");
       // Clear fetcher data if portfolio becomes empty
       if (priceFetcher.data && Object.keys(priceFetcher.data.currentPrices).length > 0) {
           console.log("Effect 2: Portfolio empty, reloading fetcher with no IDs.");
           priceFetcher.load("?index");
       }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio, priceFetcher.state]); // Rerun when portfolio or fetcher state changes


  // Memo 1: Calculate portfolio with derived values (Commodities now included)
  const portfolioWithCalculatedValues = useMemo((): CalculatedAsset[] => {
    console.log("Memo 1: Recalculating derived portfolio. Prices available (Crypto/Stock/Commodity):", currentPrices);
    return portfolio.map((asset) => {
      let calculatedValue: number | undefined = undefined;
      let price: number | undefined = undefined;
      const assetPriceData = currentPrices[asset.id]; // Use asset.id as the key (works for crypto, stock, XAU, XAG)

      if (assetPriceData && (asset.type === 'crypto' || asset.type === 'stock' || asset.type === 'commodity')) {
          price = assetPriceData.usd; // Use the 'usd' field
          calculatedValue = asset.quantity * price;
          console.log(` -> ${asset.type.toUpperCase()} Value: ${asset.name} (${asset.id}) - Qty: ${asset.quantity}, Price: ${price}, Value: ${calculatedValue}`);
      } else if (asset.type === "real_estate" && asset.currentValue !== undefined) {
        calculatedValue = asset.currentValue;
        price = asset.quantity > 0 ? calculatedValue / asset.quantity : undefined; // Price per "unit"
         console.log(` -> Real Estate Value (Manual): ${asset.name} - Value: ${calculatedValue}, Price: ${price ?? 'N/A'}`);
      } else if (asset.type === 'other') { // Keep placeholder for 'other'
         calculatedValue = asset.purchaseValue ?? asset.quantity * 50; // Other dummy
         price = asset.quantity > 0 ? calculatedValue / asset.quantity : undefined; // Dummy price
         console.log(` -> Other Value (Placeholder): ${asset.name} - Value: ${calculatedValue}`);
      }
      else {
          // Asset type exists but price wasn't found (API error, invalid ID, rate limit, or type not fetchable like non-XAU/XAG commodity)
          console.log(` -> Price not found or not applicable for ${asset.type.toUpperCase()}: ${asset.name} (${asset.id})`);
          calculatedValue = undefined;
          price = undefined;
      }

      return {
        ...asset,
        price: price,
        calculatedValue: calculatedValue,
      };
    });
  }, [portfolio, currentPrices]);


  // Effect 3: Update total value and chart data based on calculated portfolio
  useEffect(() => {
    console.log("Effect 3: Updating total value and chart data.");
    const newTotalValue = portfolioWithCalculatedValues.reduce(
      (sum, asset) => sum + (asset.calculatedValue || 0), // Assets without value add 0
      0
    );
    setTotalValue(newTotalValue);

    // Chart logic remains the same (based on crypto history)
    const assetForChart = (chartAssetName && chartAssetName !== 'N/A' && chartAssetName !== 'Error')
        ? portfolioWithCalculatedValues.find(a => a.id === chartAssetName)
        : undefined;

    if (assetForChart && serverChartData.length > 0) {
        const updatedChartData = serverChartData.map(entry => ({
            ...entry,
            value: entry.value * (assetForChart.quantity ?? 0) // Multiply historical price by current quantity
        }));
        setClientChartData(updatedChartData);
         console.log(`Effect 3: Updated chart data for ${chartAssetName} with quantity ${assetForChart.quantity}. Entries: ${updatedChartData.length}`);
    } else {
        setClientChartData([]);
        console.log(`Effect 3: Cleared chart data (Asset: ${chartAssetName}, Found: ${!!assetForChart}, ServerData: ${serverChartData.length})`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioWithCalculatedValues, serverChartData, chartAssetName]);


  // --- Client-Side Handlers ---
  const handleAddAsset = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    let id = formData.get("id") as string;
    const type = formData.get("type") as Asset['type'];
    const name = formData.get("name") as string;
    const symbol = formData.get("symbol") as string;
    const quantity = parseFloat(formData.get("quantity") as string || "0");
    const purchaseValue = formData.get("purchaseValue") ? parseFloat(formData.get("purchaseValue") as string) : undefined;
    const manualCurrentValue = formData.get("currentValue") ? parseFloat(formData.get("currentValue") as string) : undefined;

    if (!name || !symbol || !type || isNaN(quantity)) {
        alert("Please fill in required fields (Name, Symbol, Type, Quantity).");
        return;
    }

    // Standardize ID based on type
    if (id) { // Only process if ID is provided
        id = id.trim();
        if (type === 'crypto') {
            id = id.toLowerCase();
        } else if (type === 'stock' || type === 'commodity') {
            id = id.toUpperCase();
            // Validate specific commodity IDs we can fetch
            if (type === 'commodity' && id !== 'XAU' && id !== 'XAG') {
                alert(`Invalid Commodity ID '${id}'. Only 'XAU' (Gold) and 'XAG' (Silver) are supported for automatic price fetching.`);
                return;
            }
        }
    }

    // Auto-generate ID logic for types that don't require a specific fetch ID
    const requiresFetchId = type === 'crypto' || type === 'stock' || (type === 'commodity' && (id === 'XAU' || id === 'XAG'));

    if (!id && requiresFetchId) {
         alert(`Please provide the required ID: CoinGecko ID for Crypto, Ticker Symbol for Stock, or 'XAU'/'XAG' for Commodity.`);
         return;
    } else if (!id && (type === 'real_estate' || type === 'other' || type === 'commodity')) {
         // Auto-gen ID if blank for types not needing specific fetch IDs (or non-XAU/XAG commodities)
         id = `asset-${type}-${Date.now()}`;
         console.log(`handleAddAsset: Auto-generated ID for type ${type}: ${id}`);
    }


    const newAsset: Asset = {
      id: id, // Use the processed or generated ID
      name: name,
      symbol: symbol, // Keep original symbol input
      type: type,
      quantity: quantity,
      purchaseValue: purchaseValue,
      ...(type === 'real_estate' && manualCurrentValue !== undefined && { currentValue: manualCurrentValue })
    };

    console.log("handleAddAsset: Preparing to add asset:", newAsset);

    setPortfolio(prevPortfolio => {
        if (prevPortfolio.some(asset => asset.id === newAsset.id)) {
            alert(`Asset with ID '${newAsset.id}' already exists.`);
            return prevPortfolio;
        }
        const updatedPortfolio = [...prevPortfolio, newAsset];
        saveClientPortfolio(updatedPortfolio);
        console.log("handleAddAsset: Added asset, updated portfolio state:", updatedPortfolio);
        return updatedPortfolio;
    });

    event.currentTarget.reset();
  };

  const handleRemoveAsset = (assetId: string) => {
     console.log(`handleRemoveAsset: Preparing to remove asset ID: ${assetId}`);
     setPortfolio(prevPortfolio => {
        const updatedPortfolio = prevPortfolio.filter(asset => asset.id !== assetId);
        saveClientPortfolio(updatedPortfolio);
        console.log("handleRemoveAsset: Removed asset, updated portfolio state:", updatedPortfolio);
        return updatedPortfolio;
     });
  };


  return (
    <div className="p-6 font-sans dark:bg-gray-900 min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-100">
        Portfolio Tracker {priceFetcher.state === 'loading' && <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">(Updating data...)</span>}
      </h1>

      {/* --- Add Asset Form --- */}
      <div className="mb-8 p-4 bg-gray-100 dark:bg-gray-800 rounded shadow">
        <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-200">Add New Asset</h2>
        <form onSubmit={handleAddAsset} className="grid grid-cols-1 md:grid-cols-3 gap-4">
           {/* Name */}
           <div>
             <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name*</label>
             <input type="text" name="name" id="name" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
           </div>
           {/* Symbol */}
           <div>
             <label htmlFor="symbol" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Symbol*</label>
             <input type="text" name="symbol" id="symbol" required placeholder="e.g., BTC, AAPL, XAU" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
           </div>
           {/* Type */}
           <div>
             <label htmlFor="type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Type*</label>
             <select name="type" id="type" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
               <option value="crypto">Crypto</option>
               <option value="stock">Stock</option>
               <option value="commodity">Commodity</option>
               <option value="real_estate">Real Estate</option>
               <option value="other">Other</option>
             </select>
           </div>
           {/* Quantity */}
           <div>
             <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Quantity* <small>(e.g., shares, coins, ounces)</small></label>
             <input type="number" step="any" name="quantity" id="quantity" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
           </div>
           {/* Purchase Value */}
           <div>
             <label htmlFor="purchaseValue" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Total Purchase Value ($)</label>
             <input type="number" step="any" name="purchaseValue" id="purchaseValue" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
           </div>
           {/* Current Value (Manual) */}
            <div>
             <label htmlFor="currentValue" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Current Value ($) <small>(For Real Estate)</small></label>
             <input type="number" step="any" name="currentValue" id="currentValue" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
             <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Only used for 'Real Estate' type.</p>
           </div>
           {/* ID */}
           <div className="md:col-span-3">
                <label htmlFor="id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Unique ID* <small>(See below)</small></label>
                <input type="text" name="id" id="id" placeholder="e.g., bitcoin, AAPL, XAU" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Required for price fetching:
                    <b>Crypto:</b> CoinGecko ID (lowercase, e.g., 'bitcoin').
                    <b>Stock:</b> Ticker Symbol (uppercase, e.g., 'AAPL'). <br />
                    <b>Commodity:</b> Use 'XAU' (Gold) or 'XAG' (Silver) for automatic price fetching (per ounce). <br />
                    Leave blank for Real Estate/Other/Other Commodities for auto-ID.
                </p>
           </div>
           {/* Submit Button */}
           <div className="md:col-span-3 flex justify-end">
             <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-600">
               Add Asset
             </button>
           </div>
        </form>
      </div>

      {/* --- Total Value Display --- */}
      <div className="mb-8 p-4 bg-blue-100 dark:bg-blue-900 rounded shadow">
        <h2 className="text-xl font-semibold text-blue-800 dark:text-blue-200">
          Total Portfolio Value: ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </h2>
         {/* Removed note about excluded commodities as XAU/XAG are now included */}
      </div>

      {/* --- Assets Table --- */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-700 dark:text-gray-200">My Assets</h2>
        <div className="overflow-x-auto shadow rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Symbol/ID</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Quantity</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Current Price</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Current Value</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {portfolioWithCalculatedValues.length > 0 ? portfolioWithCalculatedValues.map((asset) => {
                 // Determine if price is loading for this specific asset type (Crypto/Stock/Commodity)
                 const isLoadingPrice = priceFetcher.state === 'loading' &&
                    (asset.type === 'crypto' || asset.type === 'stock' || (asset.type === 'commodity' && (asset.id === 'XAU' || asset.id === 'XAG')));

                 // Determine if price is unavailable (Other, Real Estate without manual value, non-XAU/XAG commodity, or fetch error)
                 const isPriceUnavailable = asset.price === undefined && !isLoadingPrice;

                 return (
                    <tr key={asset.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">{asset.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{asset.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300 capitalize">{asset.type.replace(/_/g, ' ')}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">{asset.quantity.toLocaleString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                        {/* Display price */}
                        {asset.price !== undefined
                          ? `$${asset.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: (asset.type === 'crypto' && asset.price < 1) ? 8 : 2
                            })}`
                          : isLoadingPrice
                            ? 'Loading...'
                            : 'N/A' // Simplified N/A display
                        }
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                         {/* Display calculated value */}
                         {asset.calculatedValue !== undefined
                           ? `$${asset.calculatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                           : isLoadingPrice
                             ? 'Calculating...'
                             : 'N/A' // Simplified N/A display
                         }
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                         <button
                            onClick={() => handleRemoveAsset(asset.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-600"
                            aria-label={`Remove ${asset.name}`}
                          >
                            Remove
                          </button>
                      </td>
                    </tr>
                 );
              }) : (
                 <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        No assets added yet. Use the form above to add your first asset.
                    </td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

       {/* --- Chart --- */}
       {/* Chart section remains unchanged */}
       <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-700 dark:text-gray-200">
          Value History ({chartAssetName === 'N/A' || chartAssetName === 'Error' ? 'N/A' : chartAssetName.toUpperCase()})
        </h2>
        {clientChartData.length > 0 && chartAssetName !== 'N/A' && chartAssetName !== 'Error' ? (
           <div style={{ width: '100%', height: 400 }} className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
             <ResponsiveContainer>
              <LineChart data={clientChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ccc dark:#666" />
                <XAxis dataKey="date" stroke="#666 dark:#bbb" />
                <YAxis
                    stroke="#666 dark:#bbb"
                    domain={['auto', 'auto']}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                    width={80}
                 />
                <Tooltip
                    contentStyle={{ backgroundColor: 'rgba(50, 50, 50, 0.8)', color: '#fff', border: 'none', borderRadius: '4px', padding: '8px' }}
                    formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Value']}
                    labelStyle={{ color: '#aaa' }}
                 />
                <Legend wrapperStyle={{ color: '#666 dark:#bbb' }}/>
                <Line type="monotone" dataKey="value" stroke="#8884d8" activeDot={{ r: 8 }} name={`Value (${chartAssetName.toUpperCase()})`} dot={false} />
              </LineChart>
            </ResponsiveContainer>
           </div>
        ) : (
          <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded shadow border border-gray-200 dark:border-gray-700 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                {priceFetcher.state === 'loading' ? 'Loading chart data...' :
                 portfolio.length === 0 ? 'Add a crypto asset to see its value history.' :
                 chartAssetName === 'Error' ? `Failed to load history data.` :
                 chartAssetName === 'N/A' ? 'No crypto asset selected for history.' :
                 `Historical data for ${chartAssetName.toUpperCase()} is unavailable or the asset is not in the portfolio.`
                }
              </p>
          </div>
        )}
      </div>
    </div>
  );
}

// For Node 18+ with built-in fetch, no import needed.
// If on older versions, uncomment the following line after installing node-fetch:
import fetch from 'node-fetch';

//-----------------------------------------------------
// 1) CONFIGURATION
//-----------------------------------------------------
const ETHERSCAN_API_KEY = 'IA43NK5U6CJ792SSSTA8ABGE99QB99QFKU'; // Your Etherscan API key
const ALCHEMY_SEPOLIA_URL = 'https://eth-sepolia.g.alchemy.com/v2/DAFnOmNKDsUZv3tqw0KqLeLZO60jJ2rj'; // Your Alchemy Sepolia endpoint
const CONTRACT_ADDRESS = '0x5f5a404A5edabcDD80DB05E8e54A78c9EBF000C2'; // The contract to query
// Example: Transfer MethodID = 0xa9059cbb 
const METHOD_ID = process.argv[2] || '0xe11013dd'; // Pass the MethodID as an argument when running the script

// Gas price & ETH price config (hard-coded)
const GAS_PRICE_LOW = 2.603;      // in gwei
const GAS_PRICE_AVERAGE = 2.606;  // in gwei
const GAS_PRICE_HIGH = 2.7;       // in gwei
const ETH_PRICE_USD = 3260;       // in USD/ETH

//-----------------------------------------------------
// 2) HELPER FUNCTIONS
//-----------------------------------------------------

/**
 * Converts Gwei to Wei.
 * 1 Gwei = 1e9 Wei
 */
function gweiToWei(gweiValue) {
  return gweiValue * 1e9;
}

/**
 * Converts Wei to Ether.
 * 1 ETH = 1e18 Wei
 */
function weiToEth(weiValue) {
  return Number(weiValue) / 1e18; 
}

/**
 * Makes a GET request to the Etherscan API to fetch the transactions
 * from the given contract address. Then filters by the specified MethodID.
 * Returns an array of up to `limit` transactions.
 */
async function getContractTransactions(contractAddress, methodId, limit = 5) {
  try {
    const url = `https://api-sepolia.etherscan.io/api?module=account&action=txlist` +
                `&address=${contractAddress}` +
                `&startblock=0&endblock=99999999&sort=desc` +
                `&apikey=${ETHERSCAN_API_KEY}`;

    // 1) Fetch from Etherscan
    const response = await fetch(url);
    if (!response.ok) {
      // If there's a non-2xx status code, throw an Error
      throw new Error(`Etherscan responded with status: ${response.status}`);
    }

    // 2) Convert to JSON
    const data = await response.json();
    if (!data || !data.result) {
      throw new Error(`No result from Etherscan response. Full response: ${JSON.stringify(data)}`);
    }

    // 3) Filter transactions by MethodID in input
    const allTransactions = data.result;
    const filteredTx = allTransactions.filter(tx =>
      tx.input && tx.input.toLowerCase().startsWith(methodId.toLowerCase())
    );

    // Return only the top `limit` transactions
    return filteredTx.slice(0, limit);

  } catch (error) {
    console.error('Error fetching transactions from Etherscan:', error.message);
    // Return an empty array to indicate failure or no transactions
    return [];
  }
}

/**
 * Queries the Alchemy node for the transaction receipt (eth_getTransactionReceipt)
 * Returns the receipt object or null if there's an error.
 */
async function getTransactionReceipt(txHash) {
  try {
    const payload = {
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [txHash],
      id: 1,
    };

    // POST to Alchemy
    const response = await fetch(ALCHEMY_SEPOLIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // If there's a non-2xx status code from Alchemy
      throw new Error(`Alchemy responded with status: ${response.status}`);
    }

    const data = await response.json();
    // If there's a JSON-RPC error, usually it's in data.error
    if (data.error) {
      throw new Error(`Alchemy JSON-RPC Error: ${JSON.stringify(data.error)}`);
    }

    return data.result;
  } catch (error) {
    console.error(`Error fetching transaction receipt for ${txHash}:`, error.message);
    return null;
  }
}

/**
 * Computes the total cost in ETH given gasUsed and gasPrice (in gwei).
 * costInWei = gasUsed * gasPriceInWei
 */
function computeCostInEth(gasUsed, gasPriceGwei) {
  const gasPriceWei = gweiToWei(gasPriceGwei);
  const costInWei = BigInt(gasUsed) * BigInt(Math.floor(gasPriceWei));
  return weiToEth(costInWei);
}

/**
 * Prints the final cost in ETH and USD for three scenarios (low, average, high)
 */
function printCostEstimates(gasUsed) {
  const costLowEth = computeCostInEth(gasUsed, GAS_PRICE_LOW);
  const costAvgEth = computeCostInEth(gasUsed, GAS_PRICE_AVERAGE);
  const costHighEth = computeCostInEth(gasUsed, GAS_PRICE_HIGH);

  console.log(`--- Gas Used: ${gasUsed} ---`);
  console.log(`Low    : ~${costLowEth.toFixed(6)} ETH (~$${(costLowEth * ETH_PRICE_USD).toFixed(2)})`);
  console.log(`Average: ~${costAvgEth.toFixed(6)} ETH (~$${(costAvgEth * ETH_PRICE_USD).toFixed(2)})`);
  console.log(`High   : ~${costHighEth.toFixed(6)} ETH (~$${(costHighEth * ETH_PRICE_USD).toFixed(2)})`);
}

//-----------------------------------------------------
// 3) MAIN LOGIC
//-----------------------------------------------------
(async function main() {
  console.log(`Querying last 5 transactions for Contract: ${CONTRACT_ADDRESS} with MethodID: ${METHOD_ID}\n`);

  // 1) Get transactions from Etherscan
  const transactions = await getContractTransactions(CONTRACT_ADDRESS, METHOD_ID, 5);
  if (!transactions.length) {
    console.log('No transactions found or could not retrieve transactions from Etherscan.');
    return;
  }

  // 2) Get gasUsed for each transaction
  let gasUsedArr = [];
  for (const tx of transactions) {
    const receipt = await getTransactionReceipt(tx.hash);
    if (receipt && receipt.gasUsed) {
      // gasUsed is a hex string, so parse to decimal
      const gasUsedDecimal = parseInt(receipt.gasUsed, 16);
      gasUsedArr.push(gasUsedDecimal);
      console.log(`TX Hash: ${tx.hash} | Gas Used: ${gasUsedDecimal}`);
    } else {
      console.log(`TX Hash: ${tx.hash} | Could not fetch gasUsed`);
    }
  }

  if (!gasUsedArr.length) {
    console.log('No valid transaction receipts found.');
    return;
  }

  // 3) Compute average gas used
  const sumGasUsed = gasUsedArr.reduce((acc, val) => acc + val, 0);
  const avgGasUsed = Math.floor(sumGasUsed / gasUsedArr.length);

  // 4) Apply 30% buffer to get recommended gas limit
  const recommendedGasLimit = Math.floor(avgGasUsed * 1.3);

  console.log(`\nAverage Gas Used (last ${gasUsedArr.length} txs): ${avgGasUsed}`);
  console.log(`Recommended Gas Limit (with 30% buffer): ${recommendedGasLimit}\n`);

  // 5) Show cost estimates for average usage and recommended gas limit
  console.log(`Cost estimates *using average gas used*`);
  printCostEstimates(avgGasUsed);

  console.log(`\nCost estimates *using recommended gas limit*`);
  printCostEstimates(recommendedGasLimit);
})();

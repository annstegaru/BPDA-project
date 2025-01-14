import fetch from 'node-fetch';

//-----------------------------------------------------
// 1) CONFIGURATION
//-----------------------------------------------------
const ETHERSCAN_API_KEY = 'IA43NK5U6CJ792SSSTA8ABGE99QB99QFKU'; //c Etherscan API key
const ALCHEMY_SEPOLIA_URL = 'https://eth-sepolia.g.alchemy.com/v2/DAFnOmNKDsUZv3tqw0KqLeLZO60jJ2rj'; // Alchemy Sepolia endpoint
const CONTRACT_ADDRESS = '0x5f5a404A5edabcDD80DB05E8e54A78c9EBF000C2'; // The contract to query
const METHOD_ID = process.argv[2] || '0xe11013dd'; // Pass the MethodID as an argument when running the script


//-----------------------------------------------------
// 2) HELPER FUNCTIONS
//-----------------------------------------------------

/**
 * Converts Gwei to Wei.
 * 1 Gwei = 1e9 Wei
 */
// 2.1. Gas & Price Conversions
function gweiToWei(gweiValue) {
    return gweiValue * 1e9; // 1 Gwei = 1e9 Wei
  }
  
  function weiToEth(weiValue) {
    return Number(weiValue) / 1e18; // 1 ETH = 1e18 Wei
  }
  
  // 2.2. Live ETH Price from CoinGecko
  async function getEthPriceUSD() {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
      );
      if (!response.ok) {
        throw new Error(`CoinGecko responded with status ${response.status}`);
      }
      const data = await response.json();
      // data will look like: { ethereum: { usd: 1234.56 } }
      return data.ethereum.usd;
    } catch (error) {
      console.error('Error fetching ETH price from CoinGecko:', error.message);
      // fallback or re-throw
      return 0; 
    }
  }
  
  // 2.3. Live Gas Price (Sepolia) - using Alchemy
async function getCurrentGasPriceWei() {
    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      };
      const response = await fetch(ALCHEMY_SEPOLIA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Alchemy responded with status: ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(`Alchemy JSON-RPC Error: ${JSON.stringify(data.error)}`);
      }
  
      // data.result is hex string, e.g. '0x59682f00'
      const gasPriceWei = parseInt(data.result, 16);
      return gasPriceWei;
    } catch (error) {
      console.error('Error fetching gas price from Alchemy:', error.message);
      return 0;
    }
  }
  
  // 2.4. Fetching Transactions from Etherscan
  async function getContractTransactions(contractAddress, methodId, limit = 5) {
    try {
      // Use page=1&offset=20 so you get up to 20 most recent txs
      // then filter by method, slice to 5
      const url =
        `https://api-sepolia.etherscan.io/api?module=account&action=txlist` +
        `&address=${contractAddress}` +
        `&startblock=0&endblock=99999999` +
        `&page=1&offset=20` + 
        `&sort=desc` +
        `&apikey=${ETHERSCAN_API_KEY}`;
  
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Etherscan responded with status: ${response.status}`);
      }
      const data = await response.json();
      if (!data || !data.result) {
        throw new Error(`No result from Etherscan. Full response: ${JSON.stringify(data)}`);
      }
  
      // Filter by Method ID
      const allTransactions = data.result;
      const filteredTx = allTransactions.filter(tx =>
        tx.input && tx.input.toLowerCase().startsWith(methodId.toLowerCase())
      );
  
      // Return only up to `limit` 
      return filteredTx.slice(0, limit);
    } catch (error) {
      console.error('Error fetching transactions from Etherscan:', error.message);
      return [];
    }
  }
  
  // 2.5. Fetch Transaction Receipt (gasUsed)
  async function getTransactionReceipt(txHash) {
    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      };
  
      const response = await fetch(ALCHEMY_SEPOLIA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
  
      if (!response.ok) {
        throw new Error(`Alchemy responded with status: ${response.status}`);
      }
  
      const data = await response.json();
      if (data.error) {
        throw new Error(`Alchemy JSON-RPC Error: ${JSON.stringify(data.error)}`);
      }
  
      return data.result;
    } catch (error) {
      console.error(`Error fetching transaction receipt for ${txHash}:`, error.message);
      return null;
    }
  }
  
  // 2.6. Compute cost in ETH given gasUsed and gasPrice (wei)
  function computeCostInEth(gasUsed, gasPriceWei) {
    const costInWei = BigInt(gasUsed) * BigInt(gasPriceWei);
    return weiToEth(costInWei);
  }
  
  //-----------------------------------------------------
  // 3) MAIN LOGIC
  //-----------------------------------------------------
  (async function main() {
    console.log(`Querying last 5 transactions for Contract: ${CONTRACT_ADDRESS} with MethodID: ${METHOD_ID}\n`);
  
    // 1) Fetch live ETH price
    const ethPriceUSD = await getEthPriceUSD();
    if (ethPriceUSD === 0) {
      console.log('Warning: Could not fetch live ETH price. Defaulting to 0.');
    } else {
      console.log(`Live ETH price: $${ethPriceUSD.toFixed(2)}\n`);
    }
  
    // 2) Fetch live gas price (in Wei) from Alchemy (Sepolia)
    const currentGasPriceWei = await getCurrentGasPriceWei();
    const currentGasPriceGwei = currentGasPriceWei / 1e9;

    if (currentGasPriceWei === 0) {
    console.log('Warning: Could not fetch live Gas Price. Defaulting to 0.');
    } else {
    console.log(`Live Gas Price: ${currentGasPriceWei} Wei (${currentGasPriceGwei.toFixed(2)} Gwei)\n`);
    }
  
    // 3) Get transactions from Etherscan
    const transactions = await getContractTransactions(CONTRACT_ADDRESS, METHOD_ID, 5);
    if (!transactions.length) {
      console.log('No transactions found or could not retrieve transactions from Etherscan.');
      return;
    }
  
    // 4) Get gasUsed for each transaction
    let gasUsedArr = [];
    for (const tx of transactions) {
      const receipt = await getTransactionReceipt(tx.hash);
      if (receipt && receipt.gasUsed) {
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
  
    // 5) Compute average gas used
    const sumGasUsed = gasUsedArr.reduce((acc, val) => acc + val, 0);
    const avgGasUsed = Math.floor(sumGasUsed / gasUsedArr.length);
  
    // 6) Apply 30% buffer
    const recommendedGasLimit = Math.floor(avgGasUsed * 1.3);
  
    console.log(`\nAverage Gas Used (last ${gasUsedArr.length} txs): ${avgGasUsed}`);
    console.log(`Recommended Gas Limit (with 30% buffer): ${recommendedGasLimit}\n`);
  
    // 7) Show cost estimates using *live* gas price
  
    console.log(`Cost estimates *using average gas used* with live gasPrice`);
    const costETHAvg = computeCostInEth(avgGasUsed, currentGasPriceWei);
    console.log(`  ~${costETHAvg.toFixed(6)} ETH  (~$${(costETHAvg * ethPriceUSD).toFixed(2)})`);
  
    console.log(`\nCost estimates *using recommended gas limit* with live gasPrice`);
    const costETHLimit = computeCostInEth(recommendedGasLimit, currentGasPriceWei);
    console.log(`  ~${costETHLimit.toFixed(6)} ETH  (~$${(costETHLimit * ethPriceUSD).toFixed(2)})`);
  })();
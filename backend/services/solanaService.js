const axios = require('axios');
const { PublicKey } = require('@solana/web3.js');
require('dotenv').config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;
const HELIUS_API_BASE_URL = process.env.HELIUS_API_BASE_URL;

if (!HELIUS_API_KEY || !HELIUS_API_BASE_URL) {
    console.warn("Warning: Helius API Key or Base URL not fully configured.");
}

const heliusApi = axios.create({
    baseURL: HELIUS_API_BASE_URL,
    headers: {
        'Authorization': `Bearer ${HELIUS_API_KEY}`,
        'Content-Type': 'application/json',
    }
});

const isValidSolanaAddress = (address) => {
    if (!address) return false;
    try {
        new PublicKey(address);
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    } catch (e) { return false; }
};

const getRecentTransactions = async (walletAddress, limit = 25) => {
    if (!isValidSolanaAddress(walletAddress)) { return []; }
    try {
        const response = await heliusApi.post(`/v0/addresses/${walletAddress}/transactions?limit=${limit}`);
        return response.data || [];
    } catch (error) {
        console.error(`Error getRecentTransactions for ${walletAddress}:`, error.response?.data?.error || error.message);
        return [];
    }
};

const findOutgoingSolTransfers = async (sourceWallet, sinceTimestamp) => {
    if (!isValidSolanaAddress(sourceWallet)) { return []; }
    try {
        const response = await heliusApi.post(`/v0/addresses/${sourceWallet}/transactions`, { type: "TRANSFER" });
        const transfers = response.data || [];
        const outgoingSol = [];
        for (const tx of transfers) {
            if (!tx.timestamp || tx.timestamp < sinceTimestamp || tx.error) continue;
            if (tx.nativeTransfers?.length > 0) {
                for (const nt of tx.nativeTransfers) {
                    if (nt.fromUserAccount === sourceWallet && nt.toUserAccount !== sourceWallet) {
                        if (!outgoingSol.some(ex => ex.signature === tx.signature)) {
                            outgoingSol.push({ signature: tx.signature, timestamp: tx.timestamp, recipient: nt.toUserAccount, amountLamports: nt.amount });
                        }
                        break;
                    }
                }
            }
        }
        return outgoingSol;
    } catch (error) {
        console.error(`Error findOutgoingSolTransfers for ${sourceWallet}:`, error.response?.data?.error || error.message);
        return [];
    }
};

const checkTokenCreationByRecipient = async (recipientWallet, sinceTimestamp) => {
    if (!isValidSolanaAddress(recipientWallet)) { return { created: false }; }
    try {
        const response = await heliusApi.post(`/v0/addresses/${recipientWallet}/transactions`, { limit: 50 });
        const transactions = response.data || [];
        for (const tx of transactions) {
            if (!tx.timestamp || tx.timestamp <= sinceTimestamp || tx.error || tx.meta?.err) continue;
            if (tx.instructions?.length > 0) {
                for (const ix of tx.instructions) {
                    const ixName = ix.name || '';
                    const accounts = ix.accounts || [];
                    if (ix.programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && ixName.toLowerCase().includes('initializemint')) {
                        const mintAccount = accounts.find(acc => acc.name?.toLowerCase() === 'mint');
                        if (mintAccount?.pubkey) return { created: true, tokenMintAddress: mintAccount.pubkey, transactionSignature: tx.signature, timestamp: tx.timestamp };
                    }
                    if (ix.programId === 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s' && ixName.toLowerCase().includes('createmetadataaccount')) {
                        const mintAccount = accounts.find(acc => acc.name?.toLowerCase() === 'mint');
                        if (mintAccount?.pubkey) return { created: true, tokenMintAddress: mintAccount.pubkey, transactionSignature: tx.signature, timestamp: tx.timestamp };
                    }
                }
            }
        }
        return { created: false };
    } catch (error) {
        if (error.response?.status !== 404) {
             console.error(`Error checkTokenCreation for ${recipientWallet}:`, error.response?.data?.error || error.message);
         }
        return { created: false, error: true };
    }
};

const getTransactionsForWallet = async (walletAddress, options = { limit: 50 }) => {
    if (!isValidSolanaAddress(walletAddress)) { return []; }
    try {
        const params = {};
        if (options.limit) params.limit = options.limit;
        if (options.beforeSignature) params.before = options.beforeSignature;
        const response = await heliusApi.post(`/v0/addresses/${walletAddress}/transactions`, params);
        let transactions = response.data || [];
        if (options.sinceTimestamp && transactions.length > 0) {
            transactions = transactions.filter(tx => tx.timestamp && tx.timestamp >= options.sinceTimestamp);
        }
        return transactions;
    } catch (error) {
         if (error.response?.status !== 404) {
             console.error(`Error getTransactionsForWallet for ${walletAddress}:`, error.response?.data?.error || error.message);
         }
        return [];
    }
};

const fetchTokenMetadataBulk = async (mintAddresses) => {
    if (!mintAddresses || mintAddresses.length === 0) return {};
    const metadataMap = {};
    const BATCH_SIZE = 100;
    for (let i = 0; i < mintAddresses.length; i += BATCH_SIZE) {
        const batch = mintAddresses.slice(i, i + BATCH_SIZE);
        try {
            const response = await heliusApi.post(`/v0/token-metadata`, { mintAccounts: batch, includeOffChain: true, disableCache: false });
            if (response.data && Array.isArray(response.data)) {
                response.data.forEach(item => {
                    const account = item?.account || item?.mint;
                    if (!account) return;
                    let name = 'Unknown';
                    let symbol = '?';
                    const onChainMeta = item.onChainMetadata?.metadata?.data;
                    const offChainMeta = item.offChainMetadata?.metadata;
                    const simplerMeta = item.metadata;
                    if (onChainMeta?.name || offChainMeta?.name || simplerMeta?.name) { name = onChainMeta?.name || offChainMeta?.name || simplerMeta?.name; }
                    if (onChainMeta?.symbol || offChainMeta?.symbol || simplerMeta?.symbol) { symbol = onChainMeta?.symbol || offChainMeta?.symbol || simplerMeta?.symbol; }
                    metadataMap[account] = { name: (name || '').replace(/\x00/g, '').trim(), symbol: (symbol || '').replace(/\x00/g, '').trim() };
                });
            }
        } catch (error) {
            if (error.response?.status !== 404) {
                 console.error(`Error fetchTokenMetadata batch starting ${batch[0]}:`, error.response?.data?.error || error.message);
             }
        }
    }
    return metadataMap;
};

module.exports = {
    getRecentTransactions,
    findOutgoingSolTransfers,
    checkTokenCreationByRecipient,
    isValidSolanaAddress,
    getTransactionsForWallet,
    fetchTokenMetadataBulk,
};
// backend/services/commonTokenService.js
const cron = require('node-cron');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const CommonTokenActivity = require('../models/CommonTokenActivity');
const { getTransactionsForWallet, fetchTokenMetadataBulk } = require('./solanaService');
// REMOVED: Direct import of monitorService status getter

// Constants remain the same
const MIN_COMMON_TRADING_WALLETS = 2;
const TX_FETCH_LIMIT_PER_RECIPIENT = 100;
const RECIPIENT_BATCH_SIZE = 10;

// Helper function remains the same
const extractTradedMintsFromTransactions = (transactions, recipientAddress) => {
    const mints = new Set();
    if (!transactions) return mints;
    for (const tx of transactions) {
        if (tx.error || tx.meta?.err) continue;
        if (tx.tokenTransfers?.length > 0) {
            tx.tokenTransfers.forEach(tf => {
                if (tf.mint && (tf.fromUserAccount === recipientAddress || tf.toUserAccount === recipientAddress)) {
                    if (tf.mint.length > 30 && tf.mint !== 'So11111111111111111111111111111111111111112') { mints.add(tf.mint); }
                }
            });
        }
    }
    return mints;
};

// --- Background Job 3: Find Common Traded Tokens by Recipients ---
const startCommonTokenJob = () => {
    // Schedule the job to run
    cron.schedule('*/15 * * * *', async () => { // Run every 15 minutes

        // **** CHANGE HERE: Check global status dynamically inside the callback ****
        let isEnabled = false;
        try {
            // Dynamically require monitorService ONLY to get the status
            isEnabled = require('./monitorService').getGlobalMonitoringStatus();
        } catch (err) {
            // Handle case where monitorService might not be fully initialized yet (less likely but safe)
            console.error("Error retrieving global monitoring status in commonTokenJob:", err);
            return; // Skip execution if status cannot be determined
        }

        if (!isEnabled) {
            // console.log('Cron (Common Tokens): Skipped - Global monitoring disabled.');
            return; // Exit the cron callback if monitoring is off
        }
        // **** END CHANGE ****

        console.log('Cron: Running Common Token Scan Job...');
        const startTime = Date.now();
        const timeframes = [60, 90, 120]; // Analyze for all supported windows

        try {
            for (const timeframeMinutes of timeframes) {
                // processCommonTokensForTimeframe checks recipients and their activity
                await processCommonTokensForTimeframe(timeframeMinutes);
            }
        } catch (error) {
            console.error(`Cron (Common Tokens): Unhandled error during job execution:`, error);
        } finally {
            console.log(`Cron: Common Token Scan Job finished in ${(Date.now() - startTime) / 1000}s.`);
        }
    }); // End cron.schedule callback
}; // End startCommonTokenJob


// Processes common token logic for a single timeframe (e.g., 60 mins)
// This function does NOT need the global status check, as it's only called if the job runs.
async function processCommonTokensForTimeframe(timeframeMinutes) {
    console.log(`Common Token (${timeframeMinutes} min): Starting processing.`);
    const processStart = Date.now();
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const timeframeSeconds = timeframeMinutes * 60;
    const sinceTimestamp = nowTimestamp - timeframeSeconds;

    let apiErrorCount = 0; // Track errors during this specific timeframe process

    try {
        // 1. Find unique relevant recipients
        const relevantRecipients = await MonitoredTransfer.distinct('recipientWallet', {
            monitorUntilTimestamp: { $gt: sinceTimestamp }
        });

        if (!relevantRecipients || relevantRecipients.length === 0) {
            console.log(`Common Token (${timeframeMinutes} min): No relevant recipients found.`);
            await CommonTokenActivity.deleteMany({ timeframeMinutes }); // Cleanup old data
            return;
        }
        console.log(`Common Token (${timeframeMinutes} min): Found ${relevantRecipients.length} unique recipients.`);

        // 2. Process recipients in batches
        const tokenTradersMap = new Map();
        let checkedRecipientCount = 0;

        for (let i = 0; i < relevantRecipients.length; i += RECIPIENT_BATCH_SIZE) {
            const batch = relevantRecipients.slice(i, i + RECIPIENT_BATCH_SIZE);
            const promises = batch.map(async (recipient) => {
                 try {
                    const recipientTxs = await getTransactionsForWallet(recipient, { limit: TX_FETCH_LIMIT_PER_RECIPIENT, sinceTimestamp: sinceTimestamp });
                    return { recipient, tradedMints: extractTradedMintsFromTransactions(recipientTxs, recipient) };
                 } catch (error) {
                     apiErrorCount++; console.error(`Err fetching tx for ${recipient}:`, error.message);
                     return { recipient, tradedMints: new Set(), error: true };
                 }
            });
            const results = await Promise.all(promises);
            checkedRecipientCount += results.length;
            results.forEach(r => { if (!r.error && r.tradedMints.size > 0) { r.tradedMints.forEach(m => { if (!tokenTradersMap.has(m)) tokenTradersMap.set(m, new Set()); tokenTradersMap.get(m).add(r.recipient); }); } });
        } // End batch loop

        // 3. Filter common tokens
        const commonTokens = Array.from(tokenTradersMap.entries())
            .filter(([_,traders]) => traders.size >= MIN_COMMON_TRADING_WALLETS)
            .map(([m, tS]) => ({ mintAddress: m, traders: Array.from(tS) }));
        console.log(`Common Token (${timeframeMinutes} min): Found ${commonTokens.length} common tokens.`);

        // 4. Fetch metadata
        let metadataMap = {}; const commonMints = commonTokens.map(t => t.mintAddress);
        if (commonMints.length > 0) { metadataMap = await fetchTokenMetadataBulk(commonMints); }

        // 5. Update DB
        if (commonTokens.length > 0) {
            const bulkOps = commonTokens.map(token => { const meta = metadataMap[token.mintAddress] || {}; return { updateOne: { filter: { mintAddress: token.mintAddress, timeframeMinutes: timeframeMinutes }, update: { $set: { name: meta.name || 'Unknown', symbol: meta.symbol || '?', tradingWalletsCount: token.traders.length, tradingWallets: token.traders, lastDetectionTimestamp: new Date() } }, upsert: true } }; });
            try { await CommonTokenActivity.bulkWrite(bulkOps, { ordered: false }); } catch (e) { console.error(`Common Token (${timeframeMinutes} min) DB BulkWrite Err:`, e); }
        }

        // 6. Cleanup stale entries
        await CommonTokenActivity.deleteMany({ timeframeMinutes: timeframeMinutes, mintAddress: { $nin: commonMints } });

    } catch(error) {
        // Catch errors specific to this timeframe's processing
        console.error(`Common Token (${timeframeMinutes} min): Error during processing:`, error);
        // Potentially increment a higher-level error counter if needed
    } finally {
        // Log completion for this specific timeframe
         console.log(`Common Token (${timeframeMinutes} min): Processing finished in ${(Date.now() - processStart)/1000}s. API Errors in timeframe: ${apiErrorCount}.`);
    }
} // End processCommonTokensForTimeframe

// Export only the function needed to start the job scheduler
module.exports = { startCommonTokenJob };
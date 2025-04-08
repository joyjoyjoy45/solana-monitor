const cron = require('node-cron');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const CommonTokenActivity = require('../models/CommonTokenActivity');
const { getTransactionsForWallet, fetchTokenMetadataBulk } = require('./solanaService');
const { getGlobalMonitoringStatus } = require('./monitorService');

const MIN_COMMON_TRADING_WALLETS = 2;
const TX_FETCH_LIMIT_PER_RECIPIENT = 100;
const RECIPIENT_BATCH_SIZE = 10;

const extractTradedMintsFromTransactions = (transactions, recipientAddress) => {
    const mints = new Set();
    if (!transactions) return mints;
    for (const tx of transactions) {
        if (tx.error || tx.meta?.err) continue;
        if (tx.tokenTransfers?.length > 0) {
            tx.tokenTransfers.forEach(tf => {
                if (tf.mint && (tf.fromUserAccount === recipientAddress || tf.toUserAccount === recipientAddress)) {
                     if (tf.mint.length > 30 && tf.mint !== 'So11111111111111111111111111111111111111112') { mints.add(tf.mint); } } }); } } return mints; };

const startCommonTokenJob = () => {
    cron.schedule('*/15 * * * *', async () => {
        if (!getGlobalMonitoringStatus()) return;
        console.log('Cron: Running Common Token Scan...');
        const startTime = Date.now();
        try { for (const timeframe of [60, 90, 120]) { await processCommonTokensForTimeframe(timeframe); } }
        catch (error) { console.error(`Cron (Common Tokens): Unhandled job error:`, error); }
        finally { console.log(`Cron: Common Token Scan finished in ${(Date.now() - startTime) / 1000}s.`); } }); };

async function processCommonTokensForTimeframe(timeframeMinutes) {
    const processStart = Date.now();
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const sinceTimestamp = nowTimestamp - (timeframeMinutes * 60);
    const relevantRecipients = await MonitoredTransfer.distinct('recipientWallet', { monitorUntilTimestamp: { $gt: sinceTimestamp } });
    if (!relevantRecipients || relevantRecipients.length === 0) { await CommonTokenActivity.deleteMany({ timeframeMinutes }); return; }
    const tokenTradersMap = new Map(); let checkedRecipientCount = 0; let apiErrorCount = 0;
    for (let i = 0; i < relevantRecipients.length; i += RECIPIENT_BATCH_SIZE) {
        const batch = relevantRecipients.slice(i, i + RECIPIENT_BATCH_SIZE);
        const promises = batch.map(async (recipient) => {
            try { const txs = await getTransactionsForWallet(recipient, { limit: TX_FETCH_LIMIT_PER_RECIPIENT, sinceTimestamp: sinceTimestamp });
                return { recipient, tradedMints: extractTradedMintsFromTransactions(txs, recipient) }; }
            catch (error) { apiErrorCount++; return { recipient, tradedMints: new Set(), error: true }; } });
        const results = await Promise.all(promises); checkedRecipientCount += results.length;
        results.forEach(r => { if (!r.error && r.tradedMints.size > 0) { r.tradedMints.forEach(m => { if (!tokenTradersMap.has(m)) tokenTradersMap.set(m, new Set()); tokenTradersMap.get(m).add(r.recipient); }); } }); }
    const commonTokens = Array.from(tokenTradersMap.entries()).filter(([_,traders]) => traders.size >= MIN_COMMON_TRADING_WALLETS).map(([m, tS]) => ({ mintAddress: m, traders: Array.from(tS) }));
    let metadataMap = {}; const commonMints = commonTokens.map(t => t.mintAddress); if (commonMints.length > 0) { metadataMap = await fetchTokenMetadataBulk(commonMints); }
    if (commonTokens.length > 0) {
        const bulkOps = commonTokens.map(token => { const meta = metadataMap[token.mintAddress] || {}; return { updateOne: { filter: { mintAddress: token.mintAddress, timeframeMinutes: timeframeMinutes }, update: { $set: { name: meta.name || 'Unknown', symbol: meta.symbol || '?', tradingWalletsCount: token.traders.length, tradingWallets: token.traders, lastDetectionTimestamp: new Date() } }, upsert: true } }; });
        try { await CommonTokenActivity.bulkWrite(bulkOps, { ordered: false }); } catch (e) { console.error(`CommonToken (${timeframeMinutes} min) DB BulkWrite Error:`, e); } }
    await CommonTokenActivity.deleteMany({ timeframeMinutes: timeframeMinutes, mintAddress: { $nin: commonMints } });
    console.log(`Common Token (${timeframeMinutes} min) Finished in ${(Date.now() - processStart)/1000}s. Found:${commonTokens.length}, API Errors:${apiErrorCount}`);
}

module.exports = { startCommonTokenJob };
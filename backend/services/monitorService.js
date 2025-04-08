const cron = require('node-cron');
const Wallet = require('../models/Wallet');
const Setting = require('../models/Setting');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const Notification = require('../models/Notification');
const { findOutgoingSolTransfers, checkTokenCreationByRecipient, fetchTokenMetadataBulk } = require('./solanaService');
const commonTokenService = require('./commonTokenService');

let monitoringWindowMinutes = 60;
let isGloballyEnabled = true;
const GLOBAL_MONITOR_KEY = 'global_monitoring_enabled';
const WINDOW_MINUTES_KEY = 'monitoring_window_minutes';

async function loadSettings() {
    try {
        const settings = await Setting.find({ key: { $in: [GLOBAL_MONITOR_KEY, WINDOW_MINUTES_KEY] } });
        const windowSetting = settings.find(s => s.key === WINDOW_MINUTES_KEY);
        const globalSwitch = settings.find(s => s.key === GLOBAL_MONITOR_KEY);
        if (windowSetting && [60, 90, 120].includes(parseInt(windowSetting.value, 10))) { monitoringWindowMinutes = parseInt(windowSetting.value, 10); }
        else { await Setting.updateOne({ key: WINDOW_MINUTES_KEY }, { $set: { value: 60 } }, { upsert: true }); monitoringWindowMinutes = 60; }
        if (globalSwitch) { isGloballyEnabled = Boolean(globalSwitch.value); }
        else { await Setting.updateOne({ key: GLOBAL_MONITOR_KEY }, { $set: { value: true } }, { upsert: true }); isGloballyEnabled = true; }
        console.log(`Monitoring Settings Loaded: Window=${monitoringWindowMinutes}min, Global=${isGloballyEnabled}`);
    } catch (error) { console.error("FATAL: Error loading settings from DB.", error); monitoringWindowMinutes = 60; isGloballyEnabled = true; }
}

async function setMonitoringWindow(minutes) {
    const validMinutes = parseInt(minutes, 10);
    if (![60, 90, 120].includes(validMinutes)) { return null; }
    try { await Setting.updateOne({ key: WINDOW_MINUTES_KEY }, { $set: { value: validMinutes } }, { upsert: true }); monitoringWindowMinutes = validMinutes; return monitoringWindowMinutes; }
    catch (error) { console.error("Error saving monitoring window:", error); return null; }
}

async function toggleGlobalMonitoring(enabled) {
    try { const boolValue = Boolean(enabled); await Setting.updateOne({ key: GLOBAL_MONITOR_KEY }, { $set: { value: boolValue } }, { upsert: true }); isGloballyEnabled = boolValue; return isGloballyEnabled; }
    catch (error) { console.error("Error saving global monitoring:", error); return null; }
}

function getMonitoringWindow() { return monitoringWindowMinutes; }
function getGlobalMonitoringStatus() { return isGloballyEnabled; }
async function getActiveMonitoringCount() {
    if (!isGloballyEnabled) return 0;
    try { return await MonitoredTransfer.countDocuments({ isActive: true }); }
    catch (error) { console.error("Error getting active monitor count:", error); return 0; }
}

const startTransferScanJob = () => {
  cron.schedule('*/3 * * * *', async () => {
    if (!isGloballyEnabled) return;
    console.log('Cron: Running Transfer Scan...');
    let addedCount = 0;
    try {
        const walletsToScan = await Wallet.find({ isMonitoring: true }).lean();
        const now = new Date();
        for (const wallet of walletsToScan) {
           try {
                const lookbackMinutes = 10;
                const safeLookbackTime = now.getTime() - lookbackMinutes * 60 * 1000;
                const lastScanMillis = wallet.lastScannedForTransfers instanceof Date ? wallet.lastScannedForTransfers.getTime() : safeLookbackTime;
                const sinceTimestamp = Math.floor(Math.max(lastScanMillis, safeLookbackTime) / 1000);
                const outgoingTransfers = await findOutgoingSolTransfers(wallet.address, sinceTimestamp);
                if (outgoingTransfers.length > 0) {
                    const currentWindow = getMonitoringWindow();
                    const ops = outgoingTransfers.map(transfer => ({
                        updateOne: { filter: { originatingTxSignature: transfer.signature }, update: { $setOnInsert: { sourceWallet: wallet.address, recipientWallet: transfer.recipient, transferTimestamp: transfer.timestamp, monitorUntilTimestamp: transfer.timestamp + (currentWindow * 60), originatingTxSignature: transfer.signature, monitoringWindowMinutes: currentWindow, isActive: true, createdAt: now, updatedAt: now } }, upsert: true } }));
                    if(ops.length > 0) { const res = await MonitoredTransfer.bulkWrite(ops, { ordered: false }); addedCount += res?.upsertedCount || 0; }
                }
                await Wallet.updateOne({ address: wallet.address }, { $set: { lastScannedForTransfers: now } });
            } catch (err) { console.error(`Cron (Transfer Scan): Error wallet ${wallet.address}:`, err.message); }
        }
        console.log(`Cron: Transfer scan finished. Added ${addedCount}.`);
    } catch (error) { console.error('Cron (Transfer Scan): Unhandled error:', error); }
  });
};

const startTokenCheckJob = () => {
    cron.schedule('*/1 * * * *', async () => {
        if (!isGloballyEnabled) return;
        console.log('Cron: Running Token Check...');
        const nowTimestamp = Math.floor(Date.now() / 1000);
        let checkedCount = 0, notificationCount = 0, errorCount = 0;
        try {
            await MonitoredTransfer.updateMany( { isActive: true, monitorUntilTimestamp: { $lt: nowTimestamp } }, { $set: { isActive: false, lastChecked: new Date() } });
            const checkCutoffTime = new Date(Date.now() - 55 * 1000);
            const transfersToCheck = await MonitoredTransfer.find({ isActive: true, $or: [ { lastChecked: { $exists: false } }, { lastChecked: { $lt: checkCutoffTime } } ] }).limit(100).lean();
            if (transfersToCheck.length === 0) return;
            checkedCount = transfersToCheck.length;
            const checkPromises = transfersToCheck.map(async (transfer) => {
                 try {
                     const result = await checkTokenCreationByRecipient(transfer.recipientWallet, transfer.transferTimestamp);
                     const updateFields = { $set: { lastChecked: new Date() } };
                     if (result.created) {
                         notificationCount++;
                         const metadata = await fetchTokenMetadataBulk([result.tokenMintAddress]);
                         const tokenInfo = metadata[result.tokenMintAddress];
                         await Notification.updateOne({ originatingTxSignature: transfer.originatingTxSignature, recipientWallet: transfer.recipientWallet, tokenMintAddress: result.tokenMintAddress }, { $setOnInsert: { sourceWallet: transfer.sourceWallet, recipientWallet: transfer.recipientWallet, transactionSignature: transfer.originatingTxSignature, tokenMintAddress: result.tokenMintAddress, tokenCreationSignature: result.transactionSignature, detectionTimestamp: new Date(result.timestamp * 1000), tokenDetails: tokenInfo ? { name: tokenInfo.name, symbol: tokenInfo.symbol } : undefined, createdAt: new Date() } }, { upsert: true });
                         updateFields.$set.isActive = false;
                     } else if (result.error) { errorCount++; }
                     await MonitoredTransfer.updateOne({ _id: transfer._id }, updateFields);
                 } catch (err) { errorCount++; console.error(`Cron (Token Check): Unhandled check error transfer ${transfer._id}:`, err); await MonitoredTransfer.updateOne({ _id: transfer._id }, { $set: { lastChecked: new Date() } }).catch(()=>{}); } });
             await Promise.all(checkPromises);
             console.log(`Cron: Token Check finished. Checked:${checkedCount}, Notifs:${notificationCount}, Errors:${errorCount}`);
         } catch (error) { console.error('Cron (Token Check): Unhandled job error:', error); } }); };

const initializeMonitoring = async () => {
     console.log("Initializing Monitoring Service...");
     try { await loadSettings(); if (isGloballyEnabled) { startTransferScanJob(); startTokenCheckJob(); commonTokenService.startCommonTokenJob(); } else { console.log("Global monitoring disabled. Jobs not started."); } console.log("Monitoring Service initialized."); }
     catch (error) { console.error("FATAL ERROR initializing monitoring:", error); process.exit(1); } };

module.exports = { initializeMonitoring, setMonitoringWindow, getMonitoringWindow, toggleGlobalMonitoring, getGlobalMonitoringStatus, getActiveMonitoringCount, };
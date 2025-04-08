// backend/services/monitorService.js
const cron = require('node-cron');
const Wallet = require('../models/Wallet');
const Setting = require('../models/Setting');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const Notification = require('../models/Notification');
const { findOutgoingSolTransfers, checkTokenCreationByRecipient, fetchTokenMetadataBulk } = require('./solanaService');
const commonTokenService = require('./commonTokenService'); // Import to START the job

let monitoringWindowMinutes = 60; // Default, loaded from DB
let isGloballyEnabled = true; // Default, loaded from DB

const GLOBAL_MONITOR_KEY = 'global_monitoring_enabled';
const WINDOW_MINUTES_KEY = 'monitoring_window_minutes';

// Load settings from DB on startup or provide defaults
async function loadSettings() {
    try {
        const settings = await Setting.find({ key: { $in: [GLOBAL_MONITOR_KEY, WINDOW_MINUTES_KEY] } });
        const windowSetting = settings.find(s => s.key === WINDOW_MINUTES_KEY);
        const globalSwitch = settings.find(s => s.key === GLOBAL_MONITOR_KEY);

        if (windowSetting && [60, 90, 120].includes(parseInt(windowSetting.value, 10))) {
            monitoringWindowMinutes = parseInt(windowSetting.value, 10);
        } else {
             console.log("Initializing monitoring window setting in DB to 60 minutes.");
            await Setting.updateOne({ key: WINDOW_MINUTES_KEY }, { $set: { value: 60 } }, { upsert: true });
             monitoringWindowMinutes = 60;
        }

        if (globalSwitch) {
             isGloballyEnabled = Boolean(globalSwitch.value);
        } else {
            console.log("Initializing global monitoring setting in DB to true.");
            await Setting.updateOne({ key: GLOBAL_MONITOR_KEY }, { $set: { value: true } }, { upsert: true });
            isGloballyEnabled = true;
        }
        console.log(`Monitoring Settings Loaded: Window=${monitoringWindowMinutes}min, Global=${isGloballyEnabled}`);

    } catch (error) {
        console.error("FATAL: Error loading settings from DB. Using defaults.", error);
        monitoringWindowMinutes = 60;
        isGloballyEnabled = true;
    }
}

async function setMonitoringWindow(minutes) {
    const validMinutes = parseInt(minutes, 10);
    if (![60, 90, 120].includes(validMinutes)) {
        console.warn(`Invalid monitoring window requested: ${minutes}. Not changed.`);
        return null;
    }
    try {
        await Setting.updateOne({ key: WINDOW_MINUTES_KEY }, { $set: { value: validMinutes } }, { upsert: true });
        monitoringWindowMinutes = validMinutes;
        console.log(`Monitoring window setting saved to ${monitoringWindowMinutes} minutes.`);
        return monitoringWindowMinutes;
    } catch (error) {
        console.error("Error saving monitoring window setting:", error);
        return null;
    }
}

async function toggleGlobalMonitoring(enabled) {
    try {
        const boolValue = Boolean(enabled);
        await Setting.updateOne({ key: GLOBAL_MONITOR_KEY }, { $set: { value: boolValue } }, { upsert: true });
        isGloballyEnabled = boolValue; // Update local state immediately
        console.log(`Global monitoring setting saved to: ${isGloballyEnabled}`);
        return isGloballyEnabled;
    } catch (error) {
        console.error("Error saving global monitoring setting:", error);
        return null;
    }
}

// Getters for current state (these read from local variables, updated by setters/loadSettings)
function getMonitoringWindow() { return monitoringWindowMinutes; }
function getGlobalMonitoringStatus() { return isGloballyEnabled; }
async function getActiveMonitoringCount() {
    if (!isGloballyEnabled) return 0;
    try {
        return await MonitoredTransfer.countDocuments({ isActive: true });
    } catch (error) {
        console.error("Error getting active monitor count from DB:", error);
        return 0;
    }
}

// --- Background Job 1: Scan Primary Wallets for New Outgoing Transfers ---
const startTransferScanJob = () => {
  cron.schedule('*/3 * * * *', async () => { // Run every 3 minutes
    if (!getGlobalMonitoringStatus()) return; // Check global status using the local variable getter
    console.log('Cron: Running Transfer Scan Job...');
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
                    const currentWindow = getMonitoringWindow(); // Get current window setting from local variable
                    const ops = outgoingTransfers.map(transfer => ({
                        updateOne: { filter: { originatingTxSignature: transfer.signature }, update: { $setOnInsert: { sourceWallet: wallet.address, recipientWallet: transfer.recipient, transferTimestamp: transfer.timestamp, monitorUntilTimestamp: transfer.timestamp + (currentWindow * 60), originatingTxSignature: transfer.signature, monitoringWindowMinutes: currentWindow, isActive: true, createdAt: now, updatedAt: now } }, upsert: true } }));
                    if(ops.length > 0) { const res = await MonitoredTransfer.bulkWrite(ops, { ordered: false }); addedCount += res?.upsertedCount || 0; }
                }
                await Wallet.updateOne({ address: wallet.address }, { $set: { lastScannedForTransfers: now } });
            } catch (err) { console.error(`Cron (Transfer Scan): Error processing wallet ${wallet.address}:`, err.message); }
        } // End wallet loop
        console.log(`Cron: Transfer scan finished. Added ${addedCount} new transfers to monitor queue.`);
    } catch (error) { console.error('Cron (Transfer Scan): Unhandled error during job execution:', error); }
  });
};

// --- Background Job 2: Check Active Monitored Transfers for Token Creation ---
 const startTokenCheckJob = () => {
    cron.schedule('*/1 * * * *', async () => { // Check every minute
        if (!getGlobalMonitoringStatus()) return; // Check global status using local getter
         console.log('Cron: Running Token Creation Check Job...');
        const nowTimestamp = Math.floor(Date.now() / 1000);
        let checkedCount = 0;
        let notificationCount = 0;
        let errorCount = 0;

        try {
             // 1. Mark Expired Monitors as Inactive
             await MonitoredTransfer.updateMany({ isActive: true, monitorUntilTimestamp: { $lt: nowTimestamp } }, { $set: { isActive: false, lastChecked: new Date() } });

             // 2. Find Active Monitors Still Within Window and not checked recently
            const checkCutoffTime = new Date(Date.now() - 55 * 1000);
            const transfersToCheck = await MonitoredTransfer.find({
                 isActive: true, // Only check active ones
                 // monitorUntilTimestamp check is implicitly done by not being cleaned up above
                 $or: [ { lastChecked: { $exists: false } }, { lastChecked: { $lt: checkCutoffTime } } ] // Check if never checked OR checked >55s ago
             }).limit(100).lean();

            if (transfersToCheck.length === 0) return; // Exit if nothing needs checking
            checkedCount = transfersToCheck.length;

             // 3. Process Checks Concurrently
            const checkPromises = transfersToCheck.map(async (transfer) => {
                 try {
                     const result = await checkTokenCreationByRecipient(transfer.recipientWallet, transfer.transferTimestamp);
                     const updateFields = { $set: { lastChecked: new Date() } };
                     if (result.created) {
                        notificationCount++;
                        const metadata = await fetchTokenMetadataBulk([result.tokenMintAddress]);
                        const tokenInfo = metadata[result.tokenMintAddress];
                        await Notification.updateOne({ originatingTxSignature: transfer.originatingTxSignature, recipientWallet: transfer.recipientWallet, tokenMintAddress: result.tokenMintAddress }, { $setOnInsert: { sourceWallet: transfer.sourceWallet, recipientWallet: transfer.recipientWallet, transactionSignature: transfer.originatingTxSignature, tokenMintAddress: result.tokenMintAddress, tokenCreationSignature: result.transactionSignature, detectionTimestamp: new Date(result.timestamp * 1000), tokenDetails: tokenInfo ? { name: tokenInfo.name, symbol: tokenInfo.symbol } : undefined, createdAt: new Date() } }, { upsert: true });
                        updateFields.$set.isActive = false; // Mark as inactive once notified
                     } else if (result.error) {
                        errorCount++; // Count API errors during check
                        console.warn(`Check Error for ${transfer.recipientWallet}, TxSig: ${transfer.originatingTxSignature.substring(0,10)}..`);
                    }
                     // Always update the transfer document (lastChecked, potentially isActive)
                    await MonitoredTransfer.updateOne({ _id: transfer._id }, updateFields);
                 } catch (err) {
                     errorCount++; console.error(`Cron (Token Check): Unhandled error checking transfer ${transfer._id}:`, err);
                     await MonitoredTransfer.updateOne({ _id: transfer._id }, { $set: { lastChecked: new Date() } }).catch(()=>{}); // Still try update lastChecked
                 }
             });
            await Promise.all(checkPromises);
            console.log(`Cron: Token Check finished. Checked: ${checkedCount}, Notifs: ${notificationCount}, Errors: ${errorCount}`);
        } catch (error) {
            console.error('Cron (Token Check): Unhandled error during job execution:', error);
        }
    });
 };


// Initializer: Loads settings then starts background jobs
const initializeMonitoring = async () => {
     console.log("Initializing Monitoring Service...");
     try {
         await loadSettings(); // Ensure settings are loaded before jobs start

         // Start background jobs - they check the global status internally now
        console.log("Starting background jobs (Transfer Scan, Token Check, Common Tokens)...");
         startTransferScanJob();
         startTokenCheckJob();
         commonTokenService.startCommonTokenJob(); // <-- Starts the cron scheduler in commonTokenService

         console.log("Monitoring Service initialization complete.");
     } catch (error) {
         console.error("FATAL ERROR during monitoring service initialization:", error);
         process.exit(1);
    }
};

module.exports = {
  initializeMonitoring,
  setMonitoringWindow,
  getMonitoringWindow, // Read local state
  toggleGlobalMonitoring, // Update local state + DB
  getGlobalMonitoringStatus, // Read local state
  getActiveMonitoringCount, // Query DB
};
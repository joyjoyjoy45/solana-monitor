 // backend/services/monitorService.js
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
const VALID_WINDOWS = [60, 90, 120, 360]; // Includes 360min option

async function loadSettings() { /* ... No changes needed from previous 360min version ... */ try{const s=await Setting.find({key:{$in:[GLOBAL_MONITOR_KEY,WINDOW_MINUTES_KEY]}});const wS=s.find(s=>s.key===WINDOW_MINUTES_KEY);const gS=s.find(s=>s.key===GLOBAL_MONITOR_KEY);if(wS&&VALID_WINDOWS.includes(parseInt(wS.value,10))){monitoringWindowMinutes=parseInt(wS.value,10);}else{await Setting.updateOne({key:WINDOW_MINUTES_KEY},{$set:{value:60}},{upsert:true});monitoringWindowMinutes=60;} if(gS){isGloballyEnabled=Boolean(gS.value);}else{await Setting.updateOne({key:GLOBAL_MONITOR_KEY},{$set:{value:true}},{upsert:true});isGloballyEnabled=true;} console.log(`Settings Loaded: Win=${monitoringWindowMinutes}m, Global=${isGloballyEnabled}`);}catch(e){console.error("FATAL: Err load settings:",e);monitoringWindowMinutes=60;isGloballyEnabled=true;}}
async function setMonitoringWindow(minutes) { /* ... No changes needed from previous 360min version ... */ const vM=parseInt(minutes,10);if(!VALID_WINDOWS.includes(vM)){console.warn(`Invalid window: ${minutes}. Valid:${VALID_WINDOWS.join(',')}.`);return null;}try{await Setting.updateOne({key:WINDOW_MINUTES_KEY},{$set:{value:vM}},{upsert:true});monitoringWindowMinutes=vM;console.log(`Win saved: ${monitoringWindowMinutes}m.`);return monitoringWindowMinutes;}catch(e){console.error("Err save win:",e);return null;}}
async function toggleGlobalMonitoring(enabled) { /* ... No changes needed from previous 360min version ... */ try{const bV=Boolean(enabled);await Setting.updateOne({key:GLOBAL_MONITOR_KEY},{$set:{value:bV}},{upsert:true});isGloballyEnabled=bV;console.log(`Global monitor set: ${isGloballyEnabled}`);return isGloballyEnabled;}catch(e){console.error("Err save global:",e);return null;}}
function getMonitoringWindow() { return monitoringWindowMinutes; }
function getGlobalMonitoringStatus() { return isGloballyEnabled; }
async function getActiveMonitoringCount() { /* ... No changes needed ... */ if(!isGloballyEnabled)return 0;try{return await MonitoredTransfer.countDocuments({isActive:true});}catch(e){console.error("Err get active count:",e);return 0;}}

// --- Background Job 1: Scan Primary Wallets for New Outgoing Transfers ---
const startTransferScanJob = () => {
  // **** CHANGE CRON TIME ****
  // From '*/3 * * * *' (every 3 mins) to '* * * * *' (every minute)
  cron.schedule('* * * * *', async () => {
  // *************************
    if (!getGlobalMonitoringStatus()) return;
    console.log('Cron: Running Transfer Scan...'); // More frequent log
    let addedCount = 0;
    try {
        const walletsToScan = await Wallet.find({ isMonitoring: true }).lean();
        const now = new Date();
        for (const wallet of walletsToScan) {
           try {
                // Keep lookback relatively short to ensure overlap between minute-runs
                const lookbackMinutes = 3; // Look back 3 minutes just in case a run is skipped/delayed
                const safeLookbackTime = now.getTime() - lookbackMinutes * 60 * 1000;
                const lastScanMillis = wallet.lastScannedForTransfers instanceof Date ? wallet.lastScannedForTransfers.getTime() : safeLookbackTime;
                const sinceTimestamp = Math.floor(Math.max(lastScanMillis, safeLookbackTime) / 1000); // Use the latest of lastScan or safeLookback

                 const outgoingTransfers = await findOutgoingSolTransfers(wallet.address, sinceTimestamp);
                if (outgoingTransfers.length > 0) {
                    const currentWindow = getMonitoringWindow();
                    const ops = outgoingTransfers.map(transfer => ({ updateOne:{filter:{originatingTxSignature:transfer.signature},update:{$setOnInsert:{sourceWallet:wallet.address,recipientWallet:transfer.recipient,transferTimestamp:transfer.timestamp,monitorUntilTimestamp:transfer.timestamp+(currentWindow*60),originatingTxSignature:transfer.signature,monitoringWindowMinutes:currentWindow,isActive:true,createdAt:now,updatedAt:now}},upsert:true} }));
                    if(ops.length > 0) { const res = await MonitoredTransfer.bulkWrite(ops, { ordered: false }); addedCount += res?.upsertedCount || 0; }
                }
                await Wallet.updateOne({ address: wallet.address }, { $set: { lastScannedForTransfers: now } });
            } catch (err) { console.error(`Cron (TS): Err wallet ${wallet.address}:`, err.message); }
        } // End wallet loop
        // Don't log finish message every minute unless new ones found, becomes noisy
        if (addedCount > 0) { console.log(`Cron: Transfer scan added ${addedCount}.`); }
    } catch (error) { console.error('Cron (TS): Unhandled error:', error); }
  });
};


// --- Background Job 2: Check Active Monitored Transfers for Token Creation ---
 const startTokenCheckJob = () => {
    // **** CRON TIME IS ALREADY '* * * * *' (every minute), keep as is ****
    cron.schedule('* * * * *', async () => {
    // ******************************************************************
        if (!getGlobalMonitoringStatus()) return;
        // Reduce logging frequency slightly unless activity detected? Or keep it every minute? Let's keep it for now.
        console.log('Cron: Running Token Check...');
        const nowTimestamp = Math.floor(Date.now() / 1000);
        let checkedCount = 0, notificationCount = 0, errorCount = 0;
        try {
            // 1. Cleanup expired
            await MonitoredTransfer.updateMany({ isActive:true, monitorUntilTimestamp:{$lt:nowTimestamp}},{$set:{isActive:false,lastChecked:new Date()}});
            // 2. Find active & needing check
            const checkCutoffTime = new Date(Date.now() - 55 * 1000); // Check if older than ~1 min
            const transfersToCheck = await MonitoredTransfer.find({ isActive:true, $or:[{lastChecked:{$exists:false}},{lastChecked:{$lt:checkCutoffTime}}] }).limit(100).lean();
            if (transfersToCheck.length === 0) { /* console.log('Cron (TC): Nothing to check.'); */ return; } // Quiet if nothing to do
            checkedCount = transfersToCheck.length;
            // 3. Process Checks
            const checkPromises = transfersToCheck.map(async(transfer)=>{ try { const result=await checkTokenCreationByRecipient(transfer.recipientWallet,transfer.transferTimestamp);const updateFields={$set:{lastChecked:new Date()}}; if(result.created){ notificationCount++; const meta=await fetchTokenMetadataBulk([result.tokenMintAddress]);const tokenInfo=meta[result.tokenMintAddress]; await Notification.updateOne({originatingTxSignature:transfer.originatingTxSignature,recipientWallet:transfer.recipientWallet,tokenMintAddress:result.tokenMintAddress},{$setOnInsert:{sourceWallet:transfer.sourceWallet,recipientWallet:transfer.recipientWallet,transactionSignature:transfer.originatingTxSignature,tokenMintAddress:result.tokenMintAddress,tokenCreationSignature:result.transactionSignature,detectionTimestamp:new Date(result.timestamp*1000),tokenDetails:tokenInfo?{name:tokenInfo.name,symbol:tokenInfo.symbol}:undefined,createdAt:new Date()}},{upsert:true}); updateFields.$set.isActive=false; } else if (result.error){ errorCount++; } await MonitoredTransfer.updateOne({_id:transfer._id},updateFields); } catch (err) { errorCount++; console.error(`Cron (TC): Unhandled check err ${transfer._id}:`,err); await MonitoredTransfer.updateOne({_id:transfer._id},{$set:{lastChecked:new Date()}}).catch(()=>{}); } });
            await Promise.all(checkPromises);
            // Log only if activity occurred
            if (notificationCount > 0 || errorCount > 0) { console.log(`Cron: TC finished. Checked:${checkedCount}, Notifs:${notificationCount}, Err:${errorCount}`); }
        } catch (error) { console.error('Cron (TC): Unhandled job err:', error); }
    });
 };

// --- Initializer remains the same ---
const initializeMonitoring = async () => { console.log("Init Monitor Service..."); try { await loadSettings(); if(isGloballyEnabled){ console.log("Starting background jobs..."); startTransferScanJob(); startTokenCheckJob(); commonTokenService.startCommonTokenJob(); }else{ console.log("Global monitor disabled.");} console.log("Monitor Service init complete.");} catch(err){ console.error("FATAL Init Monitor Err:",err);process.exit(1);} };

module.exports = { initializeMonitoring, setMonitoringWindow, getMonitoringWindow, toggleGlobalMonitoring, getGlobalMonitoringStatus, getActiveMonitoringCount };
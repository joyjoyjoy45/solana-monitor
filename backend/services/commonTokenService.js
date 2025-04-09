// backend/services/commonTokenService.js
const cron = require('node-cron');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const CommonTokenActivity = require('../models/CommonTokenActivity');
const { getTransactionsForWallet, fetchTokenMetadataBulk } = require('./solanaService');

// Constants remain the same
const MIN_COMMON_TRADING_WALLETS = 2;
const TX_FETCH_LIMIT_PER_RECIPIENT = 100;
const RECIPIENT_BATCH_SIZE = 10;

// Helper remains the same
const extractTradedMintsFromTransactions = (transactions, recipientAddress) => { /* ... no changes needed ... */ const m=new Set();if(!transactions)return m;for(const tx of transactions){if(tx.error||tx.meta?.err)continue;if(tx.tokenTransfers?.length>0){tx.tokenTransfers.forEach(tf=>{if(tf.mint&&(tf.fromUserAccount===recipientAddress||tf.toUserAccount===recipientAddress)){if(tf.mint.length>30&&tf.mint!=='So11111111111111111111111111111111111111112'){m.add(tf.mint);}}});}}return m; };

// --- Background Job 3: Find Common Traded Tokens by Recipients ---
const startCommonTokenJob = () => {
    // **** CHANGE CRON TIME ****
    // From '*/15 * * * *' (every 15 mins) to '*/5 * * * *' (every 5 minutes)
    cron.schedule('*/5 * * * *', async () => {
    // *************************

        let isEnabled = false;
        try { isEnabled = require('./monitorService').getGlobalMonitoringStatus(); } // Dynamic check
        catch (err) { console.error("Err getting status in commonTokenJob:", err); return; }
        if (!isEnabled) return;

        console.log('Cron: Running Common Token Scan Job...'); // Runs every 5 mins
        const startTime = Date.now();
        // Include 360 min timeframe
        const timeframes = [60, 90, 120, 360];

        try {
            for (const timeframeMinutes of timeframes) {
                await processCommonTokensForTimeframe(timeframeMinutes);
            }
        } catch (error) { console.error(`Cron (Common Tokens): Unhandled job error:`, error); }
        finally { console.log(`Cron: Common Token Scan Job finished in ${(Date.now() - startTime) / 1000}s.`); }
    }); // End cron.schedule callback
}; // End startCommonTokenJob


// processCommonTokensForTimeframe remains the same internally
async function processCommonTokensForTimeframe(timeframeMinutes) { /* ... No changes needed ... */ console.log(`CT (${timeframeMinutes}m): Starting.`); const pS=Date.now(); const nowTs=Math.floor(Date.now()/1000); const tfS=timeframeMinutes*60; const sinceTs=nowTs-tfS; let apiEC=0; try{const relRecs=await MonitoredTransfer.distinct('recipientWallet',{monitorUntilTimestamp:{$gt:sinceTs}}); if(!relRecs||relRecs.length===0){console.log(`CT (${timeframeMinutes}m): No relevant recipients.`);await CommonTokenActivity.deleteMany({timeframeMinutes});return;} console.log(`CT (${timeframeMinutes}m): Found ${relRecs.length} recipients.`); const tkTrMap=new Map(); let ckRecC=0; for(let i=0;i<relRecs.length;i+=RECIPIENT_BATCH_SIZE){const b=relRecs.slice(i,i+RECIPIENT_BATCH_SIZE); const p=b.map(async(r)=>{try{const txs=await getTransactionsForWallet(r,{limit:TX_FETCH_LIMIT_PER_RECIPIENT,sinceTimestamp:sinceTs});return{r,tM:extractTradedMintsFromTransactions(txs,r)};}catch(e){apiEC++;console.error(`Err fetch tx ${r}:`,e.message);return{r,tM:new Set(),e:true};}}); const res=await Promise.all(p); ckRecC+=res.length; res.forEach(r=>{if(!r.error&&r.tM.size>0){r.tM.forEach(m=>{if(!tkTrMap.has(m))tkTrMap.set(m,new Set());tkTrMap.get(m).add(r.r);});}}); } const comTkns=Array.from(tkTrMap.entries()).filter(([_,t])=>t.size>=MIN_COMMON_TRADING_WALLETS).map(([m,tS])=>({mA:m,tr:Array.from(tS)})); console.log(`CT (${timeframeMinutes}m): Found ${comTkns.length} common tokens.`); let mdMap={};const cMints=comTkns.map(t=>t.mA); if(cMints.length>0){mdMap=await fetchTokenMetadataBulk(cMints);} if(comTkns.length>0){const ops=comTkns.map(tk=>{const meta=mdMap[tk.mA]||{};return{updateOne:{filter:{mintAddress:tk.mA,timeframeMinutes:timeframeMinutes},update:{$set:{name:meta.name||'?',symbol:meta.symbol||'?',tradingWalletsCount:tk.tr.length,tradingWallets:tk.tr,lastDetectionTimestamp:new Date()}},upsert:true}}}); try{await CommonTokenActivity.bulkWrite(ops,{ordered:false});}catch(e){console.error(`CT (${timeframeMinutes}m) DB Err:`, e);}} await CommonTokenActivity.deleteMany({timeframeMinutes:timeframeMinutes,mintAddress:{$nin:cMints}}); }catch(err){console.error(`CT (${timeframeMinutes}m) Processing Error:`, err);} finally {console.log(`CT (${timeframeMinutes}m) Finished in ${(Date.now()-pS)/1000}s. API Errors:${apiEC}.`);} }


module.exports = { startCommonTokenJob };
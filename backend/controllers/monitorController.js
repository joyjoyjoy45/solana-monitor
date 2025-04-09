 // backend/controllers/monitorController.js
const monitorService = require('../services/monitorService');
const CommonTokenActivity = require('../models/CommonTokenActivity');
// **** ADD 360 TO VALID WINDOWS ****
const VALID_WINDOWS = [60, 90, 120, 360];
// **********************************

exports.setMonitorWindow = async (req, res) => {
  const { minutes } = req.body;
  try {
    const newWindow = await monitorService.setMonitoringWindow(minutes);
    if (newWindow !== null) {
      res.json({ msg: `Monitoring window updated to ${newWindow} minutes.`, monitoringWindowMinutes: newWindow });
    } else {
        // **** UPDATE ERROR MESSAGE ****
        res.status(400).json({ msg: `Invalid monitoring window value. Must be one of: ${VALID_WINDOWS.join(', ')}.` });
        // ****************************
    }
  } catch (error) { console.error("API Error setMonitorWindow:", error); res.status(500).json({ msg: 'Server error.' }); }
};

// getMonitorStatus remains the same
exports.getMonitorStatus = async (req, res) => { /* ... no changes needed ... */ try {const [w,en,c]=await Promise.all([monitorService.getMonitoringWindow(),monitorService.getGlobalMonitoringStatus(),monitorService.getActiveMonitoringCount()]); res.json({monitoringWindowMinutes:w,isGloballyEnabled:en,activeMonitorsCount:c});}catch(e){console.error("Err getStatus:",e);res.status(500).json({msg:"Server error."});}};

// toggleGlobalMonitor remains the same
exports.toggleGlobalMonitor = async (req, res) => { /* ... no changes needed ... */ const {enabled}=req.body;if(typeof enabled!=='boolean')return res.status(400).json({msg:'Invalid enabled value.'});try{const s=await monitorService.toggleGlobalMonitoring(enabled); if(s!==null)res.json({msg:`Global monitor set ${s}.`, isGloballyEnabled: s});else res.status(500).json({msg:'Fail update status.'});}catch(e){console.error("Err toggleGlobal:",e);res.status(500).json({msg:'Server error.'});}};

// getCommonTokens remains the same (validation uses VALID_WINDOWS array)
exports.getCommonTokens = async (req, res) => {
    const defaultWindow = monitorService.getMonitoringWindow();
    const timeframeQuery = req.query.timeframe;
    let timeframe;
    // **** USE VALID_WINDOWS FOR CHECK ****
    if (timeframeQuery && VALID_WINDOWS.includes(parseInt(timeframeQuery, 10))) {
    // ***********************************
        timeframe = parseInt(timeframeQuery, 10);
    } else { timeframe = defaultWindow; }

    const limitQuery = req.query.limit; const limit = (limitQuery && +limitQuery > 0 && +limitQuery <= 100) ? +limitQuery : 30;
    try { const tokens = await CommonTokenActivity.find({ timeframeMinutes: timeframe }).sort({ tradingWalletsCount: -1, lastDetectionTimestamp: -1 }).limit(limit).lean(); res.json(tokens); }
    catch (error) { console.error(`Err getCommonTokens (tf ${timeframe}):`, error); res.status(500).json({ msg: 'Server error.' }); }
};
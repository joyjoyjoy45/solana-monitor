const monitorService = require('../services/monitorService');
const CommonTokenActivity = require('../models/CommonTokenActivity');

exports.setMonitorWindow = async (req, res) => {
  const { minutes } = req.body;
  try { const win = await monitorService.setMonitoringWindow(minutes);
    if (win !== null) res.json({ msg: `Window set to ${win} mins.`, monitoringWindowMinutes: win });
    else res.status(400).json({ msg: 'Invalid window value (60, 90, 120).' });
  } catch (error) { console.error("Error setMonitorWindow:", error); res.status(500).json({ msg: 'Server error.' }); }
};

exports.getMonitorStatus = async (req, res) => {
  try { const [win, enabled, count] = await Promise.all([ monitorService.getMonitoringWindow(), monitorService.getGlobalMonitoringStatus(), monitorService.getActiveMonitoringCount() ]);
    res.json({ monitoringWindowMinutes: win, isGloballyEnabled: enabled, activeMonitorsCount: count });
  } catch (error) { console.error("Error getMonitorStatus:", error); res.status(500).json({ msg: "Server error." }); }
};

exports.toggleGlobalMonitor = async (req, res) => {
    const { enabled } = req.body; if (typeof enabled !== 'boolean') return res.status(400).json({ msg: 'Invalid enabled value.' });
    try { const status = await monitorService.toggleGlobalMonitoring(enabled);
        if (status !== null) res.json({ msg: `Global monitoring set to ${status}.`, isGloballyEnabled: status });
        else res.status(500).json({ msg: 'Failed to update status.'});
     } catch (error) { console.error("Error toggleGlobalMonitor:", error); res.status(500).json({ msg: 'Server error.' }); }
};

exports.getCommonTokens = async (req, res) => {
    const defaultWin = monitorService.getMonitoringWindow(); const tfQuery = req.query.timeframe;
    let timeframe = defaultWin; if (tfQuery && [60, 90, 120].includes(+tfQuery)) timeframe = +tfQuery;
    const limitQuery = req.query.limit; const limit = (limitQuery && +limitQuery > 0 && +limitQuery <= 100) ? +limitQuery : 30;
    try { const tokens = await CommonTokenActivity.find({ timeframeMinutes: timeframe }).sort({ tradingWalletsCount: -1, lastDetectionTimestamp: -1 }).limit(limit).lean();
         res.json(tokens);
     } catch (error) { console.error(`Error getCommonTokens (tf ${timeframe}):`, error); res.status(500).json({ msg: 'Server error.' }); }
};
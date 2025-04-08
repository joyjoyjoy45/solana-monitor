const mongoose = require('mongoose');

const CommonTokenActivitySchema = new mongoose.Schema({
    mintAddress: { type: String, required: true, index: true },
    timeframeMinutes: { type: Number, required: true, index: true },
    name: { type: String },
    symbol: { type: String },
    tradingWalletsCount: { type: Number, required: true, index: true },
    tradingWallets: [{ type: String }],
    lastDetectionTimestamp: { type: Date, default: Date.now, index: true },
});

CommonTokenActivitySchema.index({ mintAddress: 1, timeframeMinutes: 1 }, { unique: true });
CommonTokenActivitySchema.index({ timeframeMinutes: 1, tradingWalletsCount: -1, lastDetectionTimestamp: -1 });

module.exports = mongoose.model('CommonTokenActivity', CommonTokenActivitySchema);
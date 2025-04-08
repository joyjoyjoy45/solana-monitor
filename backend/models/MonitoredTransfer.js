const mongoose = require('mongoose');

const MonitoredTransferSchema = new mongoose.Schema({
    sourceWallet: { type: String, required: true, index: true },
    recipientWallet: { type: String, required: true, index: true },
    transferTimestamp: { type: Number, required: true, index: true },
    monitorUntilTimestamp: { type: Number, required: true, index: true },
    originatingTxSignature: { type: String, required: true, unique: true, index: true },
    monitoringWindowMinutes: { type: Number, required: true },
    isActive: { type: Boolean, default: true, index: true },
    lastChecked: { type: Date },
}, { timestamps: true });

MonitoredTransferSchema.index({ isActive: 1, monitorUntilTimestamp: 1 });
MonitoredTransferSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('MonitoredTransfer', MonitoredTransferSchema);
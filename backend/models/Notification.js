const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  sourceWallet: { type: String, required: true, index: true },
  recipientWallet: { type: String, required: true, index: true },
  transactionSignature: { type: String, required: true },
  tokenMintAddress: { type: String, required: true, index: true },
  tokenCreationSignature: { type: String, index: true },
  tokenDetails: {
      name: String,
      symbol: String,
  },
  detectionTimestamp: { type: Date, default: Date.now, index: true },
  isRead: { type: Boolean, default: false, index: true },
});

module.exports = mongoose.model('Notification', NotificationSchema);
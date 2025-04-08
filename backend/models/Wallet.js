const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  isMonitoring: {
    type: Boolean,
    default: true,
  },
  lastScannedForTransfers: {
    type: Date,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
});

WalletSchema.path('address').validate(function(value) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}, 'Invalid Solana address format');

module.exports = mongoose.model('Wallet', WalletSchema);
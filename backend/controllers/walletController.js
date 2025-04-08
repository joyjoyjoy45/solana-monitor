const Wallet = require('../models/Wallet');
const Notification = require('../models/Notification');
const MonitoredTransfer = require('../models/MonitoredTransfer');
const { getRecentTransactions, isValidSolanaAddress } = require('../services/solanaService');

exports.addWallet = async (req, res) => {
  const { address } = req.body;
  if (!isValidSolanaAddress(address)) return res.status(400).json({ msg: 'Invalid address format.' });
  try {
    const result = await Wallet.findOneAndUpdate({ address }, { $setOnInsert: { address, isMonitoring: true, addedAt: new Date() } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    if (result && !result.isNew) return res.status(400).json({ msg: 'Wallet already added.' }); // Check if it existed
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ msg: 'Wallet already exists (concurrent request).' });
    if (err.name === 'ValidationError') return res.status(400).json({ msg: err.message });
    console.error("Error addWallet:", err); res.status(500).json({ msg: 'Server error adding wallet.' });
  }
};

exports.getWallets = async (req, res) => {
  try { const wallets = await Wallet.find().sort({ addedAt: -1 }).lean(); res.json(wallets); }
  catch (err) { console.error("Error getWallets:", err); res.status(500).json({ msg: 'Server error.' }); }
};

exports.toggleMonitoring = async (req, res) => {
  const { address } = req.params; if (!isValidSolanaAddress(address)) return res.status(400).json({ msg: 'Invalid address.' });
  try {
    const wallet = await Wallet.findOne({ address }); if (!wallet) return res.status(404).json({ msg: 'Wallet not found.' });
    wallet.isMonitoring = !wallet.isMonitoring; await wallet.save(); res.json(wallet);
  } catch (err) { console.error("Error toggleMonitoring:", err); res.status(500).json({ msg: 'Server error.' }); }
};

exports.deleteWallet = async (req, res) => {
  const { address } = req.params; if (!isValidSolanaAddress(address)) return res.status(400).json({ msg: 'Invalid address.' });
  try {
    const deleted = await Wallet.findOneAndDelete({ address }); if (!deleted) return res.status(404).json({ msg: 'Wallet not found.' });
    MonitoredTransfer.deleteMany({ sourceWallet: address }).catch(e => console.error(`Error cleanup monitors for ${address}:`, e)); // Fire and forget cleanup
    res.status(200).json({ msg: 'Wallet removed.' });
  } catch (err) { console.error("Error deleteWallet:", err); res.status(500).json({ msg: 'Server error.' }); }
};

exports.getWalletTransactions = async (req, res) => {
    const { address } = req.params;
    const limitQuery = req.query.limit; const limit = (limitQuery && +limitQuery > 0 && +limitQuery <= 100) ? +limitQuery : 25;
    if (!isValidSolanaAddress(address)) return res.status(400).json({ msg: 'Invalid address.' });
    try { const txs = await getRecentTransactions(address, limit); res.json(txs); }
    catch (err) { console.error(`Error getWalletTransactions for ${address}:`, err); res.status(500).json({ msg: 'Server error fetching tx.' }); }
};

exports.getNotifications = async (req, res) => {
    const limitQuery = req.query.limit; const limit = (limitQuery && +limitQuery > 0 && +limitQuery <= 200) ? +limitQuery : 50;
    try { const notifs = await Notification.find().sort({ detectionTimestamp: -1 }).limit(limit).lean(); res.json(notifs); }
    catch (err) { console.error("Error getNotifications:", err); res.status(500).json({ msg: 'Server error fetching notifications.' }); }
};
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const monitorController = require('../controllers/monitorController');

// Health Check
router.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Wallet Routes
router.post('/wallets', walletController.addWallet);
router.get('/wallets', walletController.getWallets);
router.put('/wallets/:address/toggle', walletController.toggleMonitoring);
router.delete('/wallets/:address', walletController.deleteWallet);
router.get('/wallets/:address/transactions', walletController.getWalletTransactions);

// Notification Routes
router.get('/notifications', walletController.getNotifications);

// Monitor Routes
router.get('/monitor/status', monitorController.getMonitorStatus);
router.put('/monitor/settings/window', monitorController.setMonitorWindow);
router.put('/monitor/settings/global', monitorController.toggleGlobalMonitor);
router.get('/monitor/common-tokens', monitorController.getCommonTokens);

// Catch-all 404 for API routes
router.use((req, res) => res.status(404).json({ msg: 'API endpoint not found.' }));

module.exports = router;
// frontend/script.js (with added debugging)
document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // !!! IMPORTANT: Replace placeholder with YOUR Render Backend URL !!!
    const API_BASE_URL = 'https://solana-monitor.onrender.com/api'; // <<<<<<<<< CHANGE THIS IF YOU HAVENT
    // Example: const API_BASE_URL = 'https://solana-monitor-backend-xyz.onrender.com/api';

    // Constants
    const SOLSCAN_BASE = "https://solscan.io";
    const REFRESH_INTERVAL_NOTIFICATIONS = 90 * 1000;
    const REFRESH_INTERVAL_COMMON_TOKENS = 5 * 60 * 1000;
    const REFRESH_INTERVAL_STATUS = 60 * 1000;
    const TEMP_MESSAGE_DURATION = 4000;

    // --- DOM Elements Cache ---
    const elements = { /* Cache DOM elements as defined previously */
        globalMonitorSwitch: document.getElementById('global-monitor-switch'),
        globalMonitorStatusText: document.getElementById('global-monitor-status-text'),
        monitorStatusInfo: document.getElementById('monitor-status-info'),
        monitorWindowSelect: document.getElementById('monitor-window'),
        updateSettingsBtn: document.getElementById('update-settings-btn'),
        settingsMessage: document.getElementById('settings-message'),
        addWalletForm: document.getElementById('add-wallet-form'),
        walletAddressInput: document.getElementById('wallet-address-input'),
        addWalletBtn: document.querySelector('#add-wallet-form button[type="submit"]'),
        addErrorMessage: document.getElementById('add-error-message'),
        walletsList: document.getElementById('wallets-list'),
        walletDetailsSection: document.getElementById('wallet-details'),
        detailsWalletAddressSpan: document.getElementById('details-wallet-address'),
        closeDetailsBtn: document.getElementById('close-details-btn'),
        transactionsList: document.getElementById('transactions-list'),
        transactionsLoading: document.getElementById('transactions-loading'),
        transactionsError: document.getElementById('transactions-error'),
        notificationsList: document.getElementById('notifications-list'),
        notificationsLoading: document.getElementById('notifications-loading'),
        notificationsError: document.getElementById('notifications-error'),
        refreshNotificationsBtn: document.getElementById('refresh-notifications-btn'),
        commonTokensList: document.getElementById('common-tokens-list'),
        commonTokensLoading: document.getElementById('common-tokens-loading'),
        commonTokensError: document.getElementById('common-tokens-error'),
        refreshCommonTokensBtn: document.getElementById('refresh-common-tokens-btn'),
        commonTokenTimeframeSpan: document.getElementById('common-token-timeframe'),
    };

    // --- Application State ---
    let currentWallets = [];
    let currentMonitorStatus = { monitoringWindowMinutes: 60, isGloballyEnabled: true, activeMonitorsCount: 0 };
    let intervals = {};

    // --- Utility Functions --- (shortenAddress, setLoadingState, showTemporaryMessage remain the same)
    const shortenAddress = (address, chars = 6) => (!address || typeof address !== 'string') ? 'N/A' : address.length > chars * 2 + 3 ? `${address.substring(0, chars)}...${address.substring(address.length - chars)}` : address;
    const setLoadingState = (loading, errorEl, isLoading, msg = '') => { if (!loading || !errorEl) return; loading.style.display = isLoading ? 'block' : 'none'; errorEl.textContent = isLoading ? '' : msg; errorEl.style.display = msg ? 'block' : 'none'; };
    const showTemporaryMessage = (el, msg, isErr = false, duration = TEMP_MESSAGE_DURATION) => { if (!el) return; el.textContent = msg; el.className = isErr ? 'error-message' : 'status-message'; el.style.display = 'block'; el.style.opacity = '1'; if (el.timeoutId) clearTimeout(el.timeoutId); el.timeoutId = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => { el.textContent = ''; el.style.display = 'none'; el.className = ''; }, 300); }, duration); };

    // --- API Request Function --- (remains the same)
    const apiRequest = async (endpoint, method = 'GET', body = null) => {
        const url = `${API_BASE_URL}${endpoint}`; const options = { method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }; if (body) options.body = JSON.stringify(body);
        try { /* console.log(`API Request: ${method} ${url}`, body || ''); */ const resp = await fetch(url, options); let data = null; const type = resp.headers.get("content-type");
            if (resp.ok) { if (resp.status !== 204 && type?.includes("json")) { data = await resp.json(); } else { data = null; } }
            else { let eMsg = `Error ${resp.status}: ${resp.statusText}`; try { const eData = await resp.json(); eMsg = eData.msg || eData.message || JSON.stringify(eData); } catch (e) {} console.error(`API Error Resp (${method} ${url}): ${eMsg}`); throw new Error(eMsg); }
            /* console.log(`API Response: ${method} ${url} -> Status ${resp.status}`); */ return data;
        } catch (err) { console.error(`API Request Failed: ${method} ${url}`, err); throw err; }
    };

    // --- Rendering Functions ---
     const renderWallets = () => {
         elements.walletsList.innerHTML = ''; // Clear list first
         // **** DEBUGGING LINE ****
         console.log("[DEBUG] renderWallets called. Data received:", JSON.stringify(currentWallets));
         // ***********************

         if (!currentWallets || currentWallets.length === 0) {
             elements.walletsList.innerHTML = '<li class="info-text">No wallets being monitored yet.</li>'; // Updated empty message
             console.log("[DEBUG] Rendering empty wallet list."); // **** DEBUGGING LINE ****
             return;
         }

        // Sort, create fragment, append (same logic as before)
        currentWallets.sort((a, b) => (b.isMonitoring - a.isMonitoring) || (new Date(b.addedAt) - new Date(a.addedAt)));
         const fragment = document.createDocumentFragment();
         currentWallets.forEach(wallet => {
             const li = document.createElement('li'); li.dataset.address = wallet.address; const { isMonitoring: m, address: ad, addedAt: addT } = wallet; const btnCls = m ? 'danger' : 'success'; const btnTxt = m ? 'Stop' : 'Start'; const statTxt = m ? 'Tracking ON' : 'Tracking OFF'; const indCls = m ? 'on' : 'off'; const addD = addT ? `Added: ${new Date(addT).toLocaleDateString()}` : '';
             li.innerHTML = `<div class="wallet-info"><span class="address" title="${ad}">${shortenAddress(ad)}</span><span class="wallet-added-date" title="${addD}">${addD ? `(${addD})`: ''}</span></div><div class="wallet-status"><span class="status-indicator ${indCls}" title="${statTxt}"></span><span>${statTxt}</span></div><div class="wallet-actions"><button class="toggle-btn small-btn ${btnCls}" data-address="${ad}" title="${m ? 'Stop' : 'Start'} monitoring">${btnTxt}</button><button class="details-btn small-btn warning" data-address="${ad}" title="View tx">Details</button><button class="delete-btn small-btn danger" data-address="${ad}" title="Remove">Remove</button></div>`; fragment.appendChild(li);
             // **** DEBUGGING LINE ****
             console.log(`[DEBUG] Rendering wallet item: ${ad.substring(0, 6)}..., Monitoring: ${m}`);
             // ***********************
         });
         elements.walletsList.appendChild(fragment);
         console.log("[DEBUG] Finished rendering wallet list."); // **** DEBUGGING LINE ****
     };

     // (renderNotifications, renderCommonTokens, renderTransactions, renderTxTransfers remain the same)
     const renderNotifications = (notifs) => { setLoadingState(elements.notificationsLoading, elements.notificationsError, false); elements.notificationsList.innerHTML = ''; if (!notifs?.length) { elements.notificationsList.innerHTML = '<li class="info-text">No alerts.</li>'; return; } const frag = document.createDocumentFragment(); notifs.forEach(n => { const li = document.createElement('li'); const dDate = new Date(n.detectionTimestamp).toLocaleString(); const tDisplay = n.tokenDetails?.symbol ? `(${n.tokenDetails.name ? `${n.tokenDetails.name} - ` : ''}${n.tokenDetails.symbol})` : ''; li.innerHTML = `<strong>🚨 Token Minted ${tDisplay}</strong><br>Mint: <code><a href="${SOLSCAN_BASE}/token/${n.tokenMintAddress}" target="_blank" title="${n.tokenMintAddress}">${shortenAddress(n.tokenMintAddress)}</a></code> By Recip: <code><a href="${SOLSCAN_BASE}/account/${n.recipientWallet}" target="_blank" title="${n.recipientWallet}">${shortenAddress(n.recipientWallet)}</a></code> From Primary: <code><a href="${SOLSCAN_BASE}/account/${n.sourceWallet}" target="_blank" title="${n.sourceWallet}">${shortenAddress(n.sourceWallet)}</a></code><br><span class="timestamp">Detected: ${dDate}</span><span class="links">| <a href="${SOLSCAN_BASE}/tx/${n.transactionSignature}" target="_blank">Fund Tx</a>${n.tokenCreationSignature ? `| <a href="${SOLSCAN_BASE}/tx/${n.tokenCreationSignature}" target="_blank">Mint Tx</a>` : ''}</span>`; frag.appendChild(li); }); elements.notificationsList.appendChild(frag); };
     const renderCommonTokens = (tokens) => { setLoadingState(elements.commonTokensLoading, elements.commonTokensError, false); elements.commonTokensList.innerHTML = ''; elements.commonTokenTimeframeSpan.textContent = currentMonitorStatus.monitoringWindowMinutes || '?'; if (!tokens?.length) { elements.commonTokensList.innerHTML = `<li class="info-text">No common tokens in last ${currentMonitorStatus.monitoringWindowMinutes || '?'}m.</li>`; return; } const frag = document.createDocumentFragment(); tokens.forEach(t => { const li = document.createElement('li'); const tName = t.name && t.name !== 'Unknown' ? `${t.name} (${t.symbol || '?'})` : `Token (${t.symbol || '?'})`; const traders = t.tradingWallets || []; const tCount = t.tradingWalletsCount || traders.length; li.innerHTML = `<strong>${tName}</strong><br>Mint: <code><a href="${SOLSCAN_BASE}/token/${t.mintAddress}" target="_blank" title="${t.mintAddress}">${shortenAddress(t.mintAddress)}</a></code><br>Traded by <strong>${tCount} recipients</strong>:<span class="timestamp trader-list"> ${traders.slice(0,10).map(w=>`<a href="${SOLSCAN_BASE}/account/${w}" target="_blank" title="${w}"><code>${shortenAddress(w,4)}</code></a>`).join(', ')}${traders.length > 10 ? '...':''}</span><br><span class="timestamp">Last Update: ${new Date(t.lastDetectionTimestamp).toLocaleString()}</span>`; frag.appendChild(li); }); elements.commonTokensList.appendChild(frag); };
    const renderTransactions = (txs) => { setLoadingState(elements.transactionsLoading, elements.transactionsError, false); elements.transactionsList.innerHTML = ''; if (!txs?.length) { elements.transactionsList.innerHTML = '<li class="info-text">No tx found.</li>'; return; } const frag = document.createDocumentFragment(); txs.forEach(tx => { const li = document.createElement('li'); const tDate = tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'N/A'; const isErr = tx.error || tx.meta?.err; const errCls = isErr ? 'error' : ''; li.innerHTML = `<div class="tx-header ${errCls}">Tx: <code><a href="${SOLSCAN_BASE}/tx/${tx.signature}" target="_blank">${shortenAddress(tx.signature, 12)}</a></code>${isErr ? '<strong style="color:var(--danger-color);"> (Fail)</strong>' : ''}</div><span class="timestamp">${tDate} | Fee: ${tx.fee ? (tx.fee / 1e9).toFixed(6) : '?'} SOL</span><br>Type: ${tx.type || '?'} | Src: ${tx.source || '?'}<br><details><summary>Details</summary><div class="tx-details"><p>${tx.description || '-'}</p>${renderTxTransfers(tx)}${isErr ? `<p style="color:var(--danger-color);font-weight:bold;">Err: ${JSON.stringify(isErr)}</p>` : ''}</div></details>`; frag.appendChild(li); }); elements.transactionsList.appendChild(frag); };
    const renderTxTransfers = (tx) => { let d = ''; if (tx.nativeTransfers?.length) { d += `<p><strong>SOL:</strong><br>${tx.nativeTransfers.map(t=>`• ${(t.amount/1e9).toFixed(4)} <code title="${t.fromUserAccount}">${shortenAddress(t.fromUserAccount,4)}</code>→<code title="${t.toUserAccount}">${shortenAddress(t.toUserAccount,4)}</code>`).join('<br>')}</p>`; } if (tx.tokenTransfers?.length) { d += `<p><strong>Tokens:</strong><br>${tx.tokenTransfers.map(t=>`• ${t.tokenAmount?.toFixed(t.tokenStandard === 'fungible'?2:0) || '?'} <code title="${t.mint}">${shortenAddress(t.mint, 4)}</code> <code title="${t.fromUserAccount}">${shortenAddress(t.fromUserAccount,4)}</code>→<code title="${t.toUserAccount}">${shortenAddress(t.toUserAccount,4)}</code>`).join('<br>')}</p>`; } return d || '<p>No transfers parsed.</p>'; }


    // --- Data Fetching Wrapper --- (remains the same)
    const fetchData = async (loaderFunc, loadingElement, errorElement, successCallback = null) => { setLoadingState(loadingElement, errorElement, true); try { await loaderFunc(); if (successCallback) successCallback(); } catch (error) { console.error(`Error during fetchData execution for ${loaderFunc.name}:`, error); setLoadingState(loadingElement, errorElement, false, `Failed to load: ${error.message}`); } };

    // --- Specific Data Loading Functions ---
    const loadWallets = async () => {
        // **** DEBUGGING LINE ****
        console.log("[DEBUG] loadWallets: Calling API GET /wallets...");
        let wallets = []; // Default to empty array
        try {
            wallets = await apiRequest('/wallets'); // Fetch list
            // **** DEBUGGING LINE ****
            console.log("[DEBUG] loadWallets: Received wallets from API:", JSON.stringify(wallets));
        } catch (error) {
            // Error is logged by apiRequest, show message via fetchData caller
            console.error("[DEBUG] loadWallets: API request failed.", error);
             throw error; // Re-throw so fetchData shows the error message
         } finally {
            // Ensure currentWallets is always an array, even if API returns null/undefined on error/empty
             currentWallets = Array.isArray(wallets) ? wallets : [];
            renderWallets(); // Render whatever we have (or empty state)
         }
     };

     // (loadMonitorStatus, loadNotifications, loadCommonTokens, loadWalletTransactions remain the same)
    const loadMonitorStatus = async () => { const status = await apiRequest('/monitor/status'); const statusChanged = currentMonitorStatus.monitoringWindowMinutes !== status.monitoringWindowMinutes || currentMonitorStatus.isGloballyEnabled !== status.isGloballyEnabled || currentMonitorStatus.activeMonitorsCount !== status.activeMonitorsCount; currentMonitorStatus = status; elements.monitorWindowSelect.value = status.monitoringWindowMinutes; elements.globalMonitorSwitch.checked = status.isGloballyEnabled; elements.globalMonitorStatusText.textContent = status.isGloballyEnabled ? 'ACTIVE' : 'INACTIVE'; elements.monitorStatusInfo.textContent = `Tracking ${status.activeMonitorsCount || 0} tx.`; if (statusChanged && elements.commonTokenTimeframeSpan.textContent !== String(status.monitoringWindowMinutes)) { elements.commonTokenTimeframeSpan.textContent = status.monitoringWindowMinutes; console.log("Window change detected by status check, refreshing common tokens."); await fetchData(loadCommonTokens, elements.commonTokensLoading, elements.commonTokensError); } };
    const loadNotifications = async () => { const notifs = await apiRequest('/notifications?limit=50') || []; renderNotifications(notifs); };
    const loadCommonTokens = async () => { const tf = currentMonitorStatus?.monitoringWindowMinutes || 60; const tokens = await apiRequest(`/monitor/common-tokens?timeframe=${tf}&limit=30`) || []; renderCommonTokens(tokens); };
    const loadWalletTransactions = async (addr) => { const txs = await apiRequest(`/wallets/${addr}/transactions?limit=30`) || []; renderTransactions(txs); };


    // --- Event Handlers ---
    const handleAddWalletSubmit = async (e) => {
        e.preventDefault();
        const address = elements.walletAddressInput.value.trim();
        // (Input validation remains the same)
        if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) { showTemporaryMessage(elements.addErrorMessage, 'Invalid address.', true); return; }

        elements.addErrorMessage.textContent = '';
        elements.addWalletBtn.disabled = true;
        elements.addWalletBtn.textContent = 'Adding...';

        try {
            // **** DEBUGGING LINE ****
            console.log(`[DEBUG] handleAddWalletSubmit: Sending POST /api/wallets with address: ${address}`);
            const newWallet = await apiRequest('/wallets', 'POST', { address });
             // **** DEBUGGING LINE ****
             console.log("[DEBUG] handleAddWalletSubmit: API Response received:", JSON.stringify(newWallet));

            elements.walletAddressInput.value = '';

            if (newWallet && newWallet.address) {
                showTemporaryMessage(elements.settingsMessage, `Wallet ${shortenAddress(newWallet.address)} added successfully!`, false);
            } else {
                // This case should now primarily be hit if the API returns 200/204 but no body,
                // or if there's an issue not caught by the error handler (less likely).
                console.warn("[DEBUG] Add wallet request successful but response format unexpected:", newWallet);
                showTemporaryMessage(elements.settingsMessage, `Wallet added (response unclear, refreshing list).`, false);
            }

            // **** DEBUGGING LINE ****
             console.log("[DEBUG] handleAddWalletSubmit: Calling fetchData(loadWallets) to refresh list...");
            await fetchData(loadWallets, elements.walletsList, elements.addErrorMessage); // Reload list always

        } catch (error) {
             // **** DEBUGGING LINE ****
             console.error("[DEBUG] handleAddWalletSubmit: Add failed in catch block:", error);
            showTemporaryMessage(elements.addErrorMessage, `Add fail: ${error.message}`, true);
        } finally {
             elements.addWalletBtn.disabled = false;
             elements.addWalletBtn.textContent = 'Add Wallet';
             console.log("[DEBUG] handleAddWalletSubmit: Finished."); // **** DEBUGGING LINE ****
        }
     };

     // (handleWalletListClick, handleUpdateWindow, handleGlobalSwitchChange, openDetailsView, closeDetailsView remain the same)
     const handleWalletListClick = async (e) => { const btn = e.target.closest('button[data-address]'); if (!btn) return; const addr = btn.dataset.address; const action = btn.classList.contains('toggle-btn') ? 'toggle' : btn.classList.contains('delete-btn') ? 'delete' : btn.classList.contains('details-btn') ? 'details' : null; if (!action || !addr) return; btn.disabled = true; const origTxt = btn.textContent; btn.textContent='Wait...'; try { switch (action) { case 'toggle': const updatedW = await apiRequest(`/wallets/${addr}/toggle`, 'PUT'); await loadWallets(); await loadMonitorStatus(); showTemporaryMessage(elements.settingsMessage, `Track ${shortenAddress(addr)} ${updatedW.isMonitoring?'ON':'OFF'}`, false); break; case 'delete': if (confirm(`Remove ${shortenAddress(addr)}?`)) { await apiRequest(`/wallets/${addr}`, 'DELETE'); await loadWallets(); if (!elements.walletDetailsSection.classList.contains('hidden') && elements.detailsWalletAddressSpan.title===addr) closeDetailsView(); await loadMonitorStatus(); showTemporaryMessage(elements.settingsMessage, `Removed ${shortenAddress(addr)}`, false); } else { btn.disabled = false; btn.textContent=origTxt; } break; case 'details': openDetailsView(addr); btn.disabled=false; btn.textContent=origTxt; break; } } catch (err) { showTemporaryMessage(elements.settingsMessage, `Fail: ${err.message}`, true); btn.disabled = false; btn.textContent=origTxt; await loadWallets();} };
     const handleUpdateWindow = async () => { const win = elements.monitorWindowSelect.value; elements.updateSettingsBtn.disabled=true; showTemporaryMessage(elements.settingsMessage,'Updating...',false,2000); try { const res=await apiRequest('/monitor/settings/window', 'PUT', {minutes: win}); currentMonitorStatus.monitoringWindowMinutes=res.monitoringWindowMinutes; elements.commonTokenTimeframeSpan.textContent=res.monitoringWindowMinutes; showTemporaryMessage(elements.settingsMessage,`Window set ${res.monitoringWindowMinutes}m`,false); await fetchData(loadCommonTokens, elements.commonTokensLoading, elements.commonTokensError); } catch (err) { showTemporaryMessage(elements.settingsMessage,`Update fail: ${err.message}`, true); await loadMonitorStatus(); } finally { elements.updateSettingsBtn.disabled=false; } };
     const handleGlobalSwitchChange = async (e) => { const enabled = e.target.checked; elements.globalMonitorSwitch.disabled=true; elements.globalMonitorStatusText.textContent='Updating...'; try { const res = await apiRequest('/monitor/settings/global', 'PUT', { enabled }); currentMonitorStatus.isGloballyEnabled=res.isGloballyEnabled; elements.globalMonitorSwitch.checked=res.isGloballyEnabled; elements.globalMonitorStatusText.textContent = res.isGloballyEnabled?'ACTIVE':'INACTIVE'; showTemporaryMessage(elements.settingsMessage,`Monitoring ${res.isGloballyEnabled?'ON':'OFF'}`,false); await loadMonitorStatus(); } catch (err) { showTemporaryMessage(elements.settingsMessage, `Update fail: ${err.message}`, true); await loadMonitorStatus(); } finally { elements.globalMonitorSwitch.disabled=false; } };
     const openDetailsView = (addr) => { elements.detailsWalletAddressSpan.textContent = shortenAddress(addr); elements.detailsWalletAddressSpan.title = addr; elements.walletDetailsSection.classList.remove('hidden'); fetchData(()=>loadWalletTransactions(addr), elements.transactionsLoading, elements.transactionsError); elements.walletDetailsSection.scrollIntoView({behavior:'smooth',block:'nearest'}); };
     const closeDetailsView = () => { elements.walletDetailsSection.classList.add('hidden'); elements.detailsWalletAddressSpan.textContent=''; elements.detailsWalletAddressSpan.title=''; elements.transactionsList.innerHTML=''; elements.transactionsError.textContent=''; };


    // --- Initialization ---
     const initialize = () => {
         console.log("[DEBUG] Initializing Frontend...");
         // (API_BASE_URL check remains the same)
         if (!API_BASE_URL || API_BASE_URL.includes('your-render-backend-name')) { console.error("CRITICAL: API_BASE_URL not set in script.js!"); alert("ERROR: Frontend API URL is not configured."); return; }
         console.log(`[DEBUG] API Endpoint: ${API_BASE_URL}`);

         // Attach Event Listeners (remain the same)
         elements.addWalletForm.addEventListener('submit', handleAddWalletSubmit);
         elements.walletsList.addEventListener('click', handleWalletListClick);
         elements.updateSettingsBtn.addEventListener('click', handleUpdateWindow);
         elements.globalMonitorSwitch.addEventListener('change', handleGlobalSwitchChange);
         elements.refreshNotificationsBtn.addEventListener('click', () => fetchData(loadNotifications, elements.notificationsLoading, elements.notificationsError));
         elements.refreshCommonTokensBtn.addEventListener('click', () => fetchData(loadCommonTokens, elements.commonTokensLoading, elements.commonTokensError));
         elements.closeDetailsBtn.addEventListener('click', closeDetailsView);

         // Initial Data Load Sequence (remain the same)
         console.log("[DEBUG] Performing initial data load sequence...");
        fetchData(loadMonitorStatus, elements.monitorStatusInfo, elements.settingsMessage)
             .then(() => fetchData(loadWallets, elements.walletsList, elements.addErrorMessage)) // fetchData for loadWallets
             .then(() => fetchData(loadNotifications, elements.notificationsLoading, elements.notificationsError))
             .then(() => {
                 console.log("[DEBUG] Initial data load sequence complete.");
                 // Start Polling after successful load
                console.log(`[DEBUG] Starting polling intervals.`);
                 if (intervals.status) clearInterval(intervals.status); intervals.status = setInterval(loadMonitorStatus, REFRESH_INTERVAL_STATUS);
                 if (intervals.notifications) clearInterval(intervals.notifications); intervals.notifications = setInterval(loadNotifications, REFRESH_INTERVAL_NOTIFICATIONS);
                 if (intervals.commonTokens) clearInterval(intervals.commonTokens); intervals.commonTokens = setInterval(loadCommonTokens, REFRESH_INTERVAL_COMMON_TOKENS);
            })
            .catch(error => {
                console.error("[DEBUG] ERROR during initial data load sequence:", error);
                 showTemporaryMessage(elements.settingsMessage, "Failed initial data load. Check console.", true, 10000);
            });
    }; // End initialize function

    // --- Run Initialization ---
    initialize();

}); // End DOMContentLoaded

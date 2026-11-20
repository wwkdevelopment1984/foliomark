/**
 * FolioMark Manifest V3 Background Service Worker
 * Coordinates tab context updates, side panel opening, tool state sync,
 * and cross-context messaging between content scripts and the sidebar dashboard.
 */

const TOOLBAR_STATE_KEY = 'foliomark_toolbar_visible';

// Allow clicking the extension action icon to toggle the side panel and toolbar
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn('[FolioMark] sidePanel behavior setup:', err);
  }

  // Inject into already-open tabs so users do not lose the toolbar after reloading the extension
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url || !/^(https?|file):/i.test(tab.url)) continue;
      chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles/content.css'] }).catch(() => {});
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
  } catch (_) {}
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (_) {
    // Fallback if opened via command or unsupported context
  }
  sendMessageToTab(tab.id, { type: 'FM_SHOW_TOOLBAR' });
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'toggle-toolbar') {
    sendMessageToTab(tab.id, { type: 'FM_TOGGLE_TOOLBAR' });
  } else if (command === 'tool-text') {
    sendMessageToTab(tab.id, { type: 'FM_SET_TOOL', tool: 'text' });
  } else if (command === 'tool-pen') {
    sendMessageToTab(tab.id, { type: 'FM_SET_TOOL', tool: 'pen' });
  }
});

// Broadcast active tab navigation changes so the Side Panel stays in sync
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    broadcastToExtension({
      type: 'FM_TAB_CHANGED',
      tabId,
      url: tab.url || '',
      title: tab.title || 'Untitled Page',
    });
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    broadcastToExtension({
      type: 'FM_TAB_CHANGED',
      tabId,
      url: tab.url || '',
      title: tab.title || 'Untitled Page',
    });
  }
});

// Message Router between Content Script and Side Panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    case 'FM_GET_ACTIVE_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        sendResponse(
          active
            ? { tabId: active.id, url: active.url || '', title: active.title || '' }
            : null
        );
      });
      return true;
    }

    case 'FM_OPEN_SIDE_PANEL': {
      const tabId = sender?.tab?.id;
      if (tabId && chrome.sidePanel?.open) {
        chrome.sidePanel
          .open({ tabId })
          .then(() => sendResponse({ ok: true }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      sendResponse({ ok: false });
      return false;
    }

    case 'FM_RELAY_TO_ACTIVE_TAB': {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const active = tabs && tabs[0];
        if (!active || !active.id) {
          sendResponse({ ok: false, error: 'No active tab' });
          return;
        }
        const res = await sendMessageToTab(active.id, message.payload);
        if (res.ok) {
          sendResponse({ ok: true, data: res.data });
        } else {
          sendResponse({ ok: false, error: res.error || 'Could not reach tab' });
        }
      });
      return true;
    }

    case 'FM_ANNOTATIONS_UPDATED': {
      // Forward update notifications from content scripts to side panel listeners
      broadcastToExtension({
        type: 'FM_SIDEBAR_REFRESH',
        urlKey: message.urlKey,
      });
      sendResponse({ ok: true });
      return false;
    }

    case 'FM_SAVE_PREF': {
      chrome.storage.local.set({ [TOOLBAR_STATE_KEY]: message.visible }, () => {
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'FM_CAPTURE_VISIBLE_TAB': {
      const windowId = sender?.tab?.windowId ?? null;
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError?.message || 'Screen capture failed',
          });
        } else {
          sendResponse({ ok: true, dataUrl });
        }
      });
      return true;
    }

    case 'FM_DOWNLOAD_CAPTURE': {
      if (!chrome.downloads || typeof chrome.downloads.download !== 'function') {
        sendResponse({ ok: false, error: 'Downloads API unavailable' });
        return false;
      }
      chrome.downloads.download(
        {
          url: message.dataUrl,
          filename: message.filename || 'foliomark-capture.png',
          saveAs: message.saveAs !== false,
        },
        (downloadId) => {
          const errMsg = chrome.runtime.lastError?.message || '';
          if (errMsg || downloadId == null) {
            const cancelled = /cancel/i.test(errMsg);
            sendResponse({
              ok: false,
              cancelled,
              error: errMsg || 'Download failed',
            });
          } else {
            sendResponse({ ok: true, downloadId });
          }
        }
      );
      return true;
    }

    default:
      return false;
  }
});

async function sendMessageToTab(tabId, payload) {
  try {
    const data = await chrome.tabs.sendMessage(tabId, payload);
    return { ok: true, data };
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const data = await chrome.tabs.sendMessage(tabId, payload);
      return { ok: true, data };
    } catch (err) {
      // Content script cannot run on chrome:// or restricted URLs
      return { ok: false, error: err?.message || 'Restricted page' };
    }
  }
}

function broadcastToExtension(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {
    // Ignore when side panel is closed
  });
}

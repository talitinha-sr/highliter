const STORAGE_KEY = "highliter.highlights";
const AVAILABLE_COLORS = ["yellow", "green", "blue", "pink", "orange"];

const stripHash = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    console.warn("Highliter background: não foi possível normalizar URL", error);
    return url;
  }
};

const getRandomId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `highlight-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

async function readStorage() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? {};
}

async function writeStorage(map) {
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

async function getHighlightsForUrl(url) {
  const normalized = stripHash(url);
  const map = await readStorage();
  const highlights = map[normalized] ?? [];
  return Array.isArray(highlights) ? highlights.slice() : [];
}

async function persistHighlight(payload) {
  const normalizedUrl = stripHash(payload.url);
  const map = await readStorage();
  const list = Array.isArray(map[normalizedUrl]) ? map[normalizedUrl] : [];

  const normalizedHighlight = {
    id: payload.id ?? getRandomId(),
    url: normalizedUrl,
    color: payload.color,
    text: payload.text,
    startXPath: payload.startXPath,
    startOffset: payload.startOffset,
    endXPath: payload.endXPath,
    endOffset: payload.endOffset,
    createdAt: payload.createdAt ?? Date.now(),
  };

  const duplicate = list.find(
    (item) =>
      item.startXPath === normalizedHighlight.startXPath &&
      item.startOffset === normalizedHighlight.startOffset &&
      item.endXPath === normalizedHighlight.endXPath &&
      item.endOffset === normalizedHighlight.endOffset &&
      item.text === normalizedHighlight.text
  );

  if (duplicate) {
    return duplicate;
  }

  list.push(normalizedHighlight);
  list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  map[normalizedUrl] = list;
  await writeStorage(map);
  await broadcastHighlights(normalizedUrl, list);
  return normalizedHighlight;
}

async function deleteHighlight(url, id) {
  const normalized = stripHash(url);
  const map = await readStorage();
  const list = Array.isArray(map[normalized]) ? map[normalized] : [];
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  const [removed] = list.splice(index, 1);
  if (list.length === 0) {
    delete map[normalized];
  } else {
    map[normalized] = list;
  }
  await writeStorage(map);
  await broadcastHighlights(normalized, list);
  return removed;
}

async function broadcastHighlights(url, highlights) {
  chrome.runtime.sendMessage(
    {
      type: "HIGHLIGHTS_UPDATED",
      payload: { url, highlights },
    },
    () => void chrome.runtime.lastError
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const map = await readStorage();
  if (typeof map !== "object" || map === null) {
    await writeStorage({});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  switch (message.type) {
    case "GET_AVAILABLE_COLORS": {
      sendResponse({ success: true, colors: AVAILABLE_COLORS.slice() });
      break;
    }
    case "GET_HIGHLIGHTS": {
      const url = message.payload?.url ?? sender.tab?.url;
      if (!url) {
        sendResponse({ success: false, error: "URL inválida" });
        break;
      }
      getHighlightsForUrl(url)
        .then((highlights) => {
          sendResponse({ success: true, highlights });
        })
        .catch((error) => {
          console.error("Highliter background: falha ao carregar", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    case "CREATE_HIGHLIGHT": {
      if (!message.payload) {
        sendResponse({ success: false, error: "Payload inválido" });
        break;
      }
      persistHighlight(message.payload)
        .then((highlight) => {
          sendResponse({ success: true, highlight });
        })
        .catch((error) => {
          console.error("Highliter background: falha ao salvar highlight", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    case "REMOVE_HIGHLIGHT": {
      const { url, id, tabId } = message.payload ?? {};
      if (!url || !id) {
        sendResponse({ success: false, error: "Dados insuficientes" });
        break;
      }
      deleteHighlight(url, id)
        .then((removed) => {
          if (removed && typeof tabId === "number") {
            chrome.tabs.sendMessage(
              tabId,
              { type: "REMOVE_HIGHLIGHT", id },
              () => void chrome.runtime.lastError
            );
          }
          sendResponse({ success: Boolean(removed), highlight: removed });
        })
        .catch((error) => {
          console.error("Highliter background: falha ao remover highlight", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
    case "CLEAR_HIGHLIGHTS": {
      const url = message.payload?.url;
      if (!url) {
        sendResponse({ success: false, error: "URL inválida" });
        break;
      }
      (async () => {
        const normalized = stripHash(url);
        const map = await readStorage();
        const list = map[normalized] ?? [];
        delete map[normalized];
        await writeStorage(map);
        await broadcastHighlights(normalized, []);
        if (typeof message.payload?.tabId === "number") {
          chrome.tabs.sendMessage(
            message.payload.tabId,
            { type: "SYNC_HIGHLIGHTS", highlights: [] },
            () => void chrome.runtime.lastError
          );
        }
        sendResponse({ success: true, removed: list.length });
      })().catch((error) => {
        console.error("Highliter background: falha ao limpar", error);
        sendResponse({ success: false, error: error.message });
      });
      return true;
    }
    default:
      break;
  }

  return false;
});

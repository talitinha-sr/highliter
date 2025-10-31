(() => {
  const AVAILABLE_COLORS = ["yellow", "green", "blue", "pink", "orange"];
  const HIGHLIGHT_CLASS = "highliter-highlight";
  const FOCUSED_CLASS = "highliter-highlight--focused";
  const HIGHLIGHT_ATTR = "data-highlight-id";

  let currentColor = AVAILABLE_COLORS[0];
  const highlightCache = new Map();

  const stripHash = (url) => {
    try {
      const parsed = new URL(url, window.location.href);
      parsed.hash = "";
      return parsed.toString();
    } catch (error) {
      console.warn("Highliter: não foi possível normalizar URL", error);
      return url;
    }
  };

  const pageUrl = stripHash(window.location.href);

  function getNodeTextLength(node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.length ?? 0;
    }
    return node.childNodes.length;
  }

  function getXPath(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;
      if (!parent) {
        return "";
      }
      const parentXPath = getXPath(parent);
      const textNodes = Array.from(parent.childNodes).filter(
        (child) => child.nodeType === Node.TEXT_NODE
      );
      const index = textNodes.indexOf(node) + 1;
      return `${parentXPath}/text()[${index}]`;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node === document.documentElement) {
        return "/html";
      }
      const parent = node.parentElement;
      if (!parent) {
        return `/${node.tagName.toLowerCase()}`;
      }
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === node.tagName
      );
      const index = siblings.indexOf(node) + 1;
      return `${getXPath(parent)}/${node.tagName.toLowerCase()}[${index}]`;
    }
    return "";
  }

  function getNodeByXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (error) {
      console.warn("Highliter: falha ao resolver XPath", xpath, error);
      return null;
    }
  }

  function serializeRange(range, color) {
    if (
      range.startContainer.nodeType !== Node.TEXT_NODE ||
      range.endContainer.nodeType !== Node.TEXT_NODE
    ) {
      console.warn(
        "Highliter: seleções em nós não textuais ainda não são suportadas"
      );
      return null;
    }

    const selectionText = range.toString();
    if (!selectionText.trim()) {
      return null;
    }

    return {
      url: pageUrl,
      color,
      text: selectionText,
      startXPath: getXPath(range.startContainer),
      startOffset: range.startOffset,
      endXPath: getXPath(range.endContainer),
      endOffset: range.endOffset,
      createdAt: Date.now(),
    };
  }

  function createRangeFromSerialized(serialized) {
    const startNode = getNodeByXPath(serialized.startXPath);
    const endNode = getNodeByXPath(serialized.endXPath);
    if (!startNode || !endNode) {
      return null;
    }
    const range = document.createRange();
    try {
      const startOffset = Math.min(
        serialized.startOffset,
        getNodeTextLength(startNode)
      );
      const endOffset = Math.min(
        serialized.endOffset,
        getNodeTextLength(endNode)
      );
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (error) {
      console.warn("Highliter: não foi possível restaurar range", error);
      return null;
    }
  }

  function wrapRange(range, highlight) {
    try {
      const span = document.createElement("span");
      span.className = `${HIGHLIGHT_CLASS} highliter-${highlight.color}`;
      span.setAttribute(HIGHLIGHT_ATTR, highlight.id);
      span.dataset.highlightColor = highlight.color;
      span.dataset.highlightText = highlight.text ?? "";

      const contents = range.extractContents();
      span.appendChild(contents);
      range.insertNode(span);
      span.normalize();
      highlightCache.set(highlight.id, highlight);
      return span;
    } catch (error) {
      console.warn("Highliter: falha ao aplicar highlight", error);
      return null;
    }
  }

  function applyHighlight(highlight) {
    if (!highlight || !highlight.id) {
      return;
    }
    if (document.querySelector(`[${HIGHLIGHT_ATTR}="${highlight.id}"]`)) {
      highlightCache.set(highlight.id, highlight);
      return;
    }
    const range = createRangeFromSerialized(highlight);
    if (!range) {
      return;
    }
    wrapRange(range, highlight);
  }

  function removeHighlightElement(id) {
    const element = document.querySelector(`[${HIGHLIGHT_ATTR}="${id}"]`);
    if (!element || !element.parentNode) {
      return false;
    }
    const parent = element.parentNode;
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    element.remove();
    parent.normalize();
    highlightCache.delete(id);
    return true;
  }

  function isEditableNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }
    if (!(node instanceof Element)) {
      return false;
    }
    return !!node.closest("input, textarea, [contenteditable='true']");
  }

  function selectionInsideHighlight(range) {
    const startHighlight =
      range.startContainer.parentElement?.closest(`.${HIGHLIGHT_CLASS}`);
    const endHighlight =
      range.endContainer.parentElement?.closest(`.${HIGHLIGHT_CLASS}`);
    return Boolean(startHighlight || endHighlight);
  }

  function processSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    if (selection.rangeCount === 0) {
      return;
    }
    if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) {
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    if (!range || !range.toString().trim()) {
      return;
    }

    if (selectionInsideHighlight(range)) {
      selection.removeAllRanges();
      return;
    }

    const serialized = serializeRange(range, currentColor);
    if (!serialized) {
      selection.removeAllRanges();
      return;
    }

    chrome.runtime.sendMessage(
      { type: "CREATE_HIGHLIGHT", payload: serialized },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Highliter: falha ao comunicar highlight", chrome.runtime.lastError);
          return;
        }
        if (response?.success && response.highlight) {
          applyHighlight(response.highlight);
        }
      }
    );
    selection.removeAllRanges();
  }

  let selectionTimeout = null;
  function scheduleSelectionProcessing() {
    if (selectionTimeout) {
      clearTimeout(selectionTimeout);
    }
    selectionTimeout = setTimeout(processSelection, 120);
  }

  document.addEventListener("mouseup", scheduleSelectionProcessing);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      window.getSelection()?.removeAllRanges();
      return;
    }
    scheduleSelectionProcessing();
  });

  function requestStoredHighlights() {
    chrome.runtime.sendMessage(
      { type: "GET_HIGHLIGHTS", payload: { url: pageUrl } },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Highliter: não foi possível carregar grifos",
            chrome.runtime.lastError
          );
          return;
        }
        if (response?.success && Array.isArray(response.highlights)) {
          synchronizeHighlights(response.highlights);
        }
      }
    );
  }

  function focusHighlight(id) {
    const element = document.querySelector(`[${HIGHLIGHT_ATTR}="${id}"]`);
    if (!element) {
      return false;
    }
    element.classList.add(FOCUSED_CLASS);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      element.classList.remove(FOCUSED_CLASS);
    }, 2200);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    switch (message.type) {
      case "SET_CURRENT_COLOR":
        if (typeof message.color === "string" && AVAILABLE_COLORS.includes(message.color)) {
          currentColor = message.color;
          sendResponse?.({ success: true, color: currentColor });
        } else {
          sendResponse?.({ success: false });
        }
        break;
      case "SCROLL_TO_HIGHLIGHT":
        sendResponse?.({ success: focusHighlight(message.id) });
        break;
      case "REMOVE_HIGHLIGHT":
        sendResponse?.({ success: removeHighlightElement(message.id) });
        break;
      case "APPLY_HIGHLIGHT":
        if (message.highlight) {
          applyHighlight(message.highlight);
        }
        sendResponse?.({ success: true });
        break;
      case "SYNC_HIGHLIGHTS":
        synchronizeHighlights(message.highlights);
        sendResponse?.({ success: true });
        break;
      case "GET_CURRENT_COLOR":
        sendResponse?.({ color: currentColor, colors: AVAILABLE_COLORS.slice() });
        break;
      default:
        break;
    }

    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", requestStoredHighlights, {
      once: true,
    });
  } else {
    requestStoredHighlights();
  }
})();

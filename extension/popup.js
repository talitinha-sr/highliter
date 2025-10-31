const DEFAULT_COLORS = ["yellow", "green", "blue", "pink", "orange"];
const COLOR_LABELS = {
  yellow: "Amarelo",
  green: "Verde",
  blue: "Azul",
  pink: "Rosa",
  orange: "Laranja",
};
const COLOR_VISUALS = {
  yellow: { swatch: "#fff59d", text: "#3e3e00" },
  green: { swatch: "#a5d6a7", text: "#1b5e20" },
  blue: { swatch: "#90caf9", text: "#0d47a1" },
  pink: { swatch: "#f48fb1", text: "#880e4f" },
  orange: { swatch: "#ffcc80", text: "#e65100" },
};

const colorPickerEl = document.getElementById("colorPicker");
const colorFilterEl = document.getElementById("colorFilter");
const highlightsContainerEl = document.getElementById("highlightsContainer");
const emptyStateEl = document.getElementById("emptyState");
const copyButtonEl = document.getElementById("copyButton");
const exportButtonEl = document.getElementById("exportButton");
const clearButtonEl = document.getElementById("clearButton");
const currentColorLabelEl = document.getElementById("currentColorLabel");
const template = document.getElementById("highlightTemplate");

let activeTabId = null;
let pageUrl = null;
let availableColors = DEFAULT_COLORS.slice();
let highlights = [];
let currentColor = DEFAULT_COLORS[0];
let statusTimer = null;
let baseStatusText = "";

const stripHash = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (error) {
    console.warn("Highliter popup: URL inválida", error);
    return url;
  }
};

const colorLabel = (color) => COLOR_LABELS[color] ?? color;

const runtimeMessage = (message) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Highliter popup: mensagem runtime falhou",
            chrome.runtime.lastError.message
          );
          resolve(null);
        } else {
          resolve(response ?? null);
        }
      });
    } catch (error) {
      console.warn("Highliter popup: erro ao enviar mensagem runtime", error);
      resolve(null);
    }
  });

const tabMessage = (tabId, message) =>
  new Promise((resolve) => {
    if (typeof tabId !== "number") {
      resolve(null);
      return;
    }
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "Highliter popup: mensagem para aba falhou",
            chrome.runtime.lastError.message
          );
          resolve(null);
        } else {
          resolve(response ?? null);
        }
      });
    } catch (error) {
      console.warn("Highliter popup: erro ao enviar mensagem para aba", error);
      resolve(null);
    }
  });

const queryActiveTab = () =>
  new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "Highliter popup: falha ao consultar aba",
          chrome.runtime.lastError.message
        );
        resolve(null);
        return;
      }
      resolve(tabs?.[0] ?? null);
    });
  });

function updateBaseStatus() {
  baseStatusText = `Cor atual: ${colorLabel(currentColor)}`;
  if (currentColorLabelEl) {
    currentColorLabelEl.textContent = baseStatusText;
  }
}

function setStatus(message, { duration = 2500 } = {}) {
  if (!currentColorLabelEl) {
    return;
  }
  if (!message) {
    updateBaseStatus();
    return;
  }
  currentColorLabelEl.textContent = message;
  if (statusTimer) {
    clearTimeout(statusTimer);
  }
  if (duration > 0) {
    statusTimer = setTimeout(() => {
      updateBaseStatus();
    }, duration);
  }
}

function buildColorPicker() {
  if (!colorPickerEl) {
    return;
  }
  colorPickerEl.innerHTML = "";
  availableColors.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `color-picker__option`;
    button.dataset.color = color;
    const visuals = COLOR_VISUALS[color];
    if (visuals) {
      button.style.background = visuals.swatch;
      button.style.color = visuals.text;
    }
    button.setAttribute("aria-label", `Selecionar cor ${colorLabel(color)}`);
    button.title = `${colorLabel(color)}`;
    button.addEventListener("click", () => {
      setActiveColor(color);
    });
    colorPickerEl.appendChild(button);
  });
  refreshColorPickerState();
}

function refreshColorPickerState(counts = {}) {
  if (!colorPickerEl) {
    return;
  }
  colorPickerEl.querySelectorAll("[data-color]").forEach((button) => {
    const color = button.dataset.color;
    const pressed = color === currentColor;
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    const count = counts[color] ?? 0;
    button.title = `${colorLabel(color)} • ${count} grifo${count === 1 ? "" : "s"}`;
  });
}

function populateFilterOptions(counts = {}) {
  if (!colorFilterEl) {
    return;
  }
  const currentValue = colorFilterEl.value || "all";
  colorFilterEl.innerHTML = "";
  const total = highlights.length;
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `Todas as cores (${total})`;
  colorFilterEl.appendChild(allOption);

  availableColors.forEach((color) => {
    const option = document.createElement("option");
    option.value = color;
    const count = counts[color] ?? 0;
    option.textContent = `${colorLabel(color)} (${count})`;
    colorFilterEl.appendChild(option);
  });
  const hasValue = Array.from(colorFilterEl.options).some(
    (option) => option.value === currentValue
  );
  colorFilterEl.value = hasValue ? currentValue : "all";
}

function getFilteredHighlights() {
  const selectedColor = colorFilterEl?.value ?? "all";
  return highlights.filter((item) =>
    selectedColor === "all" ? true : item.color === selectedColor
  );
}

function createHighlightElement(highlight) {
  if (!template) {
    return document.createElement("div");
  }
  const fragment = template.content.cloneNode(true);
  const element = fragment.querySelector(".highlight-item");
  element.dataset.id = highlight.id;
  element.dataset.color = highlight.color;

  const badge = element.querySelector(".highlight-item__badge");
  badge.textContent = colorLabel(highlight.color);
  const visuals = COLOR_VISUALS[highlight.color];
  if (visuals) {
    badge.style.setProperty("--badge-color", visuals.swatch);
  }

  const meta = element.querySelector(".highlight-item__meta");
  if (meta) {
    const createdAt = highlight.createdAt
      ? new Date(highlight.createdAt)
      : new Date();
    meta.textContent = createdAt.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
    meta.title = createdAt.toISOString();
  }

  const textEl = element.querySelector(".highlight-item__text");
  textEl.textContent = highlight.text ?? "";

  element.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      handleHighlightAction(action, highlight);
    });
  });

  return element;
}


async function setActiveColor(color) {
  if (!availableColors.includes(color)) {
    return;
  }
  const response = await tabMessage(activeTabId, {
    type: "SET_CURRENT_COLOR",
    color,
  });
  if (response?.success && response.color) {
    currentColor = response.color;
  } else {
    currentColor = color;
  }
  updateBaseStatus();
  setStatus(`Cor ativa: ${colorLabel(currentColor)}`, { duration: 1800 });
  refreshColorPickerState(getColorCounts());
}

async function fetchCurrentColor() {
  const response = await tabMessage(activeTabId, { type: "GET_CURRENT_COLOR" });
  if (response?.color && availableColors.includes(response.color)) {
    currentColor = response.color;
  }
  if (Array.isArray(response?.colors) && response.colors.length > 0) {
    availableColors = response.colors;
  }
  buildColorPicker();
  updateBaseStatus();
}

function getColorCounts() {
  return highlights.reduce((acc, item) => {
    acc[item.color] = (acc[item.color] ?? 0) + 1;
    return acc;
  }, {});
}

function renderHighlights() {
  if (!highlightsContainerEl) {
    return;
  }
  const filtered = getFilteredHighlights();
  const counts = getColorCounts();
  refreshColorPickerState(counts);
  populateFilterOptions(counts);

  if (copyButtonEl) {
    copyButtonEl.disabled = filtered.length === 0;
  }
  if (exportButtonEl) {
    exportButtonEl.disabled = filtered.length === 0;
  }
  if (clearButtonEl) {
    clearButtonEl.disabled = highlights.length === 0;
  }

  highlightsContainerEl.innerHTML = "";
  if (filtered.length === 0) {
    if (emptyStateEl) {
      emptyStateEl.hidden = false;
    }
    return;
  }
  if (emptyStateEl) {
    emptyStateEl.hidden = true;
  }

  const grouped = new Map();
  filtered.forEach((item) => {
    if (!grouped.has(item.color)) {
      grouped.set(item.color, []);
    }
    grouped.get(item.color).push(item);
  });

  availableColors.forEach((color) => {
    const items = grouped.get(color);
    if (!items || items.length === 0) {
      return;
    }
    const group = document.createElement("div");
    group.className = "highlight-group";

    const title = document.createElement("h3");
    title.className = "highlight-group__title";
    title.textContent = `${colorLabel(color)} (${items.length})`;
    group.appendChild(title);

    items
      .slice()
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .forEach((highlight) => {
        group.appendChild(createHighlightElement(highlight));
      });

    highlightsContainerEl.appendChild(group);
  });
}

async function handleHighlightAction(action, highlight) {
  switch (action) {
    case "go": {
      const response = await tabMessage(activeTabId, {
        type: "SCROLL_TO_HIGHLIGHT",
        id: highlight.id,
      });
      if (response?.success) {
        setStatus("Grifo localizado na página.");
      } else {
        setStatus("Não foi possível localizar o grifo.", { duration: 3200 });
      }
      break;
    }
    case "copy": {
      try {
        await navigator.clipboard.writeText(highlight.text ?? "");
        setStatus("Grifo copiado para a área de transferência.");
      } catch (error) {
        console.warn("Highliter popup: erro ao copiar grifo", error);
        setStatus("Não foi possível copiar o texto.", { duration: 3200 });
      }
      break;
    }
    case "remove": {
      const confirmed = window.confirm("Remover este grifo?");
      if (!confirmed) {
        return;
      }
      const response = await runtimeMessage({
        type: "REMOVE_HIGHLIGHT",
        payload: {
          url: pageUrl,
          id: highlight.id,
          tabId: activeTabId,
        },
      });
      if (response?.success) {
        highlights = highlights.filter((item) => item.id !== highlight.id);
        renderHighlights();
        setStatus("Grifo removido.");
      } else {
        setStatus("Falha ao remover o grifo.", { duration: 3200 });
      }
      break;
    }
    default:
      break;
  }
}

async function copyFilteredHighlights() {
  const filtered = getFilteredHighlights();
  if (filtered.length === 0) {
    setStatus("Nenhum grifo para copiar.", { duration: 2600 });
    return;
  }
  const lines = filtered.map((item, index) => {
    const label = colorLabel(item.color);
    const createdAt = item.createdAt
      ? new Date(item.createdAt).toLocaleString("pt-BR")
      : "";
    return `${index + 1}. [${label}] ${item.text}${createdAt ? `\n   (${createdAt})` : ""}`;
  });
  try {
    await navigator.clipboard.writeText(lines.join("\n\n"));
    setStatus("Grifos copiados.", { duration: 2600 });
  } catch (error) {
    console.warn("Highliter popup: erro ao copiar grifos", error);
    setStatus("Não foi possível copiar os grifos.", { duration: 3200 });
  }
}

function exportFilteredHighlights() {
  const filtered = getFilteredHighlights();
  if (filtered.length === 0) {
    setStatus("Nenhum grifo para exportar.", { duration: 2600 });
    return;
  }
  const payload = {
    url: pageUrl,
    exportedAt: new Date().toISOString(),
    highlights: filtered,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  const safeHost = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/[^a-z0-9.-]/gi, "-");
    } catch (error) {
      return "pagina";
    }
  })();
  link.href = URL.createObjectURL(blob);
  link.download = `highliter-${safeHost}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  setStatus("Arquivo exportado.", { duration: 3200 });
}

async function clearHighlightsForPage() {
  if (highlights.length === 0) {
    setStatus("Nenhum grifo para limpar.", { duration: 2400 });
    return;
  }
  const confirmed = window.confirm("Remover todos os grifos desta página?");
  if (!confirmed) {
    return;
  }
  const response = await runtimeMessage({
    type: "CLEAR_HIGHLIGHTS",
    payload: { url: pageUrl, tabId: activeTabId },
  });
  if (response?.success) {
    highlights = [];
    renderHighlights();
    setStatus("Todos os grifos foram removidos.", { duration: 3200 });
  } else {
    setStatus("Não foi possível limpar os grifos.", { duration: 3200 });
  }
}

async function loadHighlights() {
  const response = await runtimeMessage({
    type: "GET_HIGHLIGHTS",
    payload: { url: pageUrl },
  });
  if (response?.success && Array.isArray(response.highlights)) {
    highlights = response.highlights;
  } else {
    highlights = [];
  }
  renderHighlights();
}

function registerEventListeners() {
  colorFilterEl?.addEventListener("change", () => {
    renderHighlights();
  });
  copyButtonEl?.addEventListener("click", () => {
    copyFilteredHighlights();
  });
  exportButtonEl?.addEventListener("click", () => {
    exportFilteredHighlights();
  });
  clearButtonEl?.addEventListener("click", () => {
    clearHighlightsForPage();
  });
}

function subscribeToUpdates() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "HIGHLIGHTS_UPDATED") {
      return;
    }
    const payload = message.payload ?? {};
    if (payload.url !== pageUrl) {
      return;
    }
    highlights = Array.isArray(payload.highlights) ? payload.highlights : [];
    renderHighlights();
  });
}

async function fetchAvailableColors() {
  const response = await runtimeMessage({ type: "GET_AVAILABLE_COLORS" });
  if (response?.success && Array.isArray(response.colors) && response.colors.length > 0) {
    availableColors = response.colors;
    if (!availableColors.includes(currentColor)) {
      currentColor = availableColors[0];
    }
  }
}

async function init() {
  const tab = await queryActiveTab();
  if (!tab?.id || !tab.url) {
    setStatus("Não foi possível carregar a aba atual.", { duration: 4000 });
    return;
  }
  activeTabId = tab.id;
  pageUrl = stripHash(tab.url);

  await fetchAvailableColors();
  buildColorPicker();
  registerEventListeners();
  subscribeToUpdates();
  await fetchCurrentColor();
  await loadHighlights();
}

init();

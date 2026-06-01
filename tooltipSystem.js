const TOOLTIP_STYLE_ID = "snoolink-tooltip-style";
const TOOLTIP_ID = "snoolink-global-tooltip";

const DEFAULT_SELECTOR = [
  "input",
  "select",
  "textarea",
  "button",
  "output",
  "progress",
  "meter",
  "video",
  "audio",
  "[role='button']",
  "[role='progressbar']",
  "[data-tooltip]",
].join(",");

function ensureTooltipStyles(doc) {
  if (!doc || doc.getElementById(TOOLTIP_STYLE_ID)) {
    return;
  }

  const style = doc.createElement("style");
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = `
    .snoolink-tooltip {
      position: fixed;
      z-index: 100000;
      max-width: calc(100vw - 24px);
      padding: 12px 13px;
      border-radius: 10px;
      border: 1px solid rgba(151, 192, 255, 0.45);
      background: linear-gradient(145deg, rgba(8, 16, 28, 0.98), rgba(14, 26, 42, 0.97));
      color: #e9f3ff;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      font-size: 0.79rem;
      line-height: 1.5;
      letter-spacing: 0.01em;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 100ms ease, transform 120ms ease;
    }

    .snoolink-tooltip__line {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .snoolink-tooltip__line + .snoolink-tooltip__line {
      margin-top: 6px;
    }

    .snoolink-tooltip__label {
      color: #9fc8ff;
      font-weight: 700;
      flex: 0 0 auto;
      margin-right: 2px;
    }

    .snoolink-tooltip__text {
      color: #e9f3ff;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .snoolink-tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }

  `;

  doc.head.appendChild(style);
}

function ensureTooltipNode(doc) {
  let node = doc.getElementById(TOOLTIP_ID);
  if (node) {
    return node;
  }

  node = doc.createElement("div");
  node.id = TOOLTIP_ID;
  node.className = "snoolink-tooltip";
  node.setAttribute("role", "tooltip");
  node.setAttribute("aria-hidden", "true");
  doc.body.appendChild(node);
  return node;
}

function toReadableToken(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLabelForElement(el) {
  const doc = el?.ownerDocument;
  if (!doc || !(el instanceof HTMLElement)) {
    return "";
  }

  const ariaLabel = String(el.getAttribute("aria-label") || "").trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const id = String(el.id || "").trim();
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    const labelText = String(label?.textContent || "").trim();
    if (labelText) {
      return labelText;
    }
  }

  if (el instanceof HTMLButtonElement) {
    const text = String(el.textContent || "").trim();
    if (text) {
      return text;
    }
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const placeholder = String(el.placeholder || "").trim();
    if (placeholder) {
      return placeholder;
    }
  }

  const title = String(el.getAttribute("title") || "").trim();
  if (title) {
    return title;
  }

  const nameAttr = String(el.getAttribute("name") || "").trim();
  if (nameAttr) {
    return toReadableToken(nameAttr);
  }

  const dataKey = String(el.getAttribute("data-filter-key") || "").trim();
  if (dataKey) {
    return toReadableToken(dataKey);
  }

  if (id) {
    return toReadableToken(id);
  }

  return toReadableToken(el.tagName || "control") || "control";
}

function inferControlType(el) {
  if (el instanceof HTMLButtonElement || el.getAttribute("role") === "button") {
    return "button";
  }
  if (el instanceof HTMLSelectElement) {
    return "selector";
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return "input";
  }
  if (
    el instanceof HTMLOutputElement
    || el instanceof HTMLProgressElement
    || el.getAttribute("role") === "progressbar"
  ) {
    return "output";
  }
  if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
    return "media";
  }
  return "control";
}

function buildGenericTooltip(el) {
  const label = findLabelForElement(el) || "This control";
  const kind = inferControlType(el);

  if (kind === "button") {
    return `Does: Runs ${label}. Why: This action moves your workflow forward or changes app state. Tip: Confirm your current selection and settings before clicking.`;
  }

  if (kind === "selector") {
    return `Does: Chooses ${label}. Why: Your choice filters, formats, or changes how results are generated. Tip: Try one change at a time to learn its effect quickly.`;
  }

  if (kind === "input") {
    return `Does: Sets ${label}. Why: This value controls quality, search precision, or processing behavior. Tip: Start with safe defaults, then tune gradually.`;
  }

  if (kind === "output") {
    return `Does: Shows ${label}. Why: This feedback helps you verify progress and avoid mistakes. Tip: Check this before running another action.`;
  }

  if (kind === "media") {
    return `Does: Previews ${label}. Why: Preview confirms content and quality before export or download. Tip: Scrub and inspect important moments before finalizing.`;
  }

  return `Does: Controls ${label}. Why: It influences app behavior or results. Tip: Hover any related field first to understand dependencies.`;
}

function getTooltipText(el, customTextById) {
  if (!(el instanceof HTMLElement)) {
    return "";
  }

  const id = String(el.id || "").trim();
  if (id && customTextById && typeof customTextById[id] === "string") {
    return customTextById[id].trim();
  }

  const dataTooltip = String(el.getAttribute("data-tooltip") || "").trim();
  if (dataTooltip) {
    return dataTooltip;
  }

  const title = String(el.getAttribute("title") || "").trim();
  if (title) {
    return `Does: ${title}. Why: This helps you understand the control at a glance. Tip: Use keyboard focus to read this tooltip without a mouse.`;
  }

  return buildGenericTooltip(el);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseStructuredTooltip(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }

  const sectionRegex = /(Does|What|Why|Tip|How to use well):\s*([\s\S]*?)(?=\s(?:Does|What|Why|Tip|How to use well):|$)/gi;
  const lines = [];
  const seenLabels = new Set();
  let match = sectionRegex.exec(raw);

  while (match) {
    const rawLabel = String(match[1] || "").trim();
    const label = /^what$/i.test(rawLabel) ? "Does" : rawLabel;
    const body = String(match[2] || "").trim();
    const dedupeKey = label.toLowerCase();
    if (body && !seenLabels.has(dedupeKey)) {
      seenLabels.add(dedupeKey);
      lines.push({ label, text: body });
    }
    match = sectionRegex.exec(raw);
  }

  if (lines.length > 0) {
    return lines;
  }

  return [{ label: "", text: raw }];
}

function renderTooltipContent(node, text) {
  const lines = parseStructuredTooltip(text);
  node.innerHTML = "";
  if (lines.length === 0) {
    node.textContent = String(text || "").trim();
    return;
  }

  for (const line of lines) {
    const row = node.ownerDocument.createElement("p");
    row.className = "snoolink-tooltip__line";

    if (line.label) {
      const label = node.ownerDocument.createElement("span");
      label.className = "snoolink-tooltip__label";
      label.textContent = `${line.label}:`;
      row.appendChild(label);
    }

    const body = node.ownerDocument.createElement("span");
    body.className = "snoolink-tooltip__text";
    body.textContent = line.text;
    row.appendChild(body);

    node.appendChild(row);
  }
}

export function installTooltipSystem(options = {}) {
  const doc = options.document || document;
  const selector = String(options.selector || DEFAULT_SELECTOR);
  const customTextById = options.customTextById && typeof options.customTextById === "object"
    ? options.customTextById
    : {};
  const buttonHoverDelayMs = Number.isFinite(Number(options.buttonHoverDelayMs))
    ? Math.max(0, Number(options.buttonHoverDelayMs))
    : 3000;
  const defaultHoverDelayMs = Number.isFinite(Number(options.defaultHoverDelayMs))
    ? Math.max(0, Number(options.defaultHoverDelayMs))
    : 0;
  let tooltipsEnabled = options.enabled !== false;

  ensureTooltipStyles(doc);
  const tooltipNode = ensureTooltipNode(doc);

  let activeEl = null;
  let hideTimer = null;
  const hoverShowTimers = new WeakMap();

  const clearHoverShowTimer = (el) => {
    if (!(el instanceof HTMLElement)) {
      return;
    }
    const timer = hoverShowTimers.get(el);
    if (timer) {
      clearTimeout(timer);
      hoverShowTimers.delete(el);
    }
  };

  const hideTooltip = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (activeEl && activeEl instanceof HTMLElement) {
      const existing = String(activeEl.getAttribute("aria-describedby") || "").trim();
      if (existing) {
        const next = existing
          .split(/\s+/)
          .filter((token) => token && token !== TOOLTIP_ID)
          .join(" ");
        if (next) {
          activeEl.setAttribute("aria-describedby", next);
        } else {
          activeEl.removeAttribute("aria-describedby");
        }
      }
    }
    activeEl = null;
    tooltipNode.classList.remove("visible");
    tooltipNode.setAttribute("aria-hidden", "true");
  };

  const showTooltip = (el) => {
    if (!tooltipsEnabled) {
      hideTooltip();
      return;
    }
    if (!(el instanceof HTMLElement)) {
      hideTooltip();
      return;
    }

    const text = String(el.getAttribute("data-snoolink-tooltip-text") || "").trim();
    if (!text) {
      hideTooltip();
      return;
    }

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    activeEl = el;
    renderTooltipContent(tooltipNode, text);
    tooltipNode.setAttribute("aria-hidden", "false");

    const describedBy = String(el.getAttribute("aria-describedby") || "").trim();
    if (!describedBy.includes(TOOLTIP_ID)) {
      const next = describedBy ? `${describedBy} ${TOOLTIP_ID}` : TOOLTIP_ID;
      el.setAttribute("aria-describedby", next);
    }

    tooltipNode.classList.add("visible");

    const rect = el.getBoundingClientRect();
    const tooltipRect = tooltipNode.getBoundingClientRect();
    const top = clamp(rect.top - tooltipRect.height - 10, 8, window.innerHeight - tooltipRect.height - 8);
    const left = clamp(rect.left + (rect.width / 2) - (tooltipRect.width / 2), 8, window.innerWidth - tooltipRect.width - 8);

    tooltipNode.style.top = `${top}px`;
    tooltipNode.style.left = `${left}px`;
  };

  const annotateElement = (el) => {
    if (!(el instanceof HTMLElement)) {
      return;
    }
    if (el.getAttribute("data-snoolink-tooltip") === "true") {
      return;
    }

    const text = getTooltipText(el, customTextById);
    if (!text) {
      return;
    }

    el.setAttribute("data-snoolink-tooltip", "true");
    el.setAttribute("data-snoolink-tooltip-text", text);

    if (!el.getAttribute("aria-label") && el instanceof HTMLButtonElement) {
      const label = findLabelForElement(el);
      if (label) {
        el.setAttribute("aria-label", label);
      }
    }

    el.addEventListener("mouseenter", () => {
      clearHoverShowTimer(el);
      if (!tooltipsEnabled) {
        return;
      }
      const isButton = el instanceof HTMLButtonElement || el.getAttribute("role") === "button";
      const delayMs = isButton ? buttonHoverDelayMs : defaultHoverDelayMs;
      const timerId = window.setTimeout(() => {
        hoverShowTimers.delete(el);
        showTooltip(el);
      }, delayMs);
      hoverShowTimers.set(el, timerId);
    });
    el.addEventListener("focus", () => showTooltip(el));
    el.addEventListener("mouseleave", () => {
      clearHoverShowTimer(el);
      hideTimer = window.setTimeout(hideTooltip, 80);
    });
    el.addEventListener("blur", () => {
      clearHoverShowTimer(el);
      hideTooltip();
    });
  };

  const scan = (scope = doc) => {
    const nodes = scope.querySelectorAll(selector);
    for (const node of nodes) {
      annotateElement(node);
    }
  };

  scan(doc);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches?.(selector)) {
          annotateElement(node);
        }
        scan(node);
      }
    }
  });

  observer.observe(doc.body, { childList: true, subtree: true });

  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTooltip();
    }
  });

  doc.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);

  return {
    refresh: () => scan(doc),
    setEnabled: (enabled) => {
      tooltipsEnabled = Boolean(enabled);
      if (!tooltipsEnabled) {
        hideTooltip();
      }
    },
    destroy: () => {
      observer.disconnect();
      hideTooltip();
    },
  };
}

/**
 * Browser interaction recorder.
 *
 * Events are retained in memory until Shift + Z exports them as a JSON file.
 * Text and number fields are recorded once on blur with their final value;
 * passwords and other input types are deliberately excluded. jQuery AJAX calls are captured
 * after completion, together with their request and response payloads.
 */
const APPLICATION_SECRET = "event-lab-interaction-values-v1";
const DEFAULT_OPTIONS = Object.freeze({
  filename: "Default.json",
  groupByParam: "state",
});
const cryptoEncoder = new TextEncoder();
let encryptionKeyPromise;

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function getEncryptionKey() {
  encryptionKeyPromise ||= crypto.subtle
    .digest("SHA-256", cryptoEncoder.encode(APPLICATION_SECRET))
    .then((hash) => crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]));
  return encryptionKeyPromise;
}

async function encryptText(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getEncryptionKey(),
    cryptoEncoder.encode(value),
  );
  return {
    encrypted: true,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

let activeRecorder;

function getTestEnvironment() {
  const userAgent = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || "알 수 없음";
  const isMobile = navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const desktopPlatform = /Win|Mac|Linux x86_64|Linux i[3-6]86/i.test(platform);
  const likelyMobileEmulation = Boolean(isMobile && desktopPlatform);
  const browserMatch = userAgent.match(/(?:Edg|EdgA|EdgiOS)\/([\d.]+)/) || userAgent.match(/OPR\/([\d.]+)/) || userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/) || userAgent.match(/(?:Firefox|FxiOS)\/([\d.]+)/) || userAgent.match(/Version\/([\d.]+).*Safari/);
  const browserName = /(?:Edg|EdgA|EdgiOS)\//.test(userAgent) ? "Microsoft Edge" : /OPR\//.test(userAgent) ? "Opera" : /(?:Chrome|CriOS)\//.test(userAgent) ? "Chrome" : /(?:Firefox|FxiOS)\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "알 수 없는 브라우저";
  const os = /Windows NT/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad|iPod/.test(userAgent) ? "iOS/iPadOS" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : platform;
  return {
    deviceType: likelyMobileEmulation ? "pc-mobile-emulation" : isMobile ? "mobile" : "pc",
    deviceLabel: likelyMobileEmulation ? "PC 모바일 모드 (추정)" : isMobile ? "Mobile" : "PC",
    detectionNote: likelyMobileEmulation ? "모바일 UA와 데스크톱 플랫폼 조합을 기반으로 추정" : null,
    browser: { name: browserName, version: browserMatch?.[1] || null },
    os,
    platform,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    devicePixelRatio: window.devicePixelRatio,
    touchPoints: navigator.maxTouchPoints || 0,
    language: navigator.language,
    userAgent,
  };
}

function getElementInfo(element) {
  if (!(element instanceof Element)) return null;

  const classes = [...element.classList].slice(0, 3);
  const selector = [
    element.tagName.toLowerCase(),
    element.id ? `#${CSS.escape(element.id)}` : "",
    classes.length ? `.${classes.map(CSS.escape).join(".")}` : "",
  ].join("");

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classes,
    name: element.getAttribute("name"),
    type: element.getAttribute("type"),
    ariaLabel: element.getAttribute("aria-label"),
    text: element.textContent.trim().replace(/\s+/g, " ").slice(0, 100) || null,
    selector,
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeJsonFilename(filename, fallback) {
  const value = String(filename || "").trim() || fallback;
  return value.toLowerCase().endsWith(".json") ? value : `${value}.json`;
}

/**
 * Starts recording browser interactions.
 *
 * @param {{ filename?: string, groupByParam?: string, getState?: () => string, tranData?: Record<string, { tranId: string, desc?: string }>, currentStage?: string, currentWas?: string }} options
 * @returns {{ exportJson: (filename?: string) => object, getSnapshot: () => object, clear: () => void, stop: () => void }}
 */
export function init(options = {}) {
  if (activeRecorder) return activeRecorder;

  options = { ...DEFAULT_OPTIONS, ...options };
  const eventsByState = {};
  let sequence = 0;
  let focusedTextField = null;
  let pendingNetworkCount = 0;
  let isRecording = true;
  const pendingEncryptions = new Set();
  const jquery = window.jQuery;
  const tranData = options.tranData && typeof options.tranData === "object" ? options.tranData : {};
  const filename = options.filename || "browser-interactions.json";
  const groupByParam = options.groupByParam?.trim();
  const unclassifiedGroup = "unclassified";
  const readState = options.getState || (() => {
    if (!groupByParam) return unclassifiedGroup;
    return new URLSearchParams(window.location.search).get(groupByParam)?.trim() || unclassifiedGroup;
  });

  function record(type, details, state = readState() || unclassifiedGroup, eventMetadata = {}) {
    const event = {
      sequence: eventMetadata.sequence ?? ++sequence,
      timestamp: eventMetadata.timestamp || new Date().toISOString(),
      type,
      ...details,
    };
    (eventsByState[state] ||= []).push(event);
    return event;
  }

  function getSnapshot() {
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      grouping: { queryParam: groupByParam || null },
      serverStatus: {
        currentStage: options.currentStage || null,
        currentWas: options.currentWas || null,
      },
      testEnvironment: getTestEnvironment(),
      eventsByState,
    };
  }

  async function exportJson(exportFilename = filename) {
    await Promise.all(pendingEncryptions);
    const snapshot = getSnapshot();
    downloadJson(snapshot, normalizeJsonFilename(exportFilename, filename));
    return snapshot;
  }

  function onClick(event) {
    if (pendingNetworkCount) return;
    const interactiveTarget = event.target.closest("button, a[href], input, textarea, select, summary, [role='button'], [contenteditable='true'], [data-record-click]");
    if (!interactiveTarget) return;
    const isRadio = interactiveTarget instanceof HTMLInputElement && interactiveTarget.type === "radio";
    record(isRadio ? "radio" : "click", {
      element: getElementInfo(interactiveTarget),
      ...(isRadio ? { value: interactiveTarget.value, checked: interactiveTarget.checked } : {}),
      pointer: { x: event.clientX, y: event.clientY, button: event.button },
    });
  }

  function isRecordableTextField(target) {
    return target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ["text", "number"].includes(target.type));
  }

  function onFocusin(event) {
    if (pendingNetworkCount) return;
    if (!isRecordableTextField(event.target)) return;
    focusedTextField = {
      element: event.target,
      initialValue: event.target.value,
      state: readState() || unclassifiedGroup,
    };
  }

  function onBlur(event) {
    if (!focusedTextField || event.target !== focusedTextField.element) return;
    const { element, initialValue, state } = focusedTextField;
    focusedTextField = null;
    if (pendingNetworkCount) return;
    if (element.value === initialValue) return;
    const elementInfo = getElementInfo(element);
    const value = element.value;
    const inputEvent = record("input", { element: elementInfo, value: null }, state);
    const encryption = encryptText(value)
      .then((encryptedValue) => { inputEvent.value = encryptedValue; })
      .finally(() => pendingEncryptions.delete(encryption));
    pendingEncryptions.add(encryption);
  }

  function onKeydown(event) {
    const isExportKey = event.code === "KeyZ" || ["z", "ㅋ"].includes(event.key.toLowerCase());
    const isExportShortcut = event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && isExportKey;
    if (isExportShortcut) {
      event.preventDefault();
      const exportFilename = window.prompt("저장할 JSON 파일명을 입력해 주세요.", "Default");
      if (exportFilename !== null) exportJson(exportFilename);
      return;
    }

    if (pendingNetworkCount) return;
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    if (isRecordableTextField(event.target)) return;

    record("keydown", {
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
      },
      element: getElementInfo(event.target),
    });

  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", onFocusin, true);
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("keydown", onKeydown, true);

  function parseJsonField(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  }

  function readAjaxRequestBody(body) {
    try {
      if (body instanceof FormData) {
        const fields = {};
        for (const [key, value] of body.entries()) {
          if (key === "delayMs") continue;
          const fieldValue = typeof value === "string" ? value : { name: value.name, type: value.type, size: value.size };
          fields[key] = ["header", "body"].includes(key) ? parseJsonField(fieldValue) : fieldValue;
        }
        return fields;
      }
      if (typeof body === "string") {
        const fields = {};
        for (const [key, value] of new URLSearchParams(body)) fields[key] = ["header", "body"].includes(key) ? parseJsonField(value) : value;
        return Object.keys(fields).length ? fields : body;
      }
      return body == null || typeof body === "object" ? body : String(body);
    } catch {
      return null;
    }
  }

  function readAjaxResponseBody(xhr) {
    try {
      if (xhr.responseJSON !== undefined) return xhr.responseJSON;
      return parseJsonField(xhr.responseText) || null;
    } catch {
      return null;
    }
  }

  function isPageResourceRequest(settings, url) {
    const dataType = String(settings.dataType || "").toLowerCase();
    if (["html", "script", "jsonp"].includes(dataType)) return true;

    const pathname = new URL(url, location.href).pathname;
    return /\.(?:html?|xhtml|js|mjs|cjs|css|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot)$/i.test(pathname);
  }

  function recordAjaxComplete(xhr, request) {
    if (!isRecording) return;
    const succeeded = xhr.status >= 200 && xhr.status < 300;
    record("network", {
      requestedAt: request.requestedAt,
      responseTimeMs: Math.round(performance.now() - request.requestStartedAt),
      request: { method: request.method, url: request.url, body: request.body },
      response: xhr.status
        ? { status: xhr.status, ok: succeeded, body: readAjaxResponseBody(xhr) }
        : { error: "네트워크 요청에 실패했습니다." },
      reqName: request.reqName || null,
      desc: request.desc || null,
    }, request.state, { sequence: request.sequence, timestamp: request.requestedAt });
    pendingNetworkCount = Math.max(0, pendingNetworkCount - 1);
  }

  jquery?.ajaxPrefilter((settings, originalSettings, xhr) => {
    if (!isRecording) return;
    const url = new URL(settings.url, location.href).href;
    if (isPageResourceRequest(settings, url)) return;
    const body = readAjaxRequestBody(settings.data);
    const tranId = body?.header?.tranId;
    const tranEntry = Object.entries(tranData).find(([, info]) => info?.tranId === tranId);
    const request = {
      state: readState() || unclassifiedGroup,
      requestedAt: new Date().toISOString(),
      requestStartedAt: performance.now(),
      sequence: ++sequence,
      method: String(settings.type || settings.method || "GET").toUpperCase(),
      url,
      body,
      reqName: tranEntry?.[0] || null,
      desc: tranEntry?.[1]?.desc || null,
    };
    pendingNetworkCount += 1;
    xhr.always(() => {
      recordAjaxComplete(xhr, request);
    });
  });

  activeRecorder = {
    exportJson,
    getSnapshot,
    clear() {
      Object.keys(eventsByState).forEach((state) => delete eventsByState[state]);
      sequence = 0;
    },
    stop() {
      isRecording = false;
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusin, true);
      document.removeEventListener("blur", onBlur, true);
      document.removeEventListener("keydown", onKeydown, true);
      activeRecorder = undefined;
    },
  };

  return activeRecorder;
}

const recorder = Object.freeze({ init });

export default recorder;

// Keep the viewer self-contained so it also works when opened directly as a local file.
const cryptoEncoder = new TextEncoder();
const cryptoDecoder = new TextDecoder();
let decryptionKeyPromise;

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
function getDecryptionKey() {
  decryptionKeyPromise ||= crypto.subtle
    .digest("SHA-256", cryptoEncoder.encode("event-lab-interaction-values-v1"))
    .then((hash) => crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]));
  return decryptionKeyPromise;
}
function isEncryptedText(value) {
  return value?.encrypted === true && value.algorithm === "AES-GCM" && typeof value.iv === "string" && typeof value.data === "string";
}
async function decryptText(value) {
  if (!isEncryptedText(value)) return value;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(value.iv) },
    await getDecryptionKey(),
    base64ToBytes(value.data),
  );
  return cryptoDecoder.decode(decrypted);
}

const $ = (selector) => document.querySelector(selector);
const uploadScreen = $("#upload-screen"), viewer = $("#viewer"), input = $("#file-input"), error = $("#error"), dropZone = $("#drop-zone");
let states = {};
const networkDetails = new Map();
let networkDetailSequence = 0;
let detailRawText = "";
let detailMatches = [];
let currentDetailMatch = -1;
let detailCaseSensitive = true;

function escapeHtml(value) { const el = document.createElement("div"); el.textContent = value ?? ""; return el.innerHTML; }
function labelFor(event) {
  if (event.type === "click") return "클릭";
  if (event.type === "radio") return `라디오 버튼 클릭 · ${event.value ?? ""}`;
  if (event.type === "input") return `텍스트 입력 · ${event.value ?? ""}`;
  if (event.type === "network") return `서버통신 · ${event.request?.body?.header?.tranId || "알 수 없는 tranId"}`;
  if (event.type === "keydown") return `키 입력 · ${event.key === " " ? "Space" : event.key}`;
  return event.type || "이벤트";
}
function iconFor(event) { return event.type === "click" ? "⌁" : event.type === "radio" ? "◉" : event.type === "input" ? "✎" : event.type === "network" ? "⇄" : event.type === "keydown" ? "⌨" : "•"; }
function targetFor(event) {
  if (event.type === "network") return event.request?.url || "요청 주소 없음";
  const el = event.element;
  if (!el) return "대상 정보 없음";
  const text = el.ariaLabel || el.text || el.name || el.id;
  return text ? `“${text}”` : el.selector || el.tagName || "대상 정보 없음";
}
function formatTime(value) { const date = new Date(value); return Number.isNaN(date) ? "시간 정보 없음" : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function formatDuration(ms) { if (!Number.isFinite(ms) || ms < 0) return "—"; if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}초`; const minutes = Math.floor(ms / 60000), seconds = Math.round((ms % 60000) / 1000); return `${minutes}분${seconds ? ` ${seconds}초` : ""}`; }
function isTextEntry(event) {
  const element = event.element;
  return event.type === "keydown" && ["input", "textarea"].includes(element?.tagName?.toLowerCase()) && event.key?.length === 1 && !event.modifiers?.ctrl && !event.modifiers?.meta && !event.modifiers?.alt;
}
function sameTarget(first, next) {
  const a = first.element, b = next.element;
  return a && b && a.selector === b.selector && a.id === b.id && a.name === b.name;
}
// Recorder에 자모가 기록된 경우(ㄱㅣㅁ) 사람이 읽는 완성형 한글(김)으로 조합한다.
function composeHangul(value) {
  const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const vowels = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
  const finals = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const doubleInitial = { "ㄱㄱ": "ㄲ", "ㄷㄷ": "ㄸ", "ㅂㅂ": "ㅃ", "ㅅㅅ": "ㅆ", "ㅈㅈ": "ㅉ" };
  const doubleVowel = { "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ", "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ" };
  const doubleFinal = { "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ" };
  const splitFinal = Object.fromEntries(Object.entries(doubleFinal).map(([pair, combined]) => [combined, [...pair]]));
  const isConsonant = (char) => initials.includes(char);
  const isVowel = (char) => vowels.includes(char);
  let result = "", initial = "", vowel = "", final = "";
  const flush = () => {
    if (initial && vowel) result += String.fromCharCode(0xac00 + (initials.indexOf(initial) * 21 + vowels.indexOf(vowel)) * 28 + finals.indexOf(final));
    else result += initial || vowel;
    initial = ""; vowel = ""; final = "";
  };
  for (const char of value) {
    if (isConsonant(char)) {
      if (!initial) initial = char;
      else if (!vowel) {
        const combined = doubleInitial[initial + char];
        if (combined) initial = combined;
        else { flush(); initial = char; }
      } else if (!final && finals.includes(char)) final = char;
      else if (final && doubleFinal[final + char]) final = doubleFinal[final + char];
      else { flush(); initial = char; }
    } else if (isVowel(char)) {
      if (!initial) { result += char; continue; }
      if (!vowel) vowel = char;
      else if (!final && doubleVowel[vowel + char]) vowel = doubleVowel[vowel + char];
      else if (final) {
        const split = splitFinal[final];
        if (split) { final = split[0]; flush(); initial = split[1]; }
        else { const nextInitial = final; final = ""; flush(); initial = nextInitial; }
        vowel = char;
      } else { flush(); initial = "ㅇ"; vowel = char; }
    } else { flush(); result += char; }
  }
  flush();
  return result;
}
function groupEvents(events) {
  const groups = [];
  events.forEach((event) => {
    const previous = groups.at(-1);
    if (isTextEntry(event) && previous?.kind === "typing" && sameTarget(previous.first, event)) {
      previous.events.push(event);
      previous.text += event.key;
    } else if (isTextEntry(event)) {
      groups.push({ kind: "typing", first: event, events: [event], text: event.key });
    } else if (event.type !== "keydown" || !["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
      groups.push({ kind: "event", first: event, events: [event] });
    }
  });
  return groups;
}
function renderTimeline() {
  networkDetails.clear();
  networkDetailSequence = 0;
  const ordered = Object.entries(states).flatMap(([state, events]) => events.map((event) => ({ state, event }))).sort((a, b) => (a.event.sequence ?? Infinity) - (b.event.sequence ?? Infinity) || new Date(a.event.timestamp) - new Date(b.event.timestamp));
  const blocks = ordered.reduce((result, item) => {
    const block = result.at(-1);
    if (block?.state === item.state) block.events.push(item.event);
    else result.push({ state: item.state, events: [item.event] });
    return result;
  }, []);
  $("#state-count").textContent = blocks.length;
  const stateStepper = $("#state-stepper");
  stateStepper.innerHTML = blocks.map((block, index) => `${index ? '<span class="state-step-arrow" aria-hidden="true">→</span>' : ""}<button class="state-step${index === 0 ? " is-current" : ""}" type="button" data-step-index="${index}"${index === 0 ? ' aria-current="step"' : ""} aria-label="${index + 1}번째 state ${escapeHtml(block.state)}로 이동"><span class="step-number">${String(index + 1).padStart(2, "0")}</span><span class="step-name">${escapeHtml(block.state)}</span></button>`).join("");
  stateStepper.classList.toggle("hidden", blocks.length < 2);
  $("#timeline").innerHTML = blocks.length ? blocks.map((block, index) => {
    const groupedEvents = groupEvents(block.events);
    const eventCards = groupedEvents.map((group) => {
    const event = group.first;
    const selector = event.element?.selector;
    const responsePayload = event.response?.body;
    const responseBody = responsePayload?.responseMessage?.body
      ?? responsePayload?.receivedFormData?.body
      ?? responsePayload;
    const isErrorValue = responseBody?.isError;
    const serverReportedError = isErrorValue === true || (typeof isErrorValue === "string" && isErrorValue.trim().toLowerCase() === "true");
    const networkFailed = Boolean(event.response?.error || event.response?.ok === false || serverReportedError);
      const details = ["click", "radio"].includes(event.type) && event.pointer ? `좌표 ${event.pointer.x}, ${event.pointer.y}` : event.type === "input" ? "포커스를 벗어날 때 최종 입력값을 기록" : event.type === "network" && event.response?.error ? `요청 실패 · ${event.response.error}` : event.type === "keydown" && event.code ? event.code : "";
    const title = group.kind === "typing" ? `키 입력 · ${composeHangul(group.text)}` : labelFor(event);
    const groupedDetail = group.kind === "typing" && group.events.length > 1 ? `${group.events.length}개 키 입력을 하나의 문장으로 묶음` : details;
    const networkMeta = event.type === "network" ? `<div class="network-meta"><span>요청 시간<strong>${escapeHtml(formatTime(event.requestedAt || event.timestamp))}</strong></span><span>응답 시간<strong>${event.responseTimeMs == null ? "—" : `${escapeHtml(event.responseTimeMs.toLocaleString("ko-KR"))}ms`}</strong></span></div>` : "";
    const requestInfo = event.type === "network" && (event.reqName || event.desc) ? `<span class="network-request-info"${event.desc ? ` title="${escapeHtml(event.desc)}"` : ""}>${event.reqName ? `<strong>${escapeHtml(event.reqName)}</strong>` : ""}${event.desc ? `<span>${escapeHtml(event.desc)}</span>` : ""}</span>` : "";
    const requestData = event.request?.body?.body ?? null;
    const responseData = responseBody
      ?? event.response?.error
      ?? null;
    let networkData = "";
    if (event.type === "network") {
      const requestDetailId = `network-detail-${++networkDetailSequence}`;
      const responseDetailId = `network-detail-${++networkDetailSequence}`;
      networkDetails.set(requestDetailId, { title: "요청값 전문", value: requestData });
      networkDetails.set(responseDetailId, { title: "응답값 전문", value: responseData });
      networkData = `<div class="network-data"><section><div class="network-data-head"><h3>요청값</h3><button class="detail-button" type="button" data-network-detail="${requestDetailId}">자세히 보기</button></div><pre>${escapeHtml(JSON.stringify(requestData, null, 2))}</pre></section><section><div class="network-data-head"><h3>응답값</h3><button class="detail-button" type="button" data-network-detail="${responseDetailId}">자세히 보기</button></div><pre>${escapeHtml(JSON.stringify(responseData, null, 2))}</pre></section></div>`;
    }
    const targetLine = event.type === "network" ? "" : `<p class="target">${escapeHtml(targetFor(event))}${selector ? ` <code>${escapeHtml(selector)}</code>` : ""}</p>`;
    const networkClass = event.type === "network" ? ` network-event ${networkFailed ? "network-failure" : "network-success"}` : "";
    return `<article class="event${networkClass}"><div class="event-head"><div class="event-title"><span class="event-kind">${iconFor(event)}</span>${escapeHtml(title)}${requestInfo}</div><time>${escapeHtml(formatTime(event.timestamp))}</time></div>${targetLine}${groupedDetail ? `<p class="detail">${escapeHtml(groupedDetail)}</p>` : ""}${networkMeta}${networkData}</article>`;
    }).join("");
    const startedAt = block.events[0]?.timestamp;
    const endedAt = blocks[index + 1]?.events[0]?.timestamp || block.events.at(-1)?.timestamp;
    const dwellTime = formatDuration(new Date(endedAt) - new Date(startedAt));
    return `<details class="journey-block" id="journey-block-${index}" open><summary class="block-head"><div class="block-title"><span class="block-index">${String(index + 1).padStart(2, "0")}</span><span class="state-name">${escapeHtml(block.state)}</span></div><span class="block-times"><span>처음 접근 <strong>${escapeHtml(formatTime(startedAt))}</strong></span><span>머문 시간 <strong>${escapeHtml(dwellTime)}</strong></span></span></summary><div class="event-list">${eventCards}</div></details>`;
  }).join("") : '<div class="empty">기록된 행동이 없습니다.</div>';
}
function renderTestEnvironment(environment) {
  const items = $("#environment-items");
  const note = $("#environment-note");
  items.replaceChildren();
  const values = environment ? [
    ["기기", environment.deviceLabel || "알 수 없음"],
    ["브라우저", `${environment.browser?.name || "알 수 없음"}${environment.browser?.version ? ` ${environment.browser.version}` : ""}`],
    ["OS", environment.os || environment.platform || "알 수 없음"],
    ["뷰포트", environment.viewport ? `${environment.viewport.width} × ${environment.viewport.height}` : "알 수 없음"],
    ["화면", environment.screen ? `${environment.screen.width} × ${environment.screen.height}` : "알 수 없음"],
    ["배율", environment.devicePixelRatio ? `${environment.devicePixelRatio}x` : "알 수 없음"],
    ["터치", `${environment.touchPoints ?? 0} point`],
  ] : [["환경", "기록 정보 없음"]];
  values.forEach(([label, value]) => {
    const item = document.createElement("span");
    const strong = document.createElement("strong");
    item.className = "environment-item";
    strong.textContent = value;
    item.append(label, strong);
    items.append(item);
  });
  items.title = environment?.userAgent || "";
  note.textContent = environment?.detectionNote || (environment ? "" : "이전 버전 JSON에는 테스트 환경 정보가 포함되어 있지 않습니다.");
  note.classList.toggle("hidden", !note.textContent);
}
function render(data, filename) {
  states = data.eventsByState;
  const serverStatus = data.serverStatus || {};
  $("#current-stage").textContent = serverStatus.currentStage || "—";
  $("#current-was").textContent = serverStatus.currentWas || "—";
  $("#server-status").classList.toggle("hidden", !serverStatus.currentStage && !serverStatus.currentWas);
  const allEvents = Object.values(states).flat().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const first = allEvents[0]?.timestamp, last = allEvents.at(-1)?.timestamp;
  $("#file-name").textContent = filename;
  $("#event-count").textContent = allEvents.length.toLocaleString("ko-KR");
  $("#duration").textContent = formatDuration(new Date(last) - new Date(first));
  $("#journey-meta").textContent = data.exportedAt ? `내보낸 시각 ${new Date(data.exportedAt).toLocaleString("ko-KR")}` : "불러온 기록";
  renderTestEnvironment(data.testEnvironment);
  uploadScreen.classList.add("hidden"); viewer.classList.remove("hidden"); renderTimeline();
}
function showError(message) { error.textContent = message; error.classList.remove("hidden"); }
async function decryptInputValues(data) {
  const events = Object.values(data.eventsByState).flat();
  await Promise.all(events.map(async (event) => {
    if (event.type === "input" && isEncryptedText(event.value)) event.value = await decryptText(event.value);
  }));
  return data;
}
function loadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".json") && file.type !== "application/json") return showError("JSON 파일만 열 수 있습니다.");
  const reader = new FileReader();
  reader.onload = async () => { try { const data = JSON.parse(reader.result); if (!data || typeof data.eventsByState !== "object" || Array.isArray(data.eventsByState)) throw new Error(); await decryptInputValues(data); error.classList.add("hidden"); render(data, file.name); } catch { showError("파일 형식이 올바르지 않거나 입력값을 복호화할 수 없습니다."); } };
  reader.readAsText(file);
}
$("#select-button").addEventListener("click", () => input.click());
input.addEventListener("change", () => loadFile(input.files[0]));
$("#new-file").addEventListener("click", () => { viewer.classList.add("hidden"); uploadScreen.classList.remove("hidden"); input.value = ""; });
$("#state-stepper").addEventListener("click", (event) => {
  const button = event.target.closest("[data-step-index]");
  if (!button) return;
  const block = $(`#journey-block-${button.dataset.stepIndex}`);
  if (!block) return;
  block.open = true;
  $("#state-stepper").querySelectorAll(".state-step").forEach((step) => {
    const selected = step === button;
    step.classList.toggle("is-current", selected);
    if (selected) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  const stepper = $("#state-stepper");
  const targetTop = window.scrollY + block.getBoundingClientRect().top - stepper.getBoundingClientRect().height - 18;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
});
["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
const detailDialog = $("#detail-dialog");
const detailContent = $("#detail-dialog-content");
const detailSearch = $("#detail-search");
const detailSearchCount = $("#detail-search-count");
const detailSearchFirst = $("#detail-search-first");
const detailSearchPrev = $("#detail-search-prev");
const detailSearchNext = $("#detail-search-next");

function selectDetailMatch(index, scroll = true) {
  detailMatches.forEach((mark) => mark.classList.remove("active-match"));
  if (!detailMatches.length) {
    currentDetailMatch = -1;
    detailSearchCount.textContent = "0 / 0";
    detailSearchFirst.disabled = true;
    detailSearchPrev.disabled = true;
    detailSearchNext.disabled = true;
    return;
  }
  currentDetailMatch = (index + detailMatches.length) % detailMatches.length;
  const active = detailMatches[currentDetailMatch];
  active.classList.add("active-match");
  detailSearchCount.textContent = `${currentDetailMatch + 1} / ${detailMatches.length}`;
  detailSearchFirst.disabled = false;
  detailSearchPrev.disabled = false;
  detailSearchNext.disabled = false;
  if (scroll) active.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderDetailSearch() {
  const query = detailSearch.value;
  detailContent.replaceChildren();
  detailMatches = [];
  if (!query) {
    detailContent.textContent = detailRawText;
    selectDetailMatch(-1, false);
    return;
  }
  const source = detailCaseSensitive ? detailRawText : detailRawText.toLocaleLowerCase();
  const keyword = detailCaseSensitive ? query : query.toLocaleLowerCase();
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  while (cursor < detailRawText.length) {
    const matchIndex = source.indexOf(keyword, cursor);
    if (matchIndex === -1) break;
    fragment.append(document.createTextNode(detailRawText.slice(cursor, matchIndex)));
    const mark = document.createElement("mark");
    mark.textContent = detailRawText.slice(matchIndex, matchIndex + query.length);
    detailMatches.push(mark);
    fragment.append(mark);
    cursor = matchIndex + query.length;
  }
  fragment.append(document.createTextNode(detailRawText.slice(cursor)));
  detailContent.append(fragment);
  selectDetailMatch(0);
}

async function copyDetailText() {
  const copyButton = $("#detail-copy");
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(detailRawText); copied = true; } catch {}
    }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = detailRawText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try { copied = document.execCommand("copy"); } finally { textarea.remove(); }
    }
    if (!copied) throw new Error("copy failed");
    copyButton.textContent = "복사 완료";
  } catch {
    copyButton.textContent = "복사 실패";
  }
  setTimeout(() => { copyButton.textContent = "클립보드 복사"; }, 1400);
}

$("#timeline").addEventListener("click", (event) => {
  const button = event.target.closest("[data-network-detail]");
  if (!button) return;
  const detail = networkDetails.get(button.dataset.networkDetail);
  if (!detail) return;
  $("#detail-dialog-title").textContent = detail.title;
  detailRawText = JSON.stringify(detail.value, null, 2) ?? "";
  detailSearch.value = "";
  renderDetailSearch();
  detailDialog.showModal();
  detailSearch.focus();
});
detailSearch.addEventListener("input", renderDetailSearch);
$("#detail-case-sensitive").addEventListener("click", (event) => {
  detailCaseSensitive = !detailCaseSensitive;
  event.currentTarget.setAttribute("aria-pressed", String(detailCaseSensitive));
  renderDetailSearch();
});
detailSearchFirst.addEventListener("click", () => selectDetailMatch(0));
detailSearchPrev.addEventListener("click", () => selectDetailMatch(currentDetailMatch - 1));
detailSearchNext.addEventListener("click", () => selectDetailMatch(currentDetailMatch + 1));
detailSearch.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  selectDetailMatch(currentDetailMatch + (event.shiftKey ? -1 : 1));
});
$("#detail-copy").addEventListener("click", copyDetailText);
$("#detail-dialog-close").addEventListener("click", () => detailDialog.close());
detailDialog.addEventListener("click", (event) => {
  if (event.target === detailDialog) detailDialog.close();
});

const utility = $("#utility");
const utilityMain = $("#utility-main");
const compareDialog = $("#compare-dialog");
const compareLeft = $("#compare-left");
const compareRight = $("#compare-right");

function setUtilityOpen(open) {
  utility.classList.toggle("open", open);
  utilityMain.setAttribute("aria-expanded", String(open));
}

function alignDifferentLines(left, right) {
  const normalizedLeft = left.replace(/\r\n/g, "\n");
  const normalizedRight = right.replace(/\r\n/g, "\n");
  const leftLines = normalizedLeft === "" ? [] : normalizedLeft.split("\n");
  const rightLines = normalizedRight === "" ? [] : normalizedRight.split("\n");
  if (leftLines.length > 1500 || rightLines.length > 1500) {
    return Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, index) => ({
      left: index < leftLines.length ? { number: index + 1, text: leftLines[index] } : null,
      right: index < rightLines.length ? { number: index + 1, text: rightLines[index] } : null,
      changed: leftLines[index] !== rightLines[index],
    }));
  }
  const matrix = Array.from({ length: leftLines.length + 1 }, () => new Uint32Array(rightLines.length + 1));
  for (let leftIndex = leftLines.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightLines.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex][rightIndex] = leftLines[leftIndex] === rightLines[rightIndex]
        ? matrix[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
    }
  }
  const rows = [];
  let leftIndex = 0, rightIndex = 0;
  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    if (leftIndex < leftLines.length && rightIndex < rightLines.length && leftLines[leftIndex] === rightLines[rightIndex]) {
      rows.push({ left: { number: leftIndex + 1, text: leftLines[leftIndex] }, right: { number: rightIndex + 1, text: rightLines[rightIndex] }, changed: false });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    const removed = [], added = [];
    while ((leftIndex < leftLines.length || rightIndex < rightLines.length) && !(leftIndex < leftLines.length && rightIndex < rightLines.length && leftLines[leftIndex] === rightLines[rightIndex])) {
      if (leftIndex < leftLines.length && (rightIndex >= rightLines.length || matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1])) {
        removed.push({ number: leftIndex + 1, text: leftLines[leftIndex++] });
      } else {
        added.push({ number: rightIndex + 1, text: rightLines[rightIndex++] });
      }
    }
    for (let index = 0; index < Math.max(removed.length, added.length); index += 1) rows.push({ left: removed[index] || null, right: added[index] || null, changed: true });
  }
  return rows;
}

function createDiffCell(line, changeClass) {
  const cell = document.createElement("div");
  cell.className = `diff-cell ${line ? changeClass : "empty"}`.trim();
  const number = document.createElement("span");
  number.className = "diff-line-number";
  number.textContent = line?.number ?? "";
  const text = document.createElement("span");
  text.className = "diff-line-text";
  text.textContent = line?.text ?? "";
  cell.append(number, text);
  return cell;
}

function renderTextDiff(left, right) {
  const rows = alignDifferentLines(left, right);
  const diffView = $("#compare-diff");
  const leftContainer = $("#compare-diff-left-rows");
  const rightContainer = $("#compare-diff-right-rows");
  const minimap = $("#compare-minimap");
  const viewport = $("#minimap-viewport");
  const leftFragment = document.createDocumentFragment();
  const rightFragment = document.createDocumentFragment();
  const minimapFragment = document.createDocumentFragment();
  let changedCount = 0;
  diffView.classList.toggle("left-empty", left === "");
  diffView.classList.toggle("right-empty", right === "");
  minimapFragment.append(viewport);
  rows.forEach((item, index) => {
    const leftRow = document.createElement("div");
    const rightRow = document.createElement("div");
    leftRow.className = "diff-row";
    rightRow.className = "diff-row";
    if (item.changed) {
      changedCount += 1;
      const marker = document.createElement("button");
      marker.className = "minimap-marker";
      marker.type = "button";
      marker.title = `${index + 1}번째 비교 라인으로 이동`;
      marker.setAttribute("aria-label", marker.title);
      marker.style.top = `${((index + 0.5) / rows.length) * 100}%`;
      marker.addEventListener("pointerdown", (event) => event.stopPropagation());
      marker.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const leftScroll = $("#compare-diff-left-scroll");
        const rightScroll = $("#compare-diff-right-scroll");
        scrollDiffRowIntoView(leftScroll, leftRow);
        scrollDiffRowIntoView(rightScroll, rightRow);
      });
      minimapFragment.append(marker);
    }
    leftRow.append(createDiffCell(item.left, item.changed ? "removed" : ""));
    rightRow.append(createDiffCell(item.right, item.changed ? "added" : ""));
    leftFragment.append(leftRow);
    rightFragment.append(rightRow);
  });
  leftContainer.replaceChildren(leftFragment);
  rightContainer.replaceChildren(rightFragment);
  minimap.replaceChildren(minimapFragment);
  diffView.classList.remove("hidden");
  $("#compare-resizer").classList.remove("hidden");
  requestAnimationFrame(updateMinimapViewport);
  return changedCount;
}

function scrollDiffRowIntoView(scroll, row) {
  const rowRect = row.getBoundingClientRect();
  const scrollRect = scroll.getBoundingClientRect();
  const rowTopInsideScroll = scroll.scrollTop + rowRect.top - scrollRect.top;
  const targetTop = rowTopInsideScroll - (scroll.clientHeight - rowRect.height) / 2;
  scroll.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

let activeDiffScroll = $("#compare-diff-left-scroll");
function updateMinimapViewport(scroll = activeDiffScroll) {
  const viewport = $("#minimap-viewport");
  if (!scroll.scrollHeight) return;
  viewport.style.top = `${(scroll.scrollTop / scroll.scrollHeight) * 100}%`;
  viewport.style.height = `${Math.min(100, (scroll.clientHeight / scroll.scrollHeight) * 100)}%`;
}

utilityMain.addEventListener("click", () => setUtilityOpen(!utility.classList.contains("open")));
$("#open-compare").addEventListener("click", () => {
  setUtilityOpen(false);
  compareDialog.showModal();
  compareLeft.focus();
});
$("#compare-run").addEventListener("click", () => {
  const result = $("#compare-result");
  const changedCount = renderTextDiff(compareLeft.value, compareRight.value);
  if (changedCount) {
    const count = document.createElement("strong");
    count.textContent = `${changedCount.toLocaleString("ko-KR")}개`;
    result.replaceChildren(count, "의 변경 라인이 있습니다.");
  } else result.textContent = "두 텍스트가 같습니다.";
});
[compareLeft, compareRight].forEach((editor) => editor.addEventListener("input", () => {
  $("#compare-diff").classList.add("hidden");
  $("#compare-resizer").classList.add("hidden");
  $("#compare-result").textContent = "내용이 변경되었습니다. 다시 비교해 주세요.";
}));
[["#compare-left-clear", compareLeft], ["#compare-right-clear", compareRight]].forEach(([selector, editor]) => {
  $(selector).addEventListener("click", () => {
    editor.value = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
  });
});
[$("#compare-diff-left-scroll"), $("#compare-diff-right-scroll")].forEach((scroll) => scroll.addEventListener("scroll", () => {
  activeDiffScroll = scroll;
  updateMinimapViewport(scroll);
}, { passive: true }));
$("#compare-minimap").addEventListener("click", (event) => {
  if (event.target !== event.currentTarget) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  [$("#compare-diff-left-scroll"), $("#compare-diff-right-scroll")].forEach((scroll) => scroll.scrollTo({ top: ratio * Math.max(0, scroll.scrollHeight - scroll.clientHeight), behavior: "smooth" }));
});
const minimapViewport = $("#minimap-viewport");
let minimapDragOffset = 0;

function dragMinimapViewport(clientY) {
  const minimap = $("#compare-minimap");
  const rect = minimap.getBoundingClientRect();
  const availableHeight = Math.max(1, rect.height - minimapViewport.offsetHeight);
  const viewportTop = Math.max(0, Math.min(availableHeight, clientY - rect.top - minimapDragOffset));
  const ratio = viewportTop / availableHeight;
  [$("#compare-diff-left-scroll"), $("#compare-diff-right-scroll")].forEach((scroll) => { scroll.scrollTop = ratio * Math.max(0, scroll.scrollHeight - scroll.clientHeight); });
}

minimapViewport.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  minimapDragOffset = event.clientY - minimapViewport.getBoundingClientRect().top;
  minimapViewport.classList.add("dragging");
  minimapViewport.setPointerCapture(event.pointerId);
});
minimapViewport.addEventListener("pointermove", (event) => {
  if (!minimapViewport.hasPointerCapture(event.pointerId)) return;
  dragMinimapViewport(event.clientY);
});
["pointerup", "pointercancel"].forEach((type) => minimapViewport.addEventListener(type, (event) => {
  if (minimapViewport.hasPointerCapture(event.pointerId)) minimapViewport.releasePointerCapture(event.pointerId);
  minimapViewport.classList.remove("dragging");
}));
const compareResizer = $("#compare-resizer");
let compareResizeStartY = 0;
let compareEditorStartHeight = 0;
let compareDiffStartHeight = 0;

compareResizer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  compareResizeStartY = event.clientY;
  compareEditorStartHeight = compareLeft.getBoundingClientRect().height;
  compareDiffStartHeight = $("#compare-diff").getBoundingClientRect().height;
  compareResizer.classList.add("dragging");
  compareResizer.setPointerCapture(event.pointerId);
});
compareResizer.addEventListener("pointermove", (event) => {
  if (!compareResizer.hasPointerCapture(event.pointerId)) return;
  const totalHeight = compareEditorStartHeight + compareDiffStartHeight;
  const editorHeight = Math.max(140, Math.min(totalHeight - 160, compareEditorStartHeight + event.clientY - compareResizeStartY));
  $(".compare-body").style.setProperty("--editor-height", `${editorHeight}px`);
  $(".compare-body").style.setProperty("--diff-height", `${totalHeight - editorHeight}px`);
  updateMinimapViewport();
});
["pointerup", "pointercancel"].forEach((type) => compareResizer.addEventListener(type, (event) => {
  if (compareResizer.hasPointerCapture(event.pointerId)) compareResizer.releasePointerCapture(event.pointerId);
  compareResizer.classList.remove("dragging");
}));
$("#compare-close").addEventListener("click", () => compareDialog.close());
compareDialog.addEventListener("click", (event) => { if (event.target === compareDialog) compareDialog.close(); });

// ClearForm client — holds all state (conversation + form values) in the page.
// Nothing is persisted; refresh = clean slate. The server is a stateless proxy.

const $ = (id) => document.getElementById(id);
const log = $("log"), status = $("status"), input = $("input"),
  sendBtn = $("send"), micBtn = $("mic"), composer = $("composer"),
  fieldsEl = $("fields"), progressEl = $("progress"), doneBanner = $("done-banner");

// The opening turn is sent automatically so the assistant speaks first.
// It stays in the API history but is not shown in the chat log.
const KICKOFF = "Hello, I would like help with this application.";

let form = null;               // loaded from form.json
let messages = [];             // full API history: {role, content(string)}
let values = {};               // field id -> value
let busy = false;

/* ---------- rendering (textContent only — never inject HTML) ---------- */

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.className = isError ? "status error" : "status";
}

function renderFields() {
  fieldsEl.textContent = "";
  let filled = 0;
  for (const f of form.fields) {
    const has = values[f.id] !== undefined;
    if (has) filled++;
    const wrap = document.createElement("div");
    wrap.className = has ? "field filled" : "field";
    const dt = document.createElement("dt");
    dt.textContent = f.label;
    const hint = document.createElement("span");
    hint.className = "plain-hint";
    hint.textContent = f.plain;
    dt.appendChild(hint);
    const dd = document.createElement("dd");
    dd.className = has ? "" : "empty";
    dd.textContent = has ? values[f.id] : "not filled yet";
    wrap.append(dt, dd);
    fieldsEl.appendChild(wrap);
  }
  progressEl.textContent = `${filled} of ${form.fields.length} answers filled`;
}

function setBusy(b) {
  busy = b;
  sendBtn.disabled = b;
  micBtn.disabled = b;
  log.setAttribute("aria-busy", String(b));
}

/* ---------- voice output ---------- */

function speak(text) {
  if (!$("voice-out").checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.95; // slightly slower than default — easier to follow
  speechSynthesis.speak(u);
}

/* ---------- voice input (Chrome/Edge; typing always works everywhere) ---------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SR) {
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript.trim();
    if (transcript) send(transcript);
  };
  recognition.onend = () => micBtn.classList.remove("listening");
  recognition.onerror = (e) => {
    micBtn.classList.remove("listening");
    if (e.error === "not-allowed")
      setStatus("Microphone blocked. Allow it in your browser, or just type instead.", true);
    else if (e.error !== "aborted")
      setStatus("I could not hear that. Try again, or type instead.", true);
  };
  micBtn.addEventListener("click", () => {
    if (micBtn.classList.contains("listening")) { recognition.stop(); return; }
    speechSynthesis?.cancel(); // don't let our own voice feed the mic
    setStatus("Listening… speak your answer.");
    micBtn.classList.add("listening");
    recognition.start();
  });
} else {
  micBtn.hidden = true;
  setStatus("Voice input needs Chrome or Edge. Typing works fine here.");
}

/* ---------- conversation ---------- */

async function send(text) {
  if (busy || !form) return;
  setStatus("");
  const shown = text !== KICKOFF;
  if (shown) addBubble("user", text);
  messages.push({ role: "user", content: text });
  input.value = "";
  setBusy(true);
  const thinkingBubble = addBubble("assistant thinking", "…");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);

    // Keep the assistant's raw JSON in history so the model sees its own state.
    messages.push({ role: "assistant", content: JSON.stringify(data) });

    for (const u of data.updates || []) values[u.field] = u.value;
    renderFields();

    thinkingBubble.remove();
    addBubble("assistant", data.say);
    speak(data.say);

    if (data.done) {
      doneBanner.hidden = false;
      progressEl.textContent = "Form complete — ready to print";
    }
  } catch (err) {
    // Roll back the failed turn so pressing Send retries the same answer.
    messages.pop();
    thinkingBubble.remove();
    if (shown) { log.lastElementChild?.remove(); input.value = text; }
    setStatus(`${err.message} Press Send to try again.`, true);
  } finally {
    setBusy(false);
    input.focus();
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) send(text);
});

/* ---------- accessibility controls ---------- */

$("text-size").addEventListener("click", () => {
  const html = document.documentElement;
  if (html.classList.contains("size-xl")) html.classList.remove("size-lg", "size-xl");
  else if (html.classList.contains("size-lg")) html.classList.add("size-xl");
  else html.classList.add("size-lg");
});

$("print").addEventListener("click", () => window.print());

/* ---------- boot ---------- */

(async function init() {
  try {
    form = await (await fetch("form.json")).json();
    $("form-title").textContent = `Form ${form.form_code} — ${form.title}`;
    $("notice-text").textContent = form.official_notice;
    renderFields();
    send(KICKOFF); // assistant greets and explains the form first
  } catch {
    setStatus("Could not load the form definition. Is the server running?", true);
  }
})();

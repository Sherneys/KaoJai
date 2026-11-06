# ClearForm

**Group 03 — AI for Public Service & Accessibility** · Chula x UM Student Mobility Program 2026

An AI assistant that makes one piece of real bureaucracy — the *Student Exchange Mobility Grant Application* — accessible to everyone. It translates the official notice into plain speech, guides the user one simple question at a time (by voice or typing), and fills the official form live on screen.

## The three capabilities from the brief, in one flow

| Brief requirement | Where it appears |
|---|---|
| Translate bureaucratic language into plain speech | The assistant's opening turn explains the official notice simply; the hard-to-read original is one click away for comparison |
| Guide users step-by-step, with voice support | One question per turn, spoken aloud (toggleable) and answerable by microphone |
| Help fill out forms | Answers populate the official form fields live; finished form is printable |

## How the constraints are handled

- **Universal design** — large type with a text-size control, high contrast, 48px touch targets, full keyboard support, visible focus, `aria-live` conversation log, reduced-motion support, voice in *and* out, typing always available as fallback.
- **Reliability of official information** — the assistant is grounded on the embedded official notice only; it is instructed never to invent rules and to redirect unknown questions to the office contact.
- **Identity verification & privacy** — asks only what the form requires, refuses volunteered sensitive data, stores nothing (state lives in the page; refresh wipes it), submits nothing. The API key stays server-side.

## Run it

```bash
npm install
# put your free key (from aistudio.google.com → Get API key) in .env:
#   GEMINI_API_KEY=...
npm start                              # → http://localhost:3000
```

Voice input needs Chrome or Edge (Web Speech API). Everything else works in any modern browser.

## Architecture

```
Browser (vanilla HTML/JS)          Node/Express              Gemini API (free tier)
┌───────────────────────┐   POST /api/chat   ┌──────────┐
│ chat UI + voice I/O   │ ─────────────────► │ stateless│ ──► gemini-2.5-flash
│ form state (in page)  │ ◄───────────────── │  proxy   │     structured JSON output
└───────────────────────┘  {say,updates,done}└──────────┘     {say, updates, done}
```

Structured output guarantees every model turn separates *what to say* (spoken/shown) from *which fields to fill* (rendered into the form) — no fragile text parsing.

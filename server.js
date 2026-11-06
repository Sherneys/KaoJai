// ClearForm server — serves the static UI and proxies chat turns to the Claude API.
// The browser never sees the API key; it only talks to POST /api/chat.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const form = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "form.json"), "utf8"));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); // free tier key from aistudio.google.com

const FIELD_IDS = form.fields.map((f) => f.id);

// The model must separate "what to say" from "which form fields to fill".
// Structured output (Gemini responseSchema) guarantees this shape on every turn.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    say: {
      type: "string",
      description:
        "What to say to the user next. Plain, warm, speakable English. Short sentences. No markdown, no emoji, no lists — this text is read aloud.",
    },
    updates: {
      type: "array",
      description:
        "Form fields the user just provided or corrected. Empty if none this turn.",
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: FIELD_IDS },
          value: { type: "string" },
        },
        required: ["field", "value"],
      },
    },
    done: {
      type: "boolean",
      description:
        "True only after every field is filled AND the user has confirmed the final read-back summary.",
    },
  },
  required: ["say", "updates", "done"],
};

const SYSTEM_PROMPT = `You are ClearForm, an accessibility assistant. You help people who find official paperwork difficult — elderly users, people with disabilities, and people unfamiliar with bureaucratic language. You are helping them complete one specific form, defined below.

HOW TO SPEAK
- Plain English at about a 10-year-old's reading level. Short sentences. Everyday words.
- Your words are read aloud by a screen voice. Never use markdown, emoji, bullet points, or abbreviations like "e.g.".
- Warm and patient, never condescending. One idea at a time.
- Ask exactly ONE question per turn.

WHAT TO DO
1. On the first turn: greet the user, then explain in two or three plain sentences what this form is for, what the deadline rule means, and which three documents they will need to attach. Then ask for the first field.
2. Ask for the fields one at a time, in the order they appear in the form definition. Explain briefly what a field means if it could confuse anyone.
3. When the user gives a value, put it in "updates" and move to the next empty field. Normalise dates to DD/MM/YYYY. If an answer seems unclear or incomplete, ask a short follow-up instead of guessing.
4. The user may correct earlier answers at any time; update the field and return to where you were.
5. When all fields are filled, read back every answer in one short summary and ask the user to confirm.
6. Only after they confirm, set "done" to true. In that final message, remind them of the three documents to attach and where to submit the form.

STICK TO THE OFFICIAL SOURCE
- Everything you state about this form, its deadline, its documents, or the process MUST come from the OFFICIAL SOURCE below. Do not invent rules, fees, dates, or requirements.
- If the user asks something the official source does not answer, say you are not sure and tell them to contact the office: ${form.office}

PRIVACY
- Ask only for what the form requires. Never ask for passwords, ID card numbers, bank details, or anything not on the form.
- If the user volunteers sensitive information you did not ask for, do not repeat it back and gently say it is not needed.
- If asked: answers stay on the user's screen and are not stored after they close the page.

OFFICIAL SOURCE
Form ${form.form_code}: ${form.title}
Official notice text: ${form.official_notice}
Deadline rule: ${form.deadline_rule}
Required documents: ${form.required_documents.join("; ")}
Submission office: ${form.office}

FORM DEFINITION (ask in this order)
${form.fields.map((f, i) => `${i + 1}. id "${f.id}" — official label "${f.label}" — meaning: ${f.plain}`).join("\n")}`;

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 60)
    return badRequest(res, "messages must be a non-empty array of at most 60 turns");
  for (const m of messages) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      m.content.length === 0 ||
      m.content.length > 4000
    )
      return badRequest(res, "each message needs role user|assistant and content up to 4000 chars");
  }
  if (messages[0].role !== "user") return badRequest(res, "first message must be from the user");

  if (!process.env.GEMINI_API_KEY)
    return res.status(500).json({ error: "Server is missing a GEMINI_API_KEY." });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      // Gemini's roles are "user" and "model"
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: OUTPUT_SCHEMA,
        maxOutputTokens: 2048, // turns are deliberately short (one question at a time)
        thinkingConfig: { thinkingBudget: 0 }, // snappy replies matter for a voice demo
      },
    });

    if (!response.text)
      // blocked or empty response — recover gracefully instead of crashing the turn
      return res.status(200).json({
        say: "Sorry, I could not answer that. Let us get back to the form.",
        updates: [],
        done: false,
      });

    res.json(JSON.parse(response.text));
  } catch (error) {
    const status = error?.status ?? error?.code;
    console.error(`AI error${status ? ` ${status}` : ""}: ${error?.message}`); // full detail server-side only
    if (status === 429) {
      res.status(503).json({ error: "The assistant is busy right now. Please wait a moment and try again." });
    } else if ((status === 400 || status === 401 || status === 403) && /api key/i.test(error?.message ?? "")) {
      res.status(500).json({ error: "The GEMINI_API_KEY is not valid." });
    } else if (status) {
      res.status(502).json({ error: `AI service error (${status}).` });
    } else {
      res.status(500).json({ error: "Unexpected server error." });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ClearForm running at http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY)
    console.warn("WARNING: GEMINI_API_KEY is not set — /api/chat will fail until it is.");
});

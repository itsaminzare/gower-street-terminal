// Copyright (c) 2026 Mohammadamin Zare, University College London. All rights reserved. See LICENSE.
// Google Gemini connector (Gemini API, generateContent / streamGenerateContent over REST).
// Used when AI_PROVIDER=gemini; the prompts, schemas, maths and risk checks are the same as for Claude.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function body({ system, messages, maxTokens, schema }) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    // Gemini roles are "user" and "model"
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] })),
    generationConfig: { maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}) },
  };
}

async function post(url, key, payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload) });
    if (!r.ok) {
      const err = await r.text();
      throw Object.assign(new Error(`Gemini HTTP ${r.status}: ${err.slice(0, 300)}`), { status: r.status, body: err });
    }
    return r;
  } finally { clearTimeout(t); }
}

const textOf = (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
function checkFinish(j) {
  const c = j.candidates?.[0];
  if (!c) throw new Error(`Gemini returned no answer${j.promptFeedback?.blockReason ? ` (blocked: ${j.promptFeedback.blockReason})` : ""}`);
  if (c.finishReason === "MAX_TOKENS") throw new Error("Output was cut off (max tokens)");
  if (c.finishReason && !["STOP", "MAX_TOKENS"].includes(c.finishReason) && !textOf(j)) throw new Error(`Gemini stopped: ${c.finishReason}`);
}

/** One JSON answer constrained by `schema`. Returns {data, model}. */
export async function geminiStructured({ key, model, system, user, schema, maxTokens = 16000 }) {
  const messages = [{ role: "user", content: user }];
  let r;
  try {
    r = await post(`${BASE}/${model}:generateContent`, key, body({ system, messages, maxTokens, schema }));
  } catch (e) {
    // Older API versions don't take a full JSON Schema: fall back to JSON mode with the schema in the instructions
    if (e.status !== 400 || !/schema/i.test(e.body || "")) throw e;
    r = await post(`${BASE}/${model}:generateContent`, key, {
      ...body({ system: `${system}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`, messages, maxTokens }),
      generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    });
  }
  const j = await r.json();
  checkFinish(j);
  return { data: JSON.parse(textOf(j)), model: j.modelVersion || model };
}

/** Streamed text answer; calls onText(delta) as it arrives. Returns {text, model}. */
export async function geminiStream({ key, model, system, messages, maxTokens = 8000, onText }) {
  const r = await post(`${BASE}/${model}:streamGenerateContent?alt=sse`, key, body({ system, messages, maxTokens }));
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", full = "", version = model;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
      const t = textOf(j);
      if (t) { full += t; onText?.(t); }
      if (j.modelVersion) version = j.modelVersion;
    }
  }
  if (!full) throw new Error("Gemini returned an empty answer");
  return { text: full, model: version };
}

#!/usr/bin/env node
// lex_guard.js — 선호 진단에서 고른 용어를 실제로 지키게 하는 Claude Code 훅. apply.js --install-guard가 ~/.claude/hooks에 복사한다.
//   UserPromptSubmit  질문마다 바꿔 쓸 말 목록을 짧게 일러 준다(쓰기 전에 막는 단계)
//   PreToolUse        글 파일(.md·.txt 등)에 막기로 한 말을 쓰려 하면 쓰지 않고(exit 2) 바꿀 말을 알려 준다. Claude가 고쳐서 다시 쓴다
//   Stop              방금 채팅 답에 막기로 한 말이 있으면 한 번 되돌려 그 말만 바꿔 다시 쓰게 한다(stop_hook_active면 다시 막지 않는다)
// 규칙: 이 파일 옆의 pref_lexicon.json(또는 환경 변수 PREF_LEXICON). PREF_LEX_OFF=1이면 아무것도 하지 않는다.
// 인용("…", '…', 「…」), 코드(`…`, ```…```), 링크, '>' 인용 줄은 검사하지 않는다. 훅이 잘못돼도 세션을 막지 않도록 오류는 조용히 넘긴다.
"use strict";
const fs = require("fs");
const path = require("path");

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// 꼴 하나 → 정규식. 보통은 낱말이 시작하는 곳에서만 찾고(앞에 한글·영숫자가 없을 때), '~'로 시작하면 앞말에 붙여 찾는다
function formRe(f) {
  const glued = f.startsWith("~");
  const body = escRe(glued ? f.slice(1) : f).replace(/\s+/g, "\\s+");
  return new RegExp((glued ? "" : "(?<![가-힣A-Za-z0-9])") + body, "i");
}
function strip(t) {
  return String(t || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/"[^"\n]{0,200}"|“[^”\n]{0,200}”|'[^'\n]{0,200}'|‘[^’\n]{0,200}’|「[^」\n]{0,200}」|『[^』\n]{0,200}』/g, " ");
}
// 글에서 막기로 한 말을 찾는다. 낱말마다 처음 걸린 꼴 하나만 돌려준다
function findHits(text, entries) {
  const t = strip(text), hits = [];
  (entries || []).forEach(e => {
    for (const f of e.forms || []) {
      const m = t.match(formRe(f));
      if (m) { hits.push({ w: e.w, to: e.to || null, hit: m[0] }); break; }
    }
  });
  return hits;
}
function hitLines(hits) {
  return hits.map(h => `- '${h.hit.trim()}'(${h.w}) → ${h.to ? `'${h.to}'` : "다른 말"}`).join("\n");
}
function remindLine(lex) {
  const all = (lex.block || []).concat(lex.soft || []);
  if (!all.length) return "";
  return "[선호 용어] 이 말은 바꿔 쓴다: " + all.map(e => `${e.w}→${e.to || "다른 말"}`).join(", ") +
    ". 인용, 코드, 고유 이름, 사용자의 말을 옮길 때는 그대로 둔다.";
}

// 이번 턴(마지막 사람 질문 뒤)에 AI가 쓴 글
function lastReply(input) {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  let lines;
  try { lines = fs.readFileSync(input.transcript_path, "utf8").split("\n"); } catch (e) { return ""; }
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let o; try { o = JSON.parse(lines[i]); } catch (e) { continue; }
    const c = o.message && o.message.content;
    if (o.type === "user") {
      const tool = Array.isArray(c) && c.some(b => b && b.type === "tool_result");
      if (!tool && !o.isMeta) break;
      continue;
    }
    if (o.type === "assistant" && Array.isArray(c)) c.filter(b => b && b.type === "text").reverse().forEach(b => out.unshift(b.text));
  }
  return out.join("\n");
}
// 글을 쓰는 도구에서 새로 쓰는 글만
function newText(input) {
  const ti = input.tool_input || {};
  if (input.tool_name === "Write") return ti.content || "";
  if (input.tool_name === "Edit") return ti.new_string || "";
  if (input.tool_name === "MultiEdit") return (ti.edits || []).map(e => e.new_string || "").join("\n");
  return "";
}

function loadLex() {
  const p = process.env.PREF_LEXICON || path.join(__dirname, "pref_lexicon.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function run(input, lex) {
  const ev = input.hook_event_name;
  if (ev === "UserPromptSubmit") {
    const line = lex.remind === false ? "" : remindLine(lex);
    return line ? { code: 0, stdout: line } : { code: 0 };
  }
  if (ev === "PreToolUse") {
    const file = String((input.tool_input || {}).file_path || "");
    const exts = lex.exts || [".md", ".markdown", ".txt", ".rst", ".adoc"];
    if (!exts.includes(path.extname(file).toLowerCase())) return { code: 0 };
    if ((lex.skipPaths || []).some(s => file.replace(/\\/g, "/").includes(s))) return { code: 0 };
    const hits = findHits(newText(input), lex.block);
    if (!hits.length) return { code: 0 };
    return { code: 2, stderr: `[선호 용어] 이 글에 쓰지 않기로 한 말이 있어 쓰지 않았습니다. 아래처럼 바꿔 다시 쓰세요. 꼭 그 말이어야 하는 인용·고유 이름이면 따옴표로 감싸세요.\n${hitLines(hits)}` };
  }
  if (ev === "Stop") {
    if (input.stop_hook_active || lex.chat === "off") return { code: 0 };   // 한 턴에 한 번만 되돌린다(끝없이 되풀이하지 않게)
    const hits = findHits(lastReply(input), lex.block);
    if (!hits.length) return { code: 0 };
    if (lex.chat === "warn") return { code: 0, stdout: JSON.stringify({ systemMessage: `[선호 용어] 방금 답에 바꾸기로 한 말이 있습니다.\n${hitLines(hits)}` }) };
    return { code: 0, stdout: JSON.stringify({ decision: "block", reason: `[선호 용어] 방금 답에 쓰지 않기로 한 말이 있습니다.\n${hitLines(hits)}\n같은 답을 이 말만 바꿔 다시 쓰세요. 답이 길면 이 말이 든 문장만 고쳐 다시 보여 주세요. 바꿨다는 설명이나 사과는 붙이지 마세요.` }) };
  }
  return { code: 0 };
}

if (require.main === module) {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", d => { buf += d; });
  process.stdin.on("end", () => {
    let r = { code: 0 };
    try { if (process.env.PREF_LEX_OFF !== "1") r = run(JSON.parse(buf || "{}"), loadLex()); } catch (e) { r = { code: 0 }; }
    if (r.stdout) process.stdout.write(r.stdout + "\n");
    if (r.stderr) process.stderr.write(r.stderr + "\n");
    process.exit(r.code);
  });
} else {
  module.exports = { formRe, strip, findHits, lastReply, remindLine, run };
}

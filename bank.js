// bank.js — 문항 은행을 읽고 결과 코드를 푸는 공용 함수(build·decode·apply가 같이 쓴다).
//   문항 은행 = items.json + deep.json + lex.json(용어 고르기). --bank <폴더>를 주면 그 폴더의 것(AI가 사용자에 맞게 짠 것), 없으면 이 폴더의 기본 문항.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function bankDir(dir) { return dir ? path.resolve(dir) : __dirname; }

function loadBank(dir, itemsPath, deepPath) {
  const d = bankDir(dir);
  const bank = JSON.parse(fs.readFileSync(itemsPath ? path.resolve(itemsPath) : path.join(d, "items.json"), "utf8"));
  bank.deep = JSON.parse(fs.readFileSync(deepPath ? path.resolve(deepPath) : path.join(d, "deep.json"), "utf8"));
  // 용어 고르기는 v1.3에 더했다. 그전에 --init한 폴더에는 lex.json이 없으므로 기본 것을 쓴다
  const lexPath = fs.existsSync(path.join(d, "lex.json")) ? path.join(d, "lex.json") : path.join(__dirname, "lex.json");
  if (fs.existsSync(lexPath)) bank.lex = JSON.parse(fs.readFileSync(lexPath, "utf8"));
  if (!bank.id) bank.id = "default-" + bank.version;
  return bank;
}

function fail(msg) { console.error(msg); process.exit(1); }

function readAnswers(s) {
  if (!s) fail("결과 코드나 답 파일을 주세요.");
  const file = s.trim();   // 경로에는 빈칸이 있을 수 있어 빈칸을 지우기 전에 파일부터 본다
  if (!/^PS[12]\./.test(file) && fs.existsSync(file)) {
    const t = fs.readFileSync(file, "utf8").trim();
    return t.startsWith("PS") ? readAnswers(t) : JSON.parse(t);
  }
  s = file.replace(/\s+/g, "");
  try {
    if (s.startsWith("PS2.")) return JSON.parse(zlib.inflateRawSync(Buffer.from(s.slice(4), "base64")).toString("utf8"));
    if (s.startsWith("PS1.")) return JSON.parse(Buffer.from(s.slice(4), "base64").toString("utf8"));
  } catch (e) {
    fail("결과 코드를 풀지 못했습니다. 복사할 때 앞이나 끝이 잘렸을 수 있습니다. 결과 화면에서 [결과 코드 복사]를 다시 눌러 전체를 붙여 넣어 주세요.");
  }
  if (fs.existsSync(s)) {
    const t = fs.readFileSync(s, "utf8").trim();
    return t.startsWith("PS") ? readAnswers(t) : JSON.parse(t);
  }
  fail("결과 코드(PS1. 또는 PS2.로 시작)도, 있는 파일도 아닙니다.");
}

// 답이 다른 문항 은행으로 만든 설문에서 나왔으면 알린다(채점이 어긋난다). 맞으면 true
function checkMatch(bank, ans) {
  let ok = true;
  const fromBase = bank.base && ans.b === "default-" + bank.base;   // 기본 문항 설문의 답 + 기본 문항을 복사한 폴더
  if (ans.b && ans.b !== bank.id && !fromBase) {
    console.error(`⚠ 이 답은 문항 은행 '${ans.b}'로 만든 설문의 답인데, 지금 읽은 은행은 '${bank.id}'입니다. --bank로 그 설문을 만든 폴더를 주세요.`);
    ok = false;
  }
  const ids = new Set(bank.ab.map(i => i.id).concat(bank.deep.items.map(i => i.id), bank.lex ? bank.lex.items.map(i => i.id) : []));
  const lost = Object.keys(ans.ab || {}).concat(Object.keys(ans.deep || {}), Object.keys(ans.lex || {})).filter(k => !ids.has(k));
  if (lost.length) {
    console.error(`⚠ 답 ${lost.length}개가 지금 읽은 문항 은행에 없어 채점에서 빠집니다(예: ${lost.slice(0, 3).join(", ")}). --bank로 그 설문을 만든 폴더를 주세요.`);
    ok = false;
  }
  return ok;
}

// 1단계 수집(collect.js)이 센 용어 사용 횟수. 그 폴더에 signals.json이 있으면 채점에 쓴다(고른 말이 엇갈릴 때 실제로 쓰는 말을 본다)
function loadUsage(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(bankDir(dir), "signals.json"), "utf8")).lexUsage || null; } catch (e) { return null; }
}

module.exports = { loadBank, readAnswers, checkMatch, bankDir, loadUsage, fail };

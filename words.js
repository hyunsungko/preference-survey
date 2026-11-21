// words.js — 용어 규칙(pref_lexicon.json)의 swap 목록을 점검하고, AI가 만든 제안을 합치고, word-fence mod를 설치한다.
//   node words.js check [--file 경로]                    swap 패턴 오류, 흔한 문장에서 잘못 바뀌는 것, swap이 없는 막을 말의 꼴을 보여 준다
//   node words.js merge <제안.json> [--file 경로] [--write]  제안의 swap을 규칙 파일에 합친 결과를 보여 준다. --write를 줘야 쓴다(백업을 남김)
//   node words.js install [--yes]                          mod를 사용자 범위로 설치하는 명령을 보여 준다. --yes를 줘야 돌린다
//
// swap: [["패턴", "바꿀 말"], ...] — 채팅 답에서 mod가 바꾸는 꼴. block의 말(w)마다 활용형별로 적는다.
//   모든 패턴 앞에 (?<![가-힣])가 붙는다. 앞 글자가 한글이면 맞지 않는다(낱말 가운데를 잡지 않으려고).
//   예: ["활용하다", "쓰다"], ["활용해 ", "써 "], ["활용(?=[을이은에])", "쓰기"]
//   swap에 없는 꼴은 mod가 바꾸지 않고, Stop 훅(lex_guard.js)이 답을 되돌려 다시 쓰게 한다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const cmd = args[0];
const FILE = opt("--file", process.env.PREF_LEXICON || path.join(os.homedir(), ".claude", "hooks", "pref_lexicon.json"));
const MOD = path.join(__dirname, "mod");
const MARKET = "preference-survey";

function compile(swap) {
  const ok = [], bad = [];
  (swap || []).forEach(([p, to]) => {
    try { ok.push({ p, to: to || "", rx: new RegExp(`(?<![가-힣])(?:${p})`, "g") }); }
    catch (e) { bad.push(`${p}  (${e.message})`); }
  });
  return { ok, bad };
}

function readLex(f) {
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function samples() {
  return fs.readFileSync(path.join(MOD, "word-fence", "samples.txt"), "utf8")
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
}

// 흔한 문장을 swap으로 고쳐 보고, 달라지는 문장을 돌려준다
function overMatch(rules, lines) {
  const out = [];
  lines.forEach(s => {
    let t = s;
    rules.filter(r => r.to.trim()).forEach(r => { t = t.replace(r.rx, r.to); });
    if (t !== s) out.push([s, t]);
  });
  return out;
}

// 막을 말(block)의 꼴 가운데 swap 어느 것에도 걸리지 않는 꼴
function uncovered(lex, rules) {
  const out = [];
  (lex.block || []).forEach(e => (e.forms || []).forEach(f => {
    const t = f.replace(/^~/, "가");   // 꼴 끝의 빈 곳도 꼴의 일부다(예: "잰 ")
    if (!rules.some(r => { r.rx.lastIndex = 0; return r.rx.test(t); })) out.push(`${e.w}: ${f.trim()}`);
  }));
  return out;
}

function check(lex) {
  const { ok, bad } = compile(lex.swap);
  const out = [`용어 규칙: ${FILE}`, `- swap ${ok.length}개${bad.length ? `, 오류 ${bad.length}개` : ""}`];
  bad.forEach(b => out.push(`  오류: ${b}`));
  const om = overMatch(ok, samples());
  out.push(`- 흔한 문장 ${samples().length}개 가운데 바뀌는 것 ${om.length}개${om.length ? " — 뜻이 다른데 바뀌면 패턴에 뒤 조건을 붙인다(예: 낱말(?=[을이은에]))" : ""}`);
  om.forEach(([a, b]) => out.push(`  · ${a}  →  ${b}`));
  const un = uncovered(lex, ok);
  out.push(`- swap이 없는 막을 말의 꼴 ${un.length}개${un.length ? " — 채팅에서 mod가 바꾸지 못하고 Stop 훅이 답을 다시 쓰게 한다" : ""}`);
  un.slice(0, 30).forEach(u => out.push(`  · ${u}`));
  out.push(`- 채팅: ${lex.chat === "off" ? "끔" : "켬"}`);
  return { text: out.join("\n"), bad, om, un };
}

function merge(lex, prop) {
  const cur = new Map((lex.swap || []).map(([p, to]) => [p, to]));
  const added = [], changed = [];
  (prop.swap || []).forEach(([p, to]) => {
    if (!cur.has(p)) added.push([p, to]);
    else if (cur.get(p) !== to) changed.push([p, cur.get(p), to]);
    cur.set(p, to);
  });
  return { next: { ...lex, swap: [...cur.entries()] }, added, changed };
}

// Windows는 claude가 .cmd라 셸을 거친다. 빈 곳이 있는 경로는 따옴표로 싸서 한 줄 명령으로 돌린다
function claude(a) {
  return execSync(["claude", ...a.map(x => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x))].join(" "),
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

if (require.main === module) {
  if (cmd === "check") {
    const r = check(readLex(FILE));
    console.log(r.text);
    process.exit(r.bad.length ? 1 : 0);
  } else if (cmd === "merge") {
    const src = args[1];
    if (!src || !fs.existsSync(src)) { console.error("쓰는 법: node words.js merge <제안.json> [--file 경로] [--write]"); process.exit(2); }
    const { next, added, changed } = merge(readLex(FILE), JSON.parse(fs.readFileSync(src, "utf8")));
    console.log(`더할 것 ${added.length}개, 바꿀 것 ${changed.length}개 → ${FILE}`);
    added.forEach(([p, to]) => console.log(`  + ${p} → ${to}`));
    changed.forEach(([p, a, b]) => console.log(`  ~ ${p}: ${a} → ${b}`));
    const r = check(next);
    if (r.bad.length) { console.log(r.text); console.error("패턴 오류가 있어 쓰지 않았습니다."); process.exit(1); }
    console.log(r.text.split("\n").filter(l => !l.startsWith("용어 규칙")).join("\n"));
    if (args.includes("--write")) {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      if (fs.existsSync(FILE)) {
        const bak = `${FILE}.bak-pref-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;
        fs.copyFileSync(FILE, bak);
        console.log(`백업: ${bak}`);
      }
      fs.writeFileSync(FILE, JSON.stringify(next, null, 1) + "\n");
      console.log(`썼습니다: ${FILE} (열려 있는 세션도 다음 답부터 새 목록을 씁니다)`);
    } else console.log("보여 주기만 했습니다. 사용자가 승인하면 --write를 붙여 다시 돌립니다.");
  } else if (cmd === "install") {
    const steps = [["plugin", "marketplace", "add", MOD], ["plugin", "install", `word-fence@${MARKET}`, "--scope", "user"]];
    steps.forEach(s => console.log(`claude ${s.map(x => (/\s/.test(x) ? `"${x}"` : x)).join(" ")}`));
    if (!args.includes("--yes")) { console.log("보여 주기만 했습니다. 사용자가 승인하면 --yes를 붙여 다시 돌립니다."); process.exit(0); }
    try { console.log(claude(steps[0]).trim()); }
    catch (e) { console.log("목록이 이미 있어 새로 고칩니다."); console.log(claude(["plugin", "marketplace", "update", MARKET]).trim()); }
    try { console.log(claude(steps[1]).trim()); }
    catch (e) { console.log(claude(["plugin", "update", `word-fence@${MARKET}`]).trim()); }
    console.log("새로 여는 세션부터 붙습니다. 이미 열린 세션은 다시 켜야 합니다.");
  } else {
    console.log("쓰는 법: node words.js check | merge <제안.json> [--write] | install [--yes]  (모두 --file 경로로 규칙 파일을 바꿀 수 있음)");
  }
}

module.exports = { compile, check, merge, overMatch, uncovered, samples };

// build.js — 문항 은행(items.json·deep.json)을 점검하고, 채점(score.js)과 함께 화면(template.html)에 넣어 혼자 도는 설문 HTML 한 장을 만든다.
//   node build.js                                  기본 문항 → survey.html
//   node build.js --init <폴더>                     기본 문항을 그 폴더에 복사(AI가 사용자에 맞게 고칠 출발점)
//   node build.js --bank <폴더>                     그 폴더의 문항 → <폴더>/survey.html
//   node build.js --bank <폴더> --resume <결과코드|답.json>
//                                                  1차 답을 이어받아 deep.json의 followup 문항만 묻는 추가 설문 → <폴더>/survey_r<차수>.html
//   --items·--deep·--out 으로 파일을 하나씩 지정할 수도 있다.
const fs = require("fs");
const path = require("path");
const B = require("./bank.js");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const CORE = ["length", "order", "autonomy", "format", "report", "emoji", "hedge", "explain", "pushback", "options", "jargon"];
// 한쪽 답에 이모지·"그래서"·"듯합니다"처럼 말이 붙는 축은 길이 방향 규칙에서 뺀다(두 답의 낱말을 같게 쓴다)
const EXEMPT = ["length", "emoji", "order", "hedge"];

const init = opt("--init");
if (init) {
  const d = path.resolve(init);
  fs.mkdirSync(d, { recursive: true });
  ["items.json", "deep.json"].forEach(f => {
    if (fs.existsSync(path.join(d, f))) B.fail(`${path.join(d, f)}가 이미 있습니다. 덮어쓰지 않습니다.`);
  });
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, "items.json"), "utf8"));
  items.id = "p-" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "-" + Math.random().toString(36).slice(2, 6);
  items.base = items.version;
  fs.writeFileSync(path.join(d, "items.json"), JSON.stringify(items, null, 1));
  fs.copyFileSync(path.join(__dirname, "deep.json"), path.join(d, "deep.json"));
  console.log(`복사함: ${d} (문항 은행 id ${items.id}). 설계원칙.md대로 고친 뒤 node build.js --bank "${d}"`);
  process.exit(0);
}

const bankArg = opt("--bank");
const bank = B.loadBank(bankArg, opt("--items"), opt("--deep"));
const resume = opt("--resume");

const problems = [];
const len = s => [...String(s || "")].length;
const exempt = ax => EXEMPT.includes(ax) || !!(bank.axes.find(a => a.id === ax) || {}).exempt;

// 1) 축: 기본 11개는 꼭 둔다(지난 결과와 비교하려고). 사용자에 맞춰 더한 축은 3개까지
CORE.forEach(id => { if (!bank.axes.find(a => a.id === id)) problems.push(`기본 축 ${id}가 없음(지우지 말고 문항 글만 바꾼다)`); });
const extra = bank.axes.filter(a => !CORE.includes(a.id));
if (extra.length > 3) problems.push(`더한 축이 ${extra.length}개(3개까지)`);
bank.axes.forEach(a => ["name", "left", "right", "rule_left", "rule_right", "slider"].forEach(k => { if (!a[k]) problems.push(`축 ${a.id}: ${k} 없음`); }));

// 2) 1차 문항: 축마다 a1·a2·a1r·a3 하나씩, 상황(context)은 3가지 이상
bank.axes.forEach(ax => {
  ["a1", "a2", "a1r", "a3"].forEach(set => {
    const n = bank.ab.filter(i => i.axis === ax.id && i.set === set).length;
    if (n !== 1) problems.push(`${ax.id}: ${set} 문항 ${n}개(1개여야 함)`);
  });
  const ctx = new Set(bank.ab.filter(i => i.axis === ax.id).map(i => i.context));
  if (ctx.size < 3) problems.push(`${ax.id}: 상황(context)이 ${ctx.size}가지(3가지 이상이어야 함 — 한 상황의 취향이 축 전체로 번지지 않게)`);
});
const SUFFIX = { a1: "1", a2: "2", a1r: "1r", a3: "3" };
bank.ab.forEach(i => {
  if (!bank.axes.find(a => a.id === i.axis)) problems.push(`${i.id}: 없는 축 ${i.axis}`);
  if (SUFFIX[i.set] && i.id !== `${i.axis}.${SUFFIX[i.set]}`) problems.push(`${i.id}: 문항 id는 '${i.axis}.${SUFFIX[i.set]}'여야 함(지난 결과와 비교하려고 id를 바꾸지 않는다)`);
  ["id", "axis", "set", "context", "prompt", "left", "right"].forEach(k => { if (!i[k]) problems.push(`${i.id || "(id 없음)"}: ${k} 없음`); });
  if (i.left === i.right) problems.push(`${i.id}: 두 답이 똑같음`);
});
bank.axes.forEach(ax => {
  const a1 = bank.ab.find(i => i.axis === ax.id && i.set === "a1"), r = bank.ab.find(i => i.axis === ax.id && i.set === "a1r");
  if (a1 && r && (a1.prompt === r.prompt || a1.left === r.left || a1.right === r.right || a1.left === r.right || a1.right === r.left))
    problems.push(`${r.id}: a1과 같은 글이 있음(a1r은 같은 축의 다른 문항이어야 함 — 같으면 재검사가 기억 시험이 된다)`);
});

// 3) 길이: 길이 축이 아닌 쌍은 두 답의 글자 수 차이를 평균의 15% 안으로(길이 선호가 다른 축에 섞이지 않게)
function balance(list, label) {
  list.forEach(i => {
    if (i.axis === "length") return;
    const a = len(i.left), b = len(i.right), d = Math.abs(a - b) / ((a + b) / 2);
    if (d > 0.15) problems.push(`${label} ${i.id}: 글자 수 왼쪽 ${a} 대 오른쪽 ${b} (차이 ${(d * 100).toFixed(1)}%, 15% 이하여야 함 — 차이를 ${Math.floor(0.15 * (a + b) / 2)}자 이하로)`);
  });
}
// 4) 길이 방향 섞기: 1차는 a1·a3 오른쪽이 길게, a2·a1r 왼쪽이 길게(2자 이상). 심층은 상황마다 .1 오른쪽, .2 왼쪽(.3 이상은 홀수 오른쪽, 짝수 왼쪽).
//    길이만 보고 고르는 사람이 같은 축 안에서 엇갈리게 해 신뢰 '낮음'으로 걸리게 한다.
const WANT = { a1: "R", a2: "L", a1r: "L", a3: "R" };
function direction(list, label, wantOf) {
  list.forEach(i => {
    if (exempt(i.axis)) return;
    const d = len(i.right) - len(i.left), got = d >= 2 ? "R" : d <= -2 ? "L" : "=", w = wantOf(i);
    if (got !== w) problems.push(`${label} ${i.id}: ${w === "R" ? "오른쪽" : "왼쪽"}이 2자 이상 길어야 함(지금 왼쪽 ${len(i.left)}자, 오른쪽 ${len(i.right)}자, 줄바꿈도 한 글자)`);
  });
}
balance(bank.ab, "1차");
direction(bank.ab, "1차", i => WANT[i.set]);

// 5) 말투·싫은 것·집중 확인
const styles = Object.keys(bank.tone.styles);
bank.tone.items.forEach(t => styles.forEach(s => { if (!t.options[s]) problems.push(`${t.id}: 말투 ${s} 없음`); }));
styles.forEach(s => { if (!(bank.tone.rule || {})[s]) problems.push(`말투 규칙(tone.rule) ${s} 없음`); });
["t1", "t2", "t3", "t1r"].forEach(set => { if (bank.tone.items.filter(t => t.set === set).length !== 1) problems.push(`말투 ${set}가 하나여야 함`); });
bank.ox.forEach(o => { if (!o.id || !o.text || !o.rule) problems.push(`싫은 것 ${o.id || "(id 없음)"}: id·text·rule이 있어야 함`); });
if (bank.ox.length < 4 || bank.ox.length > 12) problems.push(`싫은 것 ${bank.ox.length}개(4~12개)`);
if (!bank.attention || ![-2, -1, 1, 2].includes(bank.attention.expect)) problems.push("집중 확인 문항(attention)이 없거나 expect가 틀림");

// 6) 심층: 상황마다 2문항 이상, 같은 균형·방향 규칙
Object.keys(bank.deep.situations).forEach(axis => {
  if (!bank.axes.find(a => a.id === axis)) problems.push(`심층: 없는 축 ${axis}`);
  bank.deep.situations[axis].forEach(s => {
    const n = bank.deep.items.filter(i => i.axis === axis && i.sit === s.id).length;
    if (n < 2) problems.push(`심층 ${axis}/${s.id}: 문항 ${n}개(2개 이상이어야 함)`);
  });
});
bank.deep.items.forEach(i => {
  const sits = bank.deep.situations[i.axis] || [];
  if (!sits.find(s => s.id === i.sit)) problems.push(`심층 ${i.id}: 없는 상황 ${i.axis}/${i.sit}`);
  if (!new RegExp(`^${i.axis}@${i.sit}\\.\\d+$`).test(i.id)) problems.push(`심층 ${i.id}: id는 '${i.axis}@${i.sit}.번호' 모양이어야 함`);
});
balance(bank.deep.items, "심층");
direction(bank.deep.items, "심층", i => (+(i.id.match(/\.(\d+)$/) || [0, 1])[1] % 2 === 1 ? "R" : "L"));

// 7) 추가 질문(4단계): ask는 심층 문항 id, open은 'f.'로 시작
const fu = bank.deep.followup;
if (fu) {
  (fu.ask || []).forEach(id => { if (!bank.deep.items.find(i => i.id === id)) problems.push(`추가 질문: 없는 심층 문항 ${id}`); });
  if ((fu.ask || []).length > 30) problems.push(`추가 질문 ${fu.ask.length}개(30개까지)`);
  const sitsOf = {};
  (fu.ask || []).forEach(id => { const it = bank.deep.items.find(i => i.id === id); if (it) (sitsOf[it.axis] = sitsOf[it.axis] || new Set()).add(it.sit); });
  Object.keys(sitsOf).forEach(ax => { if (sitsOf[ax].size < 2) problems.push(`추가 질문 ${ax}: 상황이 ${sitsOf[ax].size}개(축마다 2개 이상 — 한 상황의 답이 축 전체 규칙으로 번지지 않게)`); });
  (fu.open || []).forEach(o => { if (!/^f\./.test(o.id || "") || !o.text) problems.push(`추가 주관식 ${o.id}: id는 'f.'로 시작하고 text가 있어야 함`); });
}

// 8) 중복 id
const ids = bank.ab.map(i => i.id).concat(bank.deep.items.map(i => i.id));
if (new Set(ids).size !== ids.length) problems.push("문항 id 중복");

// 9) 개인정보: 문항 글에 메일·링크·전화번호처럼 긴 숫자가 들어가면 안 된다(사용자 기록에서 따온 문장은 일반화해서 쓴다)
const PII = [[/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "메일 주소"], [/https?:\/\//, "링크"], [/\d[\d\- ]{5,}\d/, "7자리 이상 숫자(전화·계좌·번호)"]];
function texts(o, where) {
  if (typeof o === "string") PII.forEach(([re, what]) => { if (re.test(o)) problems.push(`${where}: ${what}가 들어 있음 — "${o.slice(0, 40)}"`); });
  else if (o && typeof o === "object") Object.keys(o).forEach(k => { if (!["id", "axis", "set", "sit"].includes(k)) texts(o[k], where === "" ? k : where); });
}
texts({ axes: bank.axes, ab: bank.ab, tone: bank.tone, ox: bank.ox, deep: bank.deep }, "");

if (problems.length) { console.error("문항 은행 문제:\n- " + problems.join("\n- ")); process.exit(1); }

let prior = null;
if (resume) {
  if (!fu || !(fu.ask || []).length && !(fu.open || []).length) B.fail("deep.json에 followup(ask·open)이 없습니다. 추가 질문을 먼저 짜 주세요(설계원칙.md 4단계).");
  prior = B.readAnswers(resume);
  if (!B.checkMatch(bank, prior)) B.fail("1차 설문을 만든 문항 은행과 다릅니다. 추가 설문을 만들지 않았습니다.");
}
const outPath = path.resolve(opt("--out", path.join(B.bankDir(bankArg), prior ? `survey_r${fu.round || 2}.html` : "survey.html")));
const tpl = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
const score = fs.readFileSync(path.join(__dirname, "score.js"), "utf8");
const safe = o => JSON.stringify(o).replace(/</g, "\\u003c");
const html = tpl
  .replace("/*__SCORE__*/", () => score)
  .replace("/*__BANK__*/null", () => safe(bank))
  .replace("/*__PRIOR__*/null", () => (prior ? safe(prior) : "null"));
fs.writeFileSync(outPath, html);
console.log(`만듦: ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(1)}KB, 은행 ${bank.id} · 축 ${bank.axes.length} · 고르기 ${bank.ab.length} · 말투 ${bank.tone.items.length} · 싫은 것 ${bank.ox.length} · 상황별 ${bank.deep.items.length}${prior ? ` · 이어받은 1차 답 + 추가 질문 ${(fu.ask || []).length}개·주관식 ${(fu.open || []).length}개` : ""})`);

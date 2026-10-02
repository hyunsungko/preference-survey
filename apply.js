// apply.js — 선호 진단 결과를 어디에 어떻게 넣을지 반영안을 만든다. 기본은 보여 주기만 하고, --write를 줘야 CLAUDE.md를 고친다.
//   node apply.js <결과코드|답.json>                          반영안 출력(줄마다 [키]가 붙는다)
//   node apply.js <결과코드|답.json> --claude-md 경로 --settings 경로 --hook 경로
//   node apply.js <결과코드|답.json> --write [--skip 키,키]   CLAUDE.md의 「대화 선호」 절만 바꾼다. --skip의 줄은 뺀다
//
// 나누는 기준
//   판단이 필요한 글쓰기 습관(채팅 답 포함)           → CLAUDE.md 「대화 선호」 절
//   기계로 잡을 수 있는 것(이모지·느낌표·정해진 말)   → 경고만 하는 글쓰기 검사 훅 패턴. 이 훅은 파일에 쓰는 글(Write·Edit)만 검사한다
//   답 형식 전체(설명을 얼마나 붙일지)                → settings.json outputStyle 제안
//   권한(permissions)은 안전 설정이라 건드리지 않는다
const fs = require("fs");
const os = require("os");
const path = require("path");
const S = require("./score.js");
const B = require("./bank.js");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const valueOpts = ["--claude-md", "--settings", "--hook", "--skip", "--bank"];
const src = args.find((a, i) => !a.startsWith("--") && !valueOpts.includes(args[i - 1]));
const HOME = os.homedir();
const claudeMd = opt("--claude-md", path.join(HOME, ".claude", "CLAUDE.md"));
const settingsPath = opt("--settings", path.join(HOME, ".claude", "settings.json"));
const hookPath = opt("--hook", path.join(HOME, ".claude", "hooks", "word_guard.py"));
const skip = (opt("--skip", "") || "").split(",").map(s => s.trim()).filter(Boolean);

const bank = B.loadBank(opt("--bank"));
const ans = B.readAnswers(src);
B.checkMatch(bank, ans);
const res = S.score(bank, ans);
if (res.overall === "참고용") { console.log("종합 신뢰도가 '참고용'이라 반영안을 만들지 않습니다. 며칠 뒤 다시 해 보세요."); process.exit(0); }

// 기존 지침에서 같은 내용을 다루는 줄을 찾을 말
const KEYS = {
  tone: ["합니다체", "해요체", "존댓말", "반말"], length: ["장황", "짧게 쓴", "자세히 쓴"], order: ["결론 먼저", "결론을 먼저", "첫 줄에 결론"],
  autonomy: ["애매하면", "애매한 점", "먼저 묻"], format: ["표나 목록", "목록으로 정리", "표로 정리", "표 남발"],
  report: ["어떻게 확인", "확인한 과정", "확인과 보고", "확인 보고"], emoji: ["이모지", "느낌표"], hedge: ["단정", "것 같다"],
  explain: ["원리", "왜 그런지"], pushback: ["더 나은 방법", "반박", "Push back", "push back"], options: ["하나를 추천", "여러 안", "선택지를"],
  jargon: ["쉬운 말", "전문 용어", "어려운 말"],
  "ox.praise": ["좋은 질문"], "ox.self": ["꼼꼼", "완벽하게", "자기 자랑", "스스로를 칭찬"], "ox.recap": ["다시 요약"], "ox.offer": ["도와드릴까요"],
  "ox.sorry": ["사과"], "ox.name": ["호칭으로 시작"]
};
// 기계로 잡을 수 있는 것 → 경고 훅 패턴(word_guard.py PATTERNS 형식)
const HOOKS = {
  "emoji": [String.raw`[\U0001F300-\U0001FAFF☀-➿]`, "이모지 → 쓰지 않는다"],
  "emoji.mark": [String.raw`[가-힣]!`, "느낌표 → 쓰지 않는다"],
  "hedge": [String.raw`(것 같습니다|것 같아요|것으로 보입니다)`, "근거가 있으면 단정해서 쓴다"],
  "ox.praise": [String.raw`좋은 질문`, "답 앞에 칭찬을 붙이지 않는다"],
  "ox.self": [String.raw`(꼼꼼히|완벽하게|철저히)`, "스스로를 칭찬하지 않는다"],
  "ox.offer": [String.raw`(더 도와드릴까요|도움이 필요하시면)`, "답 끝에 더 도와드릴까요를 붙이지 않는다"]
};

const md = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, "utf8") : "";
const mdLines = md.split(/\r?\n/);
// 코드 울타리(```) 안의 '#' 줄은 제목으로 보지 않는다
const fenced = []; let inFence = false;
mdLines.forEach(l => { if (/^\s*```/.test(l)) { fenced.push(true); inFence = !inFence; } else fenced.push(inFence); });
const isHeading = (l, i, re) => !fenced[i] && re.test(l);
const secStart = mdLines.findIndex((l, i) => isHeading(l, i, /^## 대화 선호/));
let secEnd = secStart < 0 ? -1 : mdLines.findIndex((l, i) => i > secStart && isHeading(l, i, /^#{1,2} /));
if (secStart >= 0 && secEnd < 0) secEnd = mdLines.length;
function overlaps(key) {
  const words = KEYS[key] || [];
  const hits = [];
  mdLines.forEach((l, i) => {
    if (secStart >= 0 && i >= secStart && i < secEnd) return;   // 바꿀 절 자신은 빼고 본다
    if (words.some(w => l.includes(w))) hits.push(`${i + 1}행: ${l.trim().slice(0, 70)}`);
  });
  return hits.slice(0, 3);
}

// 1) CLAUDE.md
const items = [];
res.tone.rules.forEach(r => items.push({ key: "tone", line: r }));
const deepIds = res.deep.map(d => d.id);
res.axes.filter(a => !a.unclear && !deepIds.includes(a.id)).forEach(a => items.push({ key: a.id, line: a.rule, note: `${a.pole}(${a.strength}, 신뢰 ${a.grade})` }));
res.deep.forEach(d => {
  if (d.sameAll) items.push({ key: d.id, line: d.rules[0], note: "상황별 질문" });
  else if (d.rules.length) items.push({ key: d.id, line: d.head, sub: d.rules, note: "상황별 질문" });
});
res.ox.filter(o => o.dislike).forEach(o => items.push({ key: o.id, line: o.rule }));
const kept = items.filter(it => !skip.includes(it.key));
const unknown = skip.filter(k => !items.some(it => it.key === k));
if (unknown.length) console.error(`알 수 없는 --skip 키: ${unknown.join(", ")} (반영안의 [키]를 보고 다시 주세요)`);

const out = [];
out.push(`# 선호 진단 반영안 (${res.date}, 신뢰도 ${res.overall})`);
out.push(`\n## 1. CLAUDE.md 「대화 선호」 절 — ${claudeMd}`);
out.push(secStart >= 0 ? `이미 있는 「대화 선호」 절(${secStart + 1}~${secEnd}행)을 아래로 바꾼다.` : "「대화 선호」 절이 없어 새로 넣는다.");
out.push("줄 앞의 [키]를 `--skip 키,키`로 주면 그 줄을 빼고 넣는다.");
items.forEach(it => {
  const off = skip.includes(it.key) ? " (뺌)" : "";
  out.push(`- [${it.key}] ${it.line}${it.note ? `  ← ${it.note}` : ""}${off}`);
  (it.sub || []).forEach(s => out.push(`    - ${s}`));
  const ov = overlaps(it.key);
  if (ov.length) out.push(`    ⚠ 기존 지침과 겹칠 수 있음: ${ov.join(" / ")}`);
});

// 2) 훅
const hookSrc = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : null;
const want = [];
const emojiAx = res.axes.find(a => a.id === "emoji"), hedgeAx = res.axes.find(a => a.id === "hedge");
if (emojiAx && !emojiAx.unclear && emojiAx.dir < 0) want.push("emoji", "emoji.mark");
if (hedgeAx && !hedgeAx.unclear && hedgeAx.dir < 0 && hedgeAx.strength === "강함") want.push("hedge");
res.ox.filter(o => o.dislike && HOOKS[o.id]).forEach(o => want.push(o.id));
out.push(`\n## 2. 글쓰기 검사 훅 — ${hookPath}${hookSrc ? "" : " (파일 없음: 새로 만들지는 사용자와 정한다)"}`);
out.push("이 훅은 파일에 쓰는 글(Write·Edit)만 검사한다. 채팅 답의 습관은 1번 CLAUDE.md 규칙으로 지킨다. 보고서처럼 이모지를 일부러 쓰는 파일에도 경고가 나갈 수 있다.");
if (!want.length) out.push("- 넣을 패턴 없음");
want.forEach(k => {
  const [pat, why] = HOOKS[k];
  const exists = hookSrc && hookSrc.includes(pat);
  out.push(`- ${exists ? "(이미 있음) " : ""}(r"${pat}", "${why}"),`);
});
out.push("  경고만 하는 훅에 넣는다. 막는 훅(exit 2)에 넣으면 금지어를 인용한 글까지 막힌다.");

// 3) settings.json
// outputStyle은 전역 설정 말고도 지금 폴더의 .claude/settings.json·settings.local.json에서 덮어쓸 수 있다(뒤에 읽은 것이 이김)
let cur = "(지정 없음)";
const styleFrom = [];
for (const f of [settingsPath, path.join(process.cwd(), ".claude", "settings.json"), path.join(process.cwd(), ".claude", "settings.local.json")]) {
  try { const v = JSON.parse(fs.readFileSync(f, "utf8")).outputStyle; if (v) { cur = v; styleFrom.push(`${v} ← ${f}`); } } catch (e) { /* 없는 파일은 넘어간다 */ }
}
if (styleFrom.length > 1) cur += ` (여러 곳에서 지정: ${styleFrom.join(" / ")})`;
else if (styleFrom.length === 1) cur += ` (${styleFrom[0].split(" ← ")[1]})`;
const ex = res.axes.find(a => a.id === "explain"), exDeep = res.deep.find(d => d.id === "explain");
let sug = "바꾸지 않는다";
if (exDeep && !exDeep.sameAll) sug = "바꾸지 않는다(설명 선호가 상황마다 달라 출력 스타일 하나로 정할 수 없음 — CLAUDE.md 상황별 규칙으로 둔다)";
else if (ex && !ex.unclear && ex.strength === "강함") sug = ex.dir > 0 ? `"Explanatory" (왜 그런지까지 강함)` : `"default" (방법 위주 강함)`;
out.push(`\n## 3. settings.json — ${settingsPath}`);
out.push(`- outputStyle: 지금 ${cur} → 제안: ${sug}`);
out.push("- permissions(권한)는 바꾸지 않는다. '알아서 진행'은 애매할 때의 판단 습관에 관한 선호이고, 권한을 넓히는 근거로 쓰지 않는다.");

// 4) 주관식과 '둘 다 싫다'에 적은 고칠 말
const notes = res.unsure.filter(u => u.note);
if (res.open.length || notes.length) {
  out.push(`\n## 4. 직접 적은 말 — AI가 읽고 지침 후보로 바꿔 사용자에게 확인받는다`);
  res.open.forEach(o => out.push(`- [${o.id}] ${o.text}`));
  notes.forEach(u => out.push(`- [${u.id} ${u.kind}] ${u.note}${u.prompt ? `  ← 문항: ${u.prompt}` : ""}`));
}
if (res.followup.recommend && !ans.round && ans.fu !== "skip") out.push(`\n※ 애매한 축(${res.followup.axes.join(", ") || "없음"})과 고르지 못한 문항 ${res.followup.items}개가 있다. 사용자가 생략을 고르지 않았으면, 넣기 전에 추가 질문을 권한다(SKILL.md 4단계).`);
out.push(`\n## 5. 넣는 순서\n1. 위 반영안을 사용자에게 보여 주고 줄마다 넣을지 묻는다(⚠ 줄은 기존 지침과 어느 쪽을 남길지 함께 묻는다).\n2. CLAUDE.md는 \`--write --skip <뺄 키>\`로 「대화 선호」 절만 바꾼다. 백업은 같은 폴더에 시각을 붙여 남는다.\n3. 훅·settings는 사용자가 고른 줄만 손으로 넣는다.\n4. 넣은 뒤 일상 질문 5개로 전·후 답을 가려 고르게 해 검증한다(SKILL.md 6단계).`);
console.log(out.join("\n"));

// --write: CLAUDE.md 「대화 선호」 절만 바꾼다
if (args.includes("--write")) {
  if (!md) { console.error(`\n${claudeMd}가 없어 쓰지 않았습니다.`); process.exit(1); }
  const block = [`## 대화 선호 (선호 진단 ${res.date}, 신뢰도 ${res.overall})`, ""];
  kept.forEach(it => { block.push(`- ${it.line}`); (it.sub || []).forEach(s => block.push(`  - ${s}`)); });
  block.push("");
  const lines = mdLines.slice();
  if (secStart >= 0) lines.splice(secStart, secEnd - secStart, ...block);
  else {
    const speak = lines.findIndex((l, i) => isHeading(l, i, /^## 말하기 규칙/));
    const from = speak >= 0 ? speak : lines.findIndex((l, i) => isHeading(l, i, /^## /));
    let at = from < 0 ? lines.length : lines.findIndex((l, i) => i > from && isHeading(l, i, /^#{1,2} /));
    if (at < 0) at = lines.length;
    lines.splice(at, 0, ...block);
  }
  // 백업: 시각을 붙이고, 같은 이름이 있으면 덮어쓰지 않는다(처음 원본을 지키기 위해)
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  let bak = `${claudeMd}.bak-pref-${stamp}`, n = 1;
  while (fs.existsSync(bak)) bak = `${claudeMd}.bak-pref-${stamp}-${n++}`;
  fs.copyFileSync(claudeMd, bak);
  fs.writeFileSync(claudeMd, lines.join(md.includes("\r\n") ? "\r\n" : "\n"));
  console.log(`\nCLAUDE.md를 고쳤습니다(${kept.length}줄${skip.length ? ", 뺀 키 " + skip.join(",") : ""}). 백업: ${bak}`);
}

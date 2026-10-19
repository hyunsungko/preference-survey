// apply.js — 선호 진단 결과를 어디에 어떻게 넣을지 반영안을 만든다. 기본은 보여 주기만 하고, 쓰는 옵션을 줘야 파일을 고친다.
//   node apply.js <결과코드|답.json>                          반영안 출력(줄마다 [키]가 붙는다)
//   node apply.js <결과코드|답.json> --claude-md 경로 --settings 경로 --hook 경로 --style-dir 폴더 --hooks-dir 폴더
//   --skip 키,키       아래 쓰기에서 그 줄을 뺀다(용어는 [lex:말] 키)
//   --write            CLAUDE.md의 「대화 선호」 절만 바꾼다(파일이 없으면 만든다)
//   --write-style      맞춤 출력 스타일 파일(output-styles/preference.md)을 쓰고 settings.json outputStyle을 그것으로 바꾼다
//   --install-guard    용어 지키기 훅(pref_lex_guard.js)과 규칙(pref_lexicon.json)을 넣고 settings.json hooks에 등록한다
//                      [--chat block|warn|off] 채팅 답에서 막을 말이 나왔을 때: 다시 쓰게 함(기본)·알리기만·하지 않음
//   쓰기 전에 고치는 파일은 모두 시각을 붙인 백업(.bak-pref-<시각>)을 남긴다. settings.json의 permissions는 건드리지 않는다.
//
// 나누는 기준
//   판단이 필요한 글쓰기 습관(채팅 답 포함)           → CLAUDE.md 「대화 선호」 절 또는 맞춤 출력 스타일(둘 중 하나)
//   바꿔 쓸 용어                                       → 위 규칙 + 용어 지키기 훅(질문마다 일러 주고, 글 파일에 쓰려 하면 막고, 채팅 답에 나오면 다시 쓰게 함)
//   기계로 잡을 수 있는 것(이모지·느낌표·정해진 말)   → 경고만 하는 글쓰기 검사 훅 패턴. 이 훅은 파일에 쓰는 글(Write·Edit)만 검사한다
//   권한(permissions)은 안전 설정이라 건드리지 않는다
const fs = require("fs");
const os = require("os");
const path = require("path");
const S = require("./score.js");
const B = require("./bank.js");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const valueOpts = ["--claude-md", "--settings", "--hook", "--skip", "--bank", "--style-dir", "--hooks-dir", "--chat"];
const src = args.find((a, i) => !a.startsWith("--") && !valueOpts.includes(args[i - 1]));
const HOME = os.homedir();
const claudeMd = opt("--claude-md", path.join(HOME, ".claude", "CLAUDE.md"));
const settingsPath = opt("--settings", path.join(HOME, ".claude", "settings.json"));
const hookPath = opt("--hook", path.join(HOME, ".claude", "hooks", "word_guard.py"));
const styleDir = path.resolve(opt("--style-dir", path.join(HOME, ".claude", "output-styles")));
const hooksDir = path.resolve(opt("--hooks-dir", path.join(HOME, ".claude", "hooks")));
const chatMode = opt("--chat", "block");
if (!["block", "warn", "off"].includes(chatMode)) B.fail(`--chat은 block·warn·off 중 하나여야 합니다: ${chatMode}`);
const STYLE_NAME = "선호 맞춤";
const skip = (opt("--skip", "") || "").split(",").map(s => s.trim()).filter(Boolean);

const bank = B.loadBank(opt("--bank"));
const ans = B.readAnswers(src);
B.checkMatch(bank, ans);
const res = S.score(bank, ans, { usage: B.loadUsage(opt("--bank")) });
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
// 용어: 한 묶음(머리 줄 + 말마다 한 줄). 말마다 [lex:말] 키로 뺄 수 있다
const lexAll = res.lex.avoid.map(a => Object.assign({ key: "lex:" + a.w }, a));
const lexKept = lexAll.filter(a => !skip.includes(a.key) && !skip.includes("lex"));
const lexLine = a => `'${a.w}' → ${a.to ? `'${a.to}'` : "다른 말로 바꾼다"}`;
const kept = items.filter(it => !skip.includes(it.key));
if (lexKept.length) kept.push({ key: "lex", line: res.lex.head, sub: lexKept.map(lexLine) });
const unknown = skip.filter(k => k !== "lex" && !items.some(it => it.key === k) && !lexAll.some(a => a.key === k));
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
if (lexAll.length) {
  out.push(`- [lex] ${res.lex.head}${skip.includes("lex") ? " (뺌)" : ""}`);
  lexAll.forEach(a => {
    const ov = mdLines.map((l, i) => [l, i]).filter(([l, i]) => !(secStart >= 0 && i >= secStart && i < secEnd) && l.includes(a.w)).slice(0, 2).map(([l, i]) => `${i + 1}행: ${l.trim().slice(0, 60)}`);
    out.push(`    - [${a.key}] ${lexLine(a)}  ← ${a.strong ? "막음" : "지침만"}(${a.why})${skip.includes(a.key) ? " (뺌)" : ""}`);
    if (ov.length) out.push(`      ⚠ 기존 지침에 같은 말이 있음: ${ov.join(" / ")}`);
  });
}
const lexUnclear = res.lex.unclear;
if (lexUnclear.length) out.push(`- 용어에서 흔들린 묶음(넣지 않음): ${lexUnclear.map(c => `${c.name}(${c.how})`).join(", ")}`);

// 2) 맞춤 출력 스타일: 위 규칙 전체를 출력 스타일 하나로 묶는다. outputStyle은 모든 답의 틀이라 CLAUDE.md보다 앞에서 읽힌다
// outputStyle은 전역 설정 말고도 지금 폴더의 .claude/settings.json·settings.local.json에서 덮어쓸 수 있다(뒤에 읽은 것이 이김)
let cur = "(지정 없음)";
const styleFrom = [];
for (const f of [settingsPath, path.join(process.cwd(), ".claude", "settings.json"), path.join(process.cwd(), ".claude", "settings.local.json")]) {
  try { const v = JSON.parse(fs.readFileSync(f, "utf8")).outputStyle; if (v) { cur = v; styleFrom.push(`${v} ← ${f}`); } } catch (e) { /* 없는 파일은 넘어간다 */ }
}
if (styleFrom.length > 1) cur += ` (여러 곳에서 지정: ${styleFrom.join(" / ")})`;
else if (styleFrom.length === 1) cur += ` (${styleFrom[0].split(" ← ")[1]})`;
const stylePath = path.join(styleDir, "preference.md");
const bodyLines = [];
kept.forEach(it => { bodyLines.push(`- ${it.line}`); (it.sub || []).forEach(x => bodyLines.push(`  - ${x}`)); });
const styleText = [
  "---", `name: ${STYLE_NAME}`, `description: 선호 진단(${res.date}, 신뢰도 ${res.overall})에서 사용자가 고른 답하는 방식`, "keep-coding-instructions: true", "---", "",
  "# 답하는 방식", "",
  `이 사용자가 직접 고른 답을 바탕으로 만든 규칙이다(선호 진단 ${res.date}). 말투·길이·형식·용어가 기본 지침과 부딪히면 아래를 따른다. 코딩 작업의 지침은 그대로 지킨다.`, "",
  ...bodyLines, ""
].join("\n");
const ex = res.axes.find(a => a.id === "explain");
out.push(`\n## 2. 맞춤 출력 스타일 — ${stylePath}`);
out.push(`- outputStyle: 지금 ${cur} → 제안: "${STYLE_NAME}"(위 1번 규칙 ${bodyLines.length}줄을 담은 스타일, 코딩 지침은 유지)`);
if (ex && !ex.unclear && ex.strength === "강함" && ex.dir > 0) out.push(`  설명 선호가 강해 기본 "Explanatory" 스타일도 맞을 수 있지만, 맞춤 스타일에 같은 규칙이 들어 있어 하나만 쓴다.`);
out.push("- 1번 CLAUDE.md 절과 같은 내용이다. 둘 다 넣으면 같은 말이 두 번 들어가므로 하나만 고른다(권장: 출력 스타일 — 모든 답의 틀로 읽힌다).");
out.push("- 넣기: `--write-style`(스타일 파일을 쓰고 settings.json outputStyle을 바꾼다. 다음 세션부터 적용, 지금 세션은 /output-style로 바꿀 수 있다).");

// 3) 용어 지키기 훅: 질문마다 일러 주고(UserPromptSubmit), 글 파일에 쓰려 하면 막고(PreToolUse), 채팅 답에 나오면 다시 쓰게 한다(Stop)
const guardPath = path.join(hooksDir, "pref_lex_guard.js"), lexPath = path.join(hooksDir, "pref_lexicon.json");
const lexFile = {
  made: `선호 진단 ${res.date}`, chat: chatMode, remind: true,
  exts: [".md", ".markdown", ".txt", ".rst", ".adoc"],
  skipPaths: ["/.claude/skills/preference-survey/"],
  block: lexKept.filter(a => a.strong).map(a => ({ w: a.w, to: a.to, forms: a.forms })),
  soft: lexKept.filter(a => !a.strong).map(a => ({ w: a.w, to: a.to }))
};
const guardCmd = `node "${guardPath}"`;
out.push(`\n## 3. 용어 지키기 훅 — ${guardPath}`);
if (!lexKept.length) out.push("- 바꿔 쓸 용어가 없어 넣지 않는다.");
else {
  out.push(`- 막을 말 ${lexFile.block.length}개: ${lexFile.block.map(a => `${a.w}→${a.to || "다른 말"}`).join(", ") || "없음"}`);
  out.push(`- 지침만 ${lexFile.soft.length}개: ${lexFile.soft.map(a => `${a.w}→${a.to || "다른 말"}`).join(", ") || "없음"}`);
  out.push("- 하는 일: ① 질문마다 바꿔 쓸 말 목록을 한 줄로 일러 준다(쓰기 전에 막는 단계). ② .md·.txt 같은 글 파일에 막을 말을 쓰려 하면 쓰지 않고, 바꿀 말을 알려 줘 고쳐 쓰게 한다.");
  out.push(`  ③ 채팅 답에 막을 말이 나오면 ${chatMode === "block" ? "한 번 되돌려 그 말만 바꿔 다시 쓰게 한다(이미 보인 답 아래에 고친 답이 붙는다)" : chatMode === "warn" ? "알리기만 한다" : "아무것도 하지 않는다"}. 인용·코드·링크 안의 말은 검사하지 않는다.`);
  out.push(`- 넣기: \`--install-guard\`(훅·규칙 파일을 ${hooksDir}에 쓰고 settings.json hooks에 UserPromptSubmit·PreToolUse(Write|Edit|MultiEdit)·Stop을 등록). 끄려면 환경 변수 PREF_LEX_OFF=1.`);
}

// 4) 경고 훅(word_guard.py) 패턴
const hookSrc = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : null;
const want = [];
const emojiAx = res.axes.find(a => a.id === "emoji"), hedgeAx = res.axes.find(a => a.id === "hedge");
if (emojiAx && !emojiAx.unclear && emojiAx.dir < 0) want.push("emoji", "emoji.mark");
if (hedgeAx && !hedgeAx.unclear && hedgeAx.dir < 0 && hedgeAx.strength === "강함") want.push("hedge");
res.ox.filter(o => o.dislike && HOOKS[o.id]).forEach(o => want.push(o.id));
out.push(`\n## 4. 글쓰기 검사 훅(경고만) — ${hookPath}${hookSrc ? "" : " (파일 없음: 새로 만들지는 사용자와 정한다)"}`);
out.push("이 훅은 파일에 쓰는 글(Write·Edit)만 검사한다. 채팅 답의 습관은 1번 CLAUDE.md 규칙으로 지킨다. 보고서처럼 이모지를 일부러 쓰는 파일에도 경고가 나갈 수 있다.");
if (!want.length) out.push("- 넣을 패턴 없음");
want.forEach(k => {
  const [pat, why] = HOOKS[k];
  const exists = hookSrc && hookSrc.includes(pat);
  out.push(`- ${exists ? "(이미 있음) " : ""}(r"${pat}", "${why}"),`);
});
out.push("  경고만 하는 훅에 넣는다. 막는 훅(exit 2)에 넣으면 금지어를 인용한 글까지 막힌다.");

// 5) 주관식과 '둘 다 싫다'에 적은 고칠 말
const notes = res.unsure.filter(u => u.note);
const lexMoreId = bank.lex && bank.lex.more ? bank.lex.more.id : "lex.more";
const opens = res.open.filter(o => o.id !== lexMoreId || !res.lex.user.length);   // 용어 직접 적기는 3번에서 읽었다(읽지 못한 줄만 있으면 남긴다)
if (opens.length || notes.length) {
  out.push(`\n## 5. 직접 적은 말 — AI가 읽고 지침 후보로 바꿔 사용자에게 확인받는다`);
  opens.forEach(o => out.push(`- [${o.id}] ${o.text.replace(/\n/g, " / ")}`));
  notes.forEach(u => out.push(`- [${u.id} ${u.kind}] ${u.note}${u.prompt ? `  ← 문항: ${u.prompt}` : ""}`));
}
if (res.followup.recommend && !ans.round && ans.fu !== "skip") out.push(`\n※ 애매한 축(${res.followup.axes.join(", ") || "없음"})과 고르지 못한 문항 ${res.followup.items}개가 있다. 사용자가 생략을 고르지 않았으면, 넣기 전에 추가 질문을 권한다(SKILL.md 4단계).`);
out.push(`\n## 6. 넣는 순서\n1. 위 반영안을 사용자에게 보여 주고 줄마다 넣을지 묻는다(⚠ 줄은 기존 지침과 어느 쪽을 남길지 함께 묻는다). 용어는 [lex:말] 줄마다, 특히 '막음' 줄을 꼭 확인받는다.\n2. 규칙은 출력 스타일(\`--write-style\`)이나 CLAUDE.md(\`--write\`) 중 하나로 넣는다. 둘 다 \`--skip <뺄 키>\`를 따른다.\n3. 용어는 \`--install-guard\`로 훅을 넣어야 실제로 막힌다. 경고 훅(4번)은 사용자가 고른 줄만 손으로 넣는다.\n4. 넣은 뒤 일상 질문 5개로 전·후 답을 가려 고르게 해 검증한다(SKILL.md 5단계).`);
console.log(out.join("\n"));

// 쓰기 전에 원본을 남긴다: 시각을 붙이고, 같은 이름이 있으면 덮어쓰지 않는다(처음 원본을 지키기 위해)
function backup(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  let bak = `${file}.bak-pref-${stamp}`, n = 1;
  while (fs.existsSync(bak)) bak = `${file}.bak-pref-${stamp}-${n++}`;
  fs.copyFileSync(file, bak);
  return bak;
}
// settings.json을 고친다. 읽지 못하는 JSON이면 고치지 않고, permissions는 그대로인지 확인한 뒤에만 쓴다
function editSettings(change) {
  let cfg = {};
  if (fs.existsSync(settingsPath)) {
    try { cfg = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch (e) { B.fail(`${settingsPath}를 JSON으로 읽지 못해 고치지 않았습니다. 파일을 고친 뒤 다시 해 주세요.`); }
  }
  const perm = JSON.stringify(cfg.permissions);
  change(cfg);
  if (JSON.stringify(cfg.permissions) !== perm) B.fail("permissions가 바뀌어 쓰지 않았습니다(이 도구는 권한을 고치지 않는다).");
  const bak = backup(settingsPath);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + "\n");
  return bak;
}

// --write: CLAUDE.md 「대화 선호」 절만 바꾼다. 파일이 없으면 그 절만 든 파일을 만든다
if (args.includes("--write")) {
  const block = [`## 대화 선호 (선호 진단 ${res.date}, 신뢰도 ${res.overall})`, ""];
  kept.forEach(it => { block.push(`- ${it.line}`); (it.sub || []).forEach(s => block.push(`  - ${s}`)); });
  block.push("");
  let lines;
  if (!md) lines = block;
  else {
    lines = mdLines.slice();
    if (secStart >= 0) lines.splice(secStart, secEnd - secStart, ...block);
    else {
      const speak = lines.findIndex((l, i) => isHeading(l, i, /^## 말하기 규칙/));
      const from = speak >= 0 ? speak : lines.findIndex((l, i) => isHeading(l, i, /^## /));
      let at = from < 0 ? lines.length : lines.findIndex((l, i) => i > from && isHeading(l, i, /^#{1,2} /));
      if (at < 0) at = lines.length;
      lines.splice(at, 0, ...block);
    }
  }
  const bak = backup(claudeMd);
  fs.mkdirSync(path.dirname(claudeMd), { recursive: true });
  fs.writeFileSync(claudeMd, lines.join(md.includes("\r\n") ? "\r\n" : "\n"));
  console.log(`\nCLAUDE.md를 ${md ? "고쳤습니다" : "새로 만들었습니다"}(${kept.length}줄${skip.length ? ", 뺀 키 " + skip.join(",") : ""}).${bak ? " 백업: " + bak : ""}`);
}

// --write-style: 맞춤 출력 스타일 파일을 쓰고 outputStyle을 그것으로 바꾼다
if (args.includes("--write-style")) {
  fs.mkdirSync(styleDir, { recursive: true });
  const bak = backup(stylePath);
  fs.writeFileSync(stylePath, styleText);
  const sbak = editSettings(cfg => { cfg.outputStyle = STYLE_NAME; });
  console.log(`\n출력 스타일을 썼습니다: ${stylePath}${bak ? ` (백업 ${bak})` : ""}\nsettings.json outputStyle → "${STYLE_NAME}"${sbak ? ` (백업 ${sbak})` : ""}. 새 세션부터 적용됩니다.`);
  if (styleFrom.some(x => !x.endsWith(settingsPath))) console.log(`⚠ 지금 폴더의 설정이 outputStyle을 따로 정하고 있어 이 폴더에서는 그쪽이 이깁니다: ${styleFrom.join(" / ")}`);
}

// --install-guard: 용어 지키기 훅과 규칙을 넣고 settings.json hooks에 등록한다(같은 훅이 이미 있으면 바꾼다)
if (args.includes("--install-guard")) {
  if (!lexKept.length) { console.log("\n바꿔 쓸 용어가 없어 훅을 넣지 않았습니다."); process.exit(0); }
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "lex_guard.js"), guardPath);
  const lbak = backup(lexPath);
  fs.writeFileSync(lexPath, JSON.stringify(lexFile, null, 1) + "\n");
  const sbak = editSettings(cfg => {
    cfg.hooks = cfg.hooks || {};
    const add = (ev, matcher) => {
      const list = (cfg.hooks[ev] || []).map(g => Object.assign({}, g, { hooks: (g.hooks || []).filter(h => !String(h.command || "").includes("pref_lex_guard.js")) }))
        .filter(g => g.hooks.length);
      const entry = { hooks: [{ type: "command", command: guardCmd, timeout: 10 }] };
      if (matcher) entry.matcher = matcher;
      list.push(entry);
      cfg.hooks[ev] = list;
    };
    add("UserPromptSubmit");
    add("PreToolUse", "Write|Edit|MultiEdit");
    add("Stop");
  });
  console.log(`\n용어 지키기 훅을 넣었습니다: ${guardPath}\n규칙: ${lexPath}${lbak ? ` (백업 ${lbak})` : ""} — 막을 말 ${lexFile.block.length}개, 지침만 ${lexFile.soft.length}개\nsettings.json hooks에 UserPromptSubmit·PreToolUse·Stop을 등록했습니다${sbak ? ` (백업 ${sbak})` : ""}. 새 세션부터 적용됩니다(지금 세션은 /hooks에서 확인).`);
}

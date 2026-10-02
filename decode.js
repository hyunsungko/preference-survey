// decode.js — 설문 결과 코드(PS1.… 또는 압축된 PS2.…)나 답 파일(JSON)을 풀어 통계와 지침 초안을 보여 준다.
//   node decode.js <결과코드|답.json>                       결과 요약 + 지침 초안
//   node decode.js <결과코드|답.json> --save 답.json        답을 파일로 저장(다음 비교용)
//   node decode.js <결과코드|답.json> --compare 이전답.json  지난 결과와 비교
//   node decode.js <결과코드|답.json> --json                채점 결과 전체를 JSON으로(apply.js가 쓴다)
//   --bank <폴더>   사용자에 맞게 짠 문항 은행으로 만든 설문이면 그 폴더(없으면 기본 문항)
const fs = require("fs");
const S = require("./score.js");
const B = require("./bank.js");
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const valueOpts = ["--save", "--compare", "--items", "--deep", "--bank"];
const src = args.find((a, i) => !a.startsWith("--") && !valueOpts.includes(args[i - 1]));

const readAnswers = B.readAnswers;
const bank = B.loadBank(opt("--bank"), opt("--items"), opt("--deep"));
const ans = readAnswers(src);
B.checkMatch(bank, ans);
const res = S.score(bank, ans);
if (args.includes("--json")) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }

const rel = res.reliability;
const f = x => (x === null || x === undefined ? "-" : x.toFixed(2));
const p = x => (x === null || x === undefined ? "-" : Math.round(x * 100) + "%");

console.log(`# 선호 진단 결과 (${res.date}) — 종합 신뢰도: ${res.overall}`);
console.log(`가장 뚜렷한 선호: ${res.summary.join(" · ") || "없음"}`);
console.log(`\n## 신뢰도`);
console.log(`- 반분 신뢰도 ${f(rel.splitHalf)} (축 ${rel.halfPairs}개, 보정 전 r ${f(rel.splitHalfRaw)})`);
console.log(`- 다시 물은 문항 일치 ${p(rel.retestAgree)} (${rel.retestPairs}쌍, r ${f(rel.retestR)})`);
console.log(`- 집중 확인 ${rel.attention === null ? "-" : rel.attention ? "통과" : "실패"} · '나' 비율 ${p(rel.rightShare)}${rel.posBias ? "(치우침)" : ""} · '조금' 비율 ${p(rel.mildShare)} · 빠른 응답 ${rel.fast}개`);
if (rel.unsureShare) console.log(`- '잘 모르겠다·둘 다 싫다' 비율 ${p(rel.unsureShare)}${rel.unsureShare > 0.3 ? " (30% 넘음 → 종합을 한 단계 낮춤)" : ""}`);
console.log(`- 더 긴 답을 고른 비율 ${rel.longShare === null ? "-(길이가 다른 문항 " + rel.longN + "개로 적음)" : p(rel.longShare)}${rel.longBias ? " · " + (rel.longSide === "long" ? "긴" : "짧은") + " 쪽 쏠림" : ""}`);
if (rel.oneSide) console.log(`- 한쪽 극 몰림: ${rel.oneSide.total}개 축 중 ${rel.oneSide.n}개가 ${rel.oneSide.side === "left" ? "간결·직접" : "자세히·친절"} 쪽 — 한 성향이 번졌을 수 있음, 적용 뒤 A/B 검증 권장`);
console.log(`\n## 축 (점수 -1=왼쪽 극, +1=오른쪽 극)`);
res.axes.forEach(a => {
  console.log(`- ${a.name}: ${a.pole} ${f(a.F)} [고름 ${f(a.R)} · 말 ${f(a.S)} · 일관성 ${f(a.C)} · 재검사 ${a.retest === null ? "-" : a.retest ? "같음" : "다름"} · 신뢰 ${a.grade}${a.sayDiff ? " · 말과 선택이 다름" : ""}${a.unsureN + a.bothBadN ? ` · 고르지 못함 ${a.unsureN + a.bothBadN}` : ""}]`);
});
if (res.deep.length) {
  console.log(`\n## 상황별`);
  res.deep.forEach(d => {
    console.log(`- ${d.name}${d.sameAll ? " (상황과 관계없이 같음)" : ""}`);
    d.situations.forEach(s => console.log(`  - ${s.name}: ${s.pole}${s.dir ? "(" + s.strength + ")" : ""} ${f(s.score)}${s.agree ? "" : " · 흔들림"}`));
  });
}
console.log(`\n## 말투`);
res.tone.byContext.forEach(c => console.log(`- ${c.context}: ${c.pick ? bank.tone.styles[c.pick] : c.shaky ? "흔들림(" + c.picks.map(x => bank.tone.styles[x]).join("·") + ")" : "-"}`));
console.log(`\n## 거슬린다고 한 것`);
const dis = res.ox.filter(o => o.dislike);
console.log(dis.length ? dis.map(o => "- " + o.text).join("\n") : "- 없음");
if (res.open.length) {
  console.log(`\n## 직접 적은 말 (AI가 읽고 지침 후보로 바꿀 것)`);
  res.open.forEach(o => console.log(`- [${o.id}] ${o.text}`));
}
if (res.unsure.length) {
  console.log(`\n## 고르지 못한 문항 (점수에 넣지 않음)`);
  res.unsure.forEach(u => console.log(`- [${u.id}] ${u.kind}${u.prompt ? " — " + u.prompt : ""}${u.note ? `\n  고칠 말: ${u.note}` : ""}`));
}
const fu = res.followup, axName = id => (bank.axes.find(a => a.id === id) || { name: id }).name;
console.log(`\n## 추가 질문(4단계)`);
if (ans.round) console.log(`- 추가 질문 ${ans.round}차까지 마쳤다. 다시 권하지 않는다(남은 애매한 축은 지침에서 뺀다).`);
else {
  console.log(`- 권하는가: ${fu.recommend ? "예" : "아니오"}`);
  console.log(`- 애매한 축 ${fu.axes.length}개${fu.axes.length ? "(" + fu.axes.map(axName).join("·") + ")" : ""} / 고르지 못한 문항 ${fu.items}개`);
  console.log(`- 사용자의 선택: ${!fu.recommend ? "해당 없음" : ans.fu === "want" ? "추가 질문 받기" : ans.fu === "skip" ? "생략" : "아직 고르지 않음(물어본다)"}`);
}
if (res.unclear.length) { const deepIds = res.deep.map(d => d.id); console.log(`\n## 1차에서 애매했던 축(흔들림·가운데)\n` + res.unclear.map(a => `- ${a.name}(${a.grade === "낮음" ? "신뢰 낮음" : "가운데"})${deepIds.includes(a.id) ? " → 상황별 질문 결과로 지침에 들어감" : " → 지침에서 뺌"}`).join("\n")); }
console.log(res.overall === "참고용" ? `\n## 지침 초안\n신뢰도가 낮아 만들지 않습니다. 며칠 뒤 다시 해 보세요.` : `\n## 지침 초안\n${res.rules}`);

const save = opt("--save");
if (save) { fs.writeFileSync(save, JSON.stringify(ans, null, 1)); console.log(`\n답 저장: ${save}`); }
const cmp = opt("--compare");
if (cmp) {
  const old = S.score(bank, readAnswers(cmp));
  const c = S.compare(old, res);
  console.log(`\n## 지난 결과(${old.date})와 비교\n- 축 점수 상관 ${f(c.r)} · 방향이 같은 축 ${c.same}/${c.total}`);
  c.changed.forEach(x => console.log(`- 바뀜: ${x.name} ${x.before} → ${x.after}`));
}

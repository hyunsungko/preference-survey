// test.js — 가상 응답자로 채점·신뢰도 장치·심층 설문·용어 고르기·용어 지키기 훅·반영(apply)을 시험한다.  node test.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const S = require("./score.js");
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "items.json"), "utf8"));
bank.deep = JSON.parse(fs.readFileSync(path.join(__dirname, "deep.json"), "utf8"));
bank.lex = JSON.parse(fs.readFileSync(path.join(__dirname, "lex.json"), "utf8"));
const PTS = bank.slider_points || 7, MIDP = (PTS + 1) / 2;

let seed = 7;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function sides() {
  const out = {};
  bank.axes.forEach(ax => {
    const s1 = rnd() < 0.5 ? 0 : 1;
    bank.ab.filter(i => i.axis === ax.id).forEach(i => { out[i.id] = i.set === "a1r" ? 1 - s1 : (i.set === "a1" ? s1 : (rnd() < 0.5 ? 0 : 1)); });
  });
  return out;
}
function toR(want, side) {
  const v = side === 0 ? want : -want;
  if (v >= 0.75) return 2; if (v > 0) return 1; if (v <= -0.75) return -2; return -1;
}
const clampSl = v => Math.min(PTS, Math.max(1, Math.round(v)));

function respondent(kind, profile) {
  const sd = sides(), ans = { v: bank.version, d: "2026-10-02T12:00", ab: {}, tone: {}, ox: {}, sl: {}, deep: {}, open: {} };
  bank.ab.forEach(it => {
    const side = sd[it.id], want = profile[it.axis];
    let r;
    if (kind === "consistent") r = toR(want + (rnd() - 0.5) * 0.3, side);
    else if (kind === "random") r = pick([-2, -1, 1, 2]);
    else if (kind === "rightOnly") r = 2;
    else if (kind === "sayDiff") r = toR(want, side);
    else if (kind === "longLover" || kind === "shortLover") {
      const dl = it.right.length - it.left.length, pick = dl >= 2 ? 1 : dl <= -2 ? -1 : (rnd() < 0.5 ? -0.5 : 0.5);
      r = toR(kind === "longLover" ? pick : -pick, side);
    }
    ans.ab[it.id] = { s: side, r, t: kind === "random" ? 600 : 6000 };
  });
  bank.axes.forEach(ax => {
    const want = profile[ax.id];
    let sl = MIDP + (MIDP - 1) * want;
    if (kind === "random") sl = 1 + Math.floor(rnd() * PTS);
    if (kind === "longLover" || kind === "shortLover") sl = MIDP;
    if (kind === "sayDiff" && ["length", "explain"].includes(ax.id)) sl = MIDP - (MIDP - 1) * want;
    ans.sl[ax.id] = clampSl(sl);
  });
  bank.tone.items.forEach(it => { ans.tone[it.id] = { c: kind === "random" ? pick(Object.keys(bank.tone.styles)) : "formal", t: 4000 }; });
  bank.ox.forEach((o, i) => { ans.ox[o.id] = kind === "random" ? (rnd() < 0.5 ? 1 : 0) : (i < 3 ? 1 : 0); });
  ans.att = { s: 0, r: kind === "random" ? pick([-2, -1, 1, 2]) : kind === "rightOnly" ? 2 : 1, t: 3000 };
  return ans;
}

const profile = { length: -0.9, order: -1, autonomy: 0.7, format: -0.6, report: 0.8, emoji: -1, hedge: -0.7, explain: 0.5, pushback: 0.9, options: -0.6, jargon: -1 };
let fail = 0;
function check(name, cond) { console.log((cond ? "  통과 " : "  실패 ") + name); if (!cond) fail++; }

["consistent", "random", "rightOnly", "sayDiff", "longLover", "shortLover"].forEach(kind => {
  const ans = respondent(kind, profile);
  const res = S.score(bank, ans);
  const rel = res.reliability;
  console.log(`\n[${kind}] 종합 ${res.overall} · 반분 ${rel.splitHalf === null ? "-" : rel.splitHalf.toFixed(2)} · 재검사 일치 ${(rel.retestAgree * 100).toFixed(0)}% · 나 ${(rel.rightShare * 100).toFixed(0)}% · 긴 쪽 ${rel.longShare === null ? "-(문항 " + rel.longN + ")" : (rel.longShare * 100).toFixed(0) + "%"} · 집중 ${rel.attention}`);
  console.log("  축:", res.axes.map(a => `${a.id}=${a.F.toFixed(2)}/${a.grade}`).join(" "));
  check("모든 축 점수가 -1~1 안", res.axes.every(a => a.F >= -1 && a.F <= 1));
  if (kind === "consistent") {
    check("종합이 믿을 만함", res.overall === "믿을 만함");
    check("모든 축 방향이 프로필과 같음", res.axes.every(a => a.dir === Math.sign(profile[a.id])));
    check("지침 줄 = 말투1 + 축11 + 싫은 것3", res.rules.split("\n").filter(l => l.startsWith("- ")).length === 15);
  }
  if (kind === "random") check("무작위는 참고용", res.overall === "참고용");
  if (kind === "rightOnly") { check("위치 치우침 감지", rel.posBias === true); check("집중 문항 실패", rel.attention === false); }
  if (kind === "sayDiff") check("말과 선택이 다른 축 2개 감지(length, explain)", res.sayDiff.map(a => a.id).sort().join() === "explain,length");
  if (kind === "longLover" || kind === "shortLover") {
    check(`길이만 보고 고른 사람(${kind}): 쏠림 감지(${rel.longSide}, ${(rel.longShare * 100).toFixed(0)}%, 문항 ${rel.longN})`, rel.longBias === true && rel.longSide === (kind === "longLover" ? "long" : "short"));
    check(`길이만 보고 고른 사람(${kind}): 믿을 만함이 아님(지금 ${res.overall})`, res.overall !== "믿을 만함");
    const EX = ["length", "emoji", "order", "hedge"], L = x => [...x].length;
    const want = bank.ab.filter(i => !EX.includes(i.axis) && Math.abs(L(i.right) - L(i.left)) >= 2).length;
    check(`긴 답 쏠림은 방향 규칙에서 뺀 축(이모지·결론 순서·단정)을 세지 않음(${rel.longN}문항 = ${want})`, rel.longN === want);
  }
});

const shaky = respondent("consistent", profile);
const it = bank.ab.find(i => i.axis === "length" && i.set === "a2");
shaky.ab[it.id].r = -shaky.ab[it.id].r;
console.log("");
check("엇갈린 축에 확인 문항 요청", S.needsReserve(bank, shaky, "length") === true);
check("일관된 축에는 요청 안 함", S.needsReserve(bank, shaky, "order") === false);

const c = S.compare(S.score(bank, respondent("consistent", profile)), S.score(bank, respondent("consistent", profile)));
check(`같은 사람 두 번: 상관 ${c.r.toFixed(2)}, 바뀐 축 ${c.changed.length}`, c.r > 0.8 && c.changed.length <= 1);

// 심층: 묻기와 진행 — 작은 일은 알아서(+), 밖으로 나가는 일·돈 드는 일은 먼저 묻기(-)
const deepAns = respondent("consistent", profile);
const want = { small: 0.9, outside: -0.9, money: -0.9 };
bank.deep.items.filter(i => i.axis === "autonomy").forEach(i => { const s = rnd() < 0.5 ? 0 : 1; deepAns.deep[i.id] = { s, r: toR(want[i.sit], s), t: 6000 }; });
deepAns.open["open.autonomy"] = "작은 건 알아서, 보내기·결제는 먼저 물어봐";
const dres = S.score(bank, deepAns);
const da = dres.deep.find(d => d.id === "autonomy");
check("심층: 상황 3개 점수", da && da.situations.length === 3);
check("심층: 상황마다 방향이 달라 상황별 규칙 3줄", da && !da.sameAll && da.rules.length === 3);
check("심층: 지침 초안에 상황별 규칙이 들어감", dres.rules.includes("[묻기와 진행] 상황에 따라") && dres.rules.includes("밖으로 나가는 일"));
check("심층: 1차의 '알아서 진행' 한 줄은 상황별 규칙으로 바뀜", !dres.rules.split("\n").includes("- " + bank.axes.find(a => a.id === "autonomy").rule_right));
check("주관식이 결과에 실림", dres.open.length === 1 && dres.open[0].id === "open.autonomy");

// v1.0 결과(직접 답하기 7점)는 7점으로 읽는다
const old = respondent("consistent", profile); old.v = "1.0"; old.sl.length = 7;
const oldLen = S.score(bank, old).axes.find(a => a.id === "length");
check(`v1.0 답의 직접 답하기 7점 = +1 (지금 ${oldLen.S})`, oldLen.S === 1);

// 결과 코드: 압축(PS2)을 decode.js가 푼다
const code = "PS2." + zlib.deflateRawSync(Buffer.from(JSON.stringify(deepAns))).toString("base64");
const out = execFileSync(process.execPath, [path.join(__dirname, "decode.js"), code], { encoding: "utf8" });
check(`PS2 결과 코드 풀기(코드 ${code.length}자)`, out.includes("상황별") && out.includes("밖으로 나가는 일"));

// v1.2: 잘 모르겠다·둘 다 싫다
console.log("\n[잘 모르겠다·둘 다 싫다]");
const un = respondent("consistent", profile);
const o1 = bank.ab.find(i => i.axis === "options" && i.set === "a1"), o2 = bank.ab.find(i => i.axis === "options" && i.set === "a2");
un.ab[o1.id] = { s: un.ab[o1.id].s, r: 0, u: 1, t: 5000 };
un.ab[o2.id] = { s: un.ab[o2.id].s, r: 0, x: 1, note: "둘 다 길어요. 추천 하나만 주세요", t: 7000 };
un.tone["tone.chat"] = { c: "none", note: "존댓말이되 짧게", t: 4000 };
un.ox[bank.ox[4].id] = 2;
const ur = S.score(bank, un);
const oax = ur.axes.find(a => a.id === "options");
check("고르지 않은 문항은 축 점수에서 빠짐(선택지 축 2문항만 계산)", oax.n === 2 && oax.unsureN === 1 && oax.bothBadN === 1);
check("고르지 못한 문항 2개면 애매한 축으로", oax.unclear === true && !ur.rules.includes(oax.rule || "없음"));
check("고르지 못한 문항 4개 모음(잘 모르겠다·둘 다 싫다·말투 모두 별로·싫은 것 잘 모르겠다)", ur.unsure.length === 4);
check("둘 다 싫다의 고칠 말이 실림", ur.unsure.some(u => u.kind === "둘 다 싫다" && u.note.includes("추천 하나")));
check("말투 '모두 별로'는 고른 말투로 세지 않음", !ur.tone.picks["tone.chat"]);
check("싫은 것 '잘 모르겠다'는 거슬린다로 세지 않음", ur.ox[4].dislike === false);
check("추가 질문 권함(선택지 축)", ur.followup.recommend && ur.followup.axes.includes("options"));
check("잘 모르겠다로 넘긴 축은 확인 문항(a3)을 더 물음", S.needsReserve(bank, un, "options") === true);
const many = respondent("consistent", profile);
bank.ab.filter(i => i.set !== "a3").slice(0, 16).forEach(i => { many.ab[i.id] = { s: many.ab[i.id].s, r: 0, u: 1, t: 4000 }; });
const mr = S.score(bank, many);
check(`'잘 모르겠다'가 30% 넘으면 믿을 만함을 주지 않음(${(mr.reliability.unsureShare * 100).toFixed(0)}%, ${mr.overall})`, mr.reliability.unsureShare > 0.3 && mr.overall !== "믿을 만함");
check("상황별 질문으로 풀린 축은 추가 질문에서 뺌", (() => {
  const a = JSON.parse(JSON.stringify(deepAns)); a.ab[bank.ab.find(i => i.axis === "autonomy" && i.set === "a1").id].r = 0;
  a.ab[bank.ab.find(i => i.axis === "autonomy" && i.set === "a2").id].r = 0;
  const r = S.score(bank, a); return r.axes.find(x => x.id === "autonomy").unclear && !r.followup.axes.includes("autonomy");
})());

const two = respondent("consistent", profile);
bank.deep.items.filter(i => i.axis === "autonomy" && i.sit !== "money").forEach(i => { two.deep[i.id] = { s: 0, r: -2, t: 6000 }; });
const twoD = S.score(bank, two).deep.find(d => d.id === "autonomy");
check("상황 2개만 답하면 '상황과 관계없이 같음'으로 묶지 않음", twoD && !twoD.sameAll && /아래 상황에서는/.test(twoD.head) && twoD.rules.length === 2);
const one = respondent("consistent", profile); const sk1 = bank.ab.find(i => i.axis === "order" && i.set === "a1");
one.ab[sk1.id] = { s: one.ab[sk1.id].s, r: 0, u: 1, t: 4000 };
check("재검사 짝(a1)을 건너뛰면 신뢰 '높음'을 주지 않음", S.score(bank, one).axes.find(a => a.id === "order").grade !== "높음");

// 사용자별 문항 은행: --init → 고치기 → build 검사 → 추가 질문 설문(--resume)
console.log("\n[사용자별 문항 은행]");
const os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pref-"));
const node = args => { const r = require("child_process").spawnSync(process.execPath, args, { encoding: "utf8" }); return { out: r.stdout + r.stderr, code: r.status }; };
const B_ = path.join(__dirname, "build.js"), pb = path.join(tmp, "bank");
node([B_, "--init", pb]);
const pItems = JSON.parse(fs.readFileSync(path.join(pb, "items.json"), "utf8"));
check("init: 문항 은행 id가 생김", /^p-/.test(pItems.id));
const writeItems = o => fs.writeFileSync(path.join(pb, "items.json"), JSON.stringify(o));
const bad1 = JSON.parse(JSON.stringify(pItems)); bad1.ab[0].prompt = "010-1234-5678로 전화해 줘";
writeItems(bad1);
check("문항에 전화번호가 들어가면 build가 막음", node([B_, "--bank", pb]).out.includes("7자리 이상 숫자"));
const bad2 = JSON.parse(JSON.stringify(pItems)); bad2.axes = bad2.axes.filter(a => a.id !== "jargon"); bad2.ab = bad2.ab.filter(i => i.axis !== "jargon");
writeItems(bad2);
check("기본 축을 지우면 build가 막음", node([B_, "--bank", pb]).out.includes("기본 축 jargon"));
const bad3 = JSON.parse(JSON.stringify(pItems)); bad3.ab.filter(i => i.axis === "report").forEach(i => { i.context = "보고"; });
writeItems(bad3);
check("한 축의 상황이 한 가지뿐이면 build가 막음", node([B_, "--bank", pb]).out.includes("report: 상황(context)이 1가지"));
writeItems(pItems);
check("고치지 않은 은행은 통과", node([B_, "--bank", pb]).code === 0 && fs.existsSync(path.join(pb, "survey.html")));
check("이미 있는 폴더에 --init하면 덮어쓰지 않고 알림", node([B_, "--init", pb]).out.includes("이미 있습니다"));
const bad4 = JSON.parse(JSON.stringify(pItems)); const a1 = bad4.ab.find(i => i.id === "length.1"), a1r = bad4.ab.find(i => i.id === "length.1r"); Object.assign(a1r, { prompt: a1.prompt, left: a1.left, right: a1.right });
writeItems(bad4);
check("a1r이 a1과 같은 글이면 build가 막음", node([B_, "--bank", pb]).out.includes("length.1r: a1과 같은 글"));
writeItems(pItems);
const pDeep = JSON.parse(fs.readFileSync(path.join(pb, "deep.json"), "utf8"));
pDeep.situations.options.push({ id: "boss", name: "윗사람에게 올릴 안" });
pDeep.items.push(
  { id: "options@boss.1", axis: "options", sit: "boss", context: "보고", prompt: "회의 장소 정해 줘.", left: "대회의실로 하시죠. 열두 명이 다 앉습니다.", right: "대회의실(열두 명)과 세미나실(열 명)이 비어요." },
  { id: "options@boss.2", axis: "options", sit: "boss", context: "보고", prompt: "보고서 표지 색 정해 줘.", left: "남색으로 하시죠. 서식과 맞습니다.", right: "남색과 회색이 회사 서식에 맞습니다." }
);
pDeep.followup = { round: 2, ask: ["options@boss.1", "options@boss.2"], open: [{ id: "f.options", text: "선택지는 몇 개가 좋습니까?" }] };
fs.writeFileSync(path.join(pb, "deep.json"), JSON.stringify(pDeep));
check("추가 질문 문항도 길이 방향을 검사(.2가 왼쪽이 길지 않으면 막음)", node([B_, "--bank", pb]).out.includes("options@boss.2"));
pDeep.items[pDeep.items.length - 1].left = "남색으로 하시죠. 회사 서식과 잘 맞습니다.";
pDeep.items[pDeep.items.length - 1].right = "남색과 회색 모두 회사 서식에 맞습니다.";
fs.writeFileSync(path.join(pb, "deep.json"), JSON.stringify(pDeep));
check("추가 질문이 한 축에 상황 1개뿐이면 막음", node([B_, "--bank", pb]).out.includes("추가 질문 options: 상황이 1개"));
pDeep.situations.options.push({ id: "peer", name: "동료와 정할 일" });
pDeep.items.push(
  { id: "options@peer.1", axis: "options", sit: "peer", context: "점심", prompt: "점심 메뉴 정해 줘.", left: "점심은 김치찌개로 하시죠. 가깝습니다.", right: "김치찌개(가까움)와 국수(빠름)가 있어요." },
  { id: "options@peer.2", axis: "options", sit: "peer", context: "회의", prompt: "회의록 양식 정해 줘.", left: "회의록은 표로 하시죠. 찾기가 쉽습니다.", right: "회의록은 표나 문장 다 괜찮습니다." }
);
pDeep.followup.ask.push("options@peer.1", "options@peer.2");
fs.writeFileSync(path.join(pb, "deep.json"), JSON.stringify(pDeep));
const r1 = JSON.parse(JSON.stringify(un)); r1.b = pItems.id;
const r1code = "PS2." + zlib.deflateRawSync(Buffer.from(JSON.stringify(r1))).toString("base64");
const rb = node([B_, "--bank", pb, "--resume", r1code]);
const r2html = path.join(pb, "survey_r2.html");
check(`추가 질문 설문을 만듦(${rb.code === 0 ? "성공" : rb.out.trim()})`, rb.code === 0 && fs.existsSync(r2html));
const other = JSON.parse(JSON.stringify(un)); other.b = "p-남의은행";
const ob = node([B_, "--bank", pb, "--resume", "PS2." + zlib.deflateRawSync(Buffer.from(JSON.stringify(other))).toString("base64"), "--out", path.join(tmp, "x.html")]);
check("다른 은행의 1차 답이면 추가 설문을 만들지 않음", ob.code !== 0 && !fs.existsSync(path.join(tmp, "x.html")));
check("추가 질문 설문에 1차 답이 들어 있음", fs.existsSync(r2html) && fs.readFileSync(r2html, "utf8").includes(`var PRIOR = {"v":`));
const wrong = JSON.parse(JSON.stringify(un)); wrong.b = "p-다른은행";
check("--bank 없이 사용자 은행의 답을 풀면 알림", node([path.join(__dirname, "decode.js"), (fs.writeFileSync(path.join(tmp, "p.json"), JSON.stringify(r1)), path.join(tmp, "p.json"))]).out.includes("문항 은행 '" + pItems.id + "'"));
check("다른 은행의 답이면 decode가 알림", node([path.join(__dirname, "decode.js"), JSON.stringify(wrong).length ? (fs.writeFileSync(path.join(tmp, "w.json"), JSON.stringify(wrong)), path.join(tmp, "w.json")) : "", "--bank", pb]).out.includes("문항 은행 'p-다른은행'"));

// 1단계 수집: 사람이 친 말과 주인의 채널 메시지만, 비밀은 빼고
console.log("\n[1단계 수집]");
const cd = path.join(tmp, "claude"), pj = path.join(cd, "projects", "p1");
fs.mkdirSync(path.join(pj, "memory"), { recursive: true });
const now = Date.now(), iso = new Date(now).toISOString();
fs.writeFileSync(path.join(cd, "history.jsonl"), [
  { display: "앞으로 답은 짧게 써. 장황하게 늘어놓지 마", timestamp: now },
  { display: "비밀번호 알려 줄 테니 앞으로 이걸로 로그인하지 마", timestamp: now },
  { display: "/login", timestamp: now },
  { display: "내 비번은 hunter2야 앞으로 이걸로 로그인해서 확인하고 짧게 보고해줘", timestamp: now },
  { display: "PIN 번호 1234 말고 다른 걸로 하고 앞으로 짧게 보고해", timestamp: now },
  { display: "앞으로 ghp_AbCdEfGhIjKlMnOpQrStUv123456 이건 쓰지 마 짧게", timestamp: now },
  { display: "앞으로 이 값 ZXCVBNMASDFGHJKLQWERTY12 쓰지 말고 짧게 답해", timestamp: now }
].map(o => JSON.stringify(o)).join("\n"));
const u = (text, extra) => JSON.stringify(Object.assign({ type: "user", timestamp: iso, message: { role: "user", content: text } }, extra || {}));
fs.writeFileSync(path.join(pj, "s1.jsonl"), [
  u("표로 정리하지 마. 문장으로 써 줘 제발", { origin: { kind: "human" } }),
  u('<channel source="plugin:telegram:telegram" chat_id="1" user="a" user_id="111" ts="x">왜 확인도 안 하고 보고해? 앞으로 확인하고 말해</channel>', { isMeta: true, origin: { kind: "channel" } }),
  u('<channel source="plugin:telegram:telegram" chat_id="1" user="b" user_id="222" ts="x">이건 다른 사람이 쓴 말인데 말투가 싫어</channel>', { isMeta: true, origin: { kind: "channel" } }),
  u("Another Claude session sent a message: 앞으로 짧게 보고하지 마", { origin: { kind: "peer" } }),
  u('<channel source="t" chat_id="2" user="a" user_id="111" ts="x">앞으로 목록 말고 문장으로 써</channel>\n<channel source="t" chat_id="2" user="b" user_id="222" ts="x">항상 같은 말 반복하지 마 짜증나</channel>', { isMeta: true, origin: { kind: "channel" } }),
  u('<pasted_content id="ab">동료: 앞으로 항상 이모지 쓰지 마</pasted_content> 이거 참고해서 정리해줘 짧게 말고 자세히', { origin: { kind: "human" } }),
  u('앞으로 결론 먼저 말해 <system-reminder>앞으로 말투는 반말로 하지 마</system-reminder>', { origin: { kind: "human" } }),
  u("응답 시간 측정해서 알려 줘", { origin: { kind: "human" } }),
  JSON.stringify({ type: "assistant", timestamp: iso, message: { role: "assistant", content: [{ type: "text", text: "세 축으로 나눠 재 보니 이렇습니다." }] } })
].join("\n"));
fs.writeFileSync(path.join(pj, "memory", "feedback_x.md"), "---\nname: x\ndescription: 용어를 지어내지 않는다\nmetadata:\n  type: feedback\n---\n본문");
fs.writeFileSync(path.join(cd, "CLAUDE.md"), "## 대화 선호\n- 내 비번 pass123! 기억해\n- 결론 먼저 쓴다.\n");
const gone = path.join(tmp, "gone"); fs.mkdirSync(gone);
try { fs.symlinkSync(gone, path.join(cd, "projects", "dangling"), "junction"); } catch (e) { console.log("  (정션을 만들지 못해 끊어진 정션 시험은 건너뜀)"); }
fs.rmSync(gone, { recursive: true, force: true });
const sigDir = path.join(tmp, "sig");
node([path.join(__dirname, "collect.js"), "--claude-dir", cd, "--out", sigDir, "--owner", "111", "--project", tmp]);
const sig = JSON.parse(fs.readFileSync(path.join(sigDir, "signals.json"), "utf8"));
const saidText = sig.said.map(s => s.text).join(" | ");
check("터미널에서 친 말을 모음", saidText.includes("장황하게") && saidText.includes("표로 정리하지 마"));
check("주인이 보낸 채널 메시지를 모음", saidText.includes("확인도 안 하고"));
check("다른 사람이 보낸 채널 메시지는 뺌(한 턴에 묶여 와도)", !saidText.includes("다른 사람이 쓴") && !saidText.includes("짜증나") && saidText.includes("목록 말고") && sig.counts.channelSkipped === 2);
check("붙여 넣은 남의 글과 시스템 알림은 뺌", !saidText.includes("이모지") && !saidText.includes("반말") && saidText.includes("짧게 말고 자세히") && saidText.includes("결론 먼저"));
check("비번·PIN·토큰이 든 문장은 뺌", !/hunter2|1234|ghp_|비번|PIN/.test(saidText));
check("키워드 없는 긴 영숫자 덩어리는 가림", !saidText.includes("ZXCVBNM") && saidText.includes("[가림]"));
check("지난 진단 결과의 비밀 줄도 뺌", sig.prevResult && !JSON.stringify(sig.prevResult).includes("pass123") && JSON.stringify(sig.prevResult).includes("결론 먼저"));
check("끊어진 정션이 있어도 수집이 끝까지 감", fs.existsSync(path.join(sigDir, "signals.md")));
check("다른 세션이 보낸 말은 뺌", !saidText.includes("Another Claude"));
check("비밀번호가 든 문장은 뺌", !saidText.includes("비밀번호"));
check("용어: 사람이 쓴 말과 AI가 쓴 말을 따로 셈", sig.lexUsage.user.measure["측정하다"] === 1 && sig.lexUsage.ai.measure["재다"] === 1 && sig.lexUsage.ai.axis["축"] === 1 && !(sig.lexUsage.user.axis || {})["축"]);
check("AI가 쓴 글은 모으지 않음(횟수만)", !saidText.includes("재 보니"));
check("피드백 기억을 모음", sig.feedback.length === 1 && sig.feedback[0].text.includes("지어내지"));
const emptyDir = path.join(tmp, "empty"); fs.mkdirSync(path.join(emptyDir, "projects"), { recursive: true });
node([path.join(__dirname, "collect.js"), "--claude-dir", emptyDir, "--out", path.join(tmp, "sig0"), "--project", emptyDir]);
check("근거가 없으면 기본 문항을 쓰라고 적음", fs.readFileSync(path.join(tmp, "sig0", "signals.md"), "utf8").includes("근거 없음"));

// 용어 고르기: 읽기·쓰기에서 고른 말, 거슬림 표시, 기록의 사용 횟수, 직접 적은 말 → 바꿔 쓸 말
console.log("\n[용어 고르기]");
const LX = bank.lex;
const lexAns = picks => { const a = respondent("consistent", profile); a.lex = {}; Object.keys(picks).forEach(id => { a.lex[id] = picks[id]; }); return a; };
const la = lexAns({
  "measure.r": { c: "측정하다", x: ["재다"], t: 3000 }, "measure.s": { c: "측정하다", x: [], t: 3000 },
  "axis.r": { c: "기준", x: [], t: 3000 }, "axis.s": { c: "기준", x: [], t: 3000 },
  "point.r": { c: "지적하다", x: [], t: 3000 }, "point.s": { c: "언급하다", x: [], t: 3000 },
  "surface.r": { c: "나타나다", x: ["보이다"], t: 3000 }, "surface.s": { c: "any", x: [], t: 3000 },
  "look.r": { c: "살펴보다", x: ["검토하다"], t: 3000 }, "look.s": { c: "살펴보다", x: ["검토하다"], t: 3000 }
});
la.open["lex.more"] = "재다 → 측정하다\n레버리지 → 활용\n컨펌 쓰지 마";
const lr = S.score(bank, la).lex;
const cOf = id => lr.concepts.find(c => c.id === id), avOf = w => lr.avoid.find(a => a.w === w);
check("읽기·쓰기 모두 같은 말이면 쓸 말(신뢰 높음)", cOf("measure").prefer === "측정하다" && cOf("measure").conf === "높음");
check("거슬린다고 한 AI 버릇 말은 막음(재다 → 측정하다)", avOf("재다") && avOf("재다").strong && avOf("재다").to === "측정하다");
check("거슬린다고 하지 않았어도 다른 말을 신뢰 높게 고른 묶음의 AI 버릇 말은 지침만(축 → 기준)", avOf("축") && !avOf("축").strong && avOf("축").to === "기준");
check("AI 버릇 말이 아닌 흔한 말은 고르지 않았다고 피하지 않음(확인하다)", !avOf("확인하다"));
check("읽기·쓰기가 엇갈리고 기록이 없으면 정하지 않음(흔들림)", cOf("point").prefer === null && /흔들림/.test(cOf("point").how) && lr.unclear.some(c => c.id === "point"));
const lrU = S.score(bank, la, { usage: { user: { point: { "지적하다": 4, "언급하다": 1 } } } }).lex;
check("엇갈려도 기록에서 실제로 더 자주 쓴 말이 있으면 그 말(신뢰 보통)", lrU.concepts.find(c => c.id === "point").prefer === "지적하다" && lrU.concepts.find(c => c.id === "point").conf === "보통");
check("한쪽만 고르고 다른 쪽은 '다 비슷하다'면 신뢰 보통", cOf("surface").prefer === "나타나다" && cOf("surface").conf === "보통");
check("흔한 말은 한 문항에서만 거슬린다고 하면 막지 않고 지침만(보이다)", avOf("보이다") && !avOf("보이다").strong);
check("흔한 말도 두 문항 모두 거슬린다고 하면 막음(검토하다)", avOf("검토하다") && avOf("검토하다").strong);
check("직접 적은 말: '바꿀 말 → 쓸 말'과 '쓰지 마'를 읽어 막음", avOf("레버리지") && avOf("레버리지").to === "활용" && avOf("레버리지").strong && avOf("컨펌") && avOf("컨펌").to === null);
check("직접 적은 말이 묶음에 있는 말이면 그 활용형으로 찾음", avOf("재다").forms.includes("잰 "));
const lrules = S.score(bank, la).rules;
check("지침 초안에 용어 규칙이 들어감", lrules.includes("- 용어: 아래 말은 바꿔 쓴다") && lrules.includes("  - '재다' → '측정하다'"));
check("고른 말을 같은 문항에서 거슬린다고도 누르면 거슬림에서 뺌", (() => { const a = lexAns({ "measure.r": { c: "재다", x: ["재다"], t: 3000 } }); return !S.score(bank, a).lex.avoid.some(v => v.w === "재다"); })());
check("용어 답이 없으면 용어 규칙도 없음", !S.score(bank, respondent("consistent", profile)).rules.includes("용어:"));

// 용어 지키기 훅
console.log("\n[용어 지키기 훅]");
const G = require("./lex_guard.js");
const blockList = [{ w: "재다", to: "측정하다", forms: LX.concepts[0].options[0].forms }, { w: "축", to: "기준", forms: LX.concepts[2].options[0].forms }, { w: "~을 통해", to: "~(으)로", forms: LX.concepts[11].options[0].forms }];
check("활용형을 찾음(재 보니·잰·쟀다)", ["시간을 재 보니 2초", "따로 잰 결과", "어제 쟀다"].every(t => G.findHits(t, blockList).length === 1));
check("다른 낱말 안의 같은 글자는 찾지 않음(현재는·재고·축하·축의금·건축)", ["현재는 괜찮다", "재고가 남았다", "생일 축하해요", "축의금을 냈다", "건축 허가"].every(t => !G.findHits(t, blockList).length));
check("인용·코드·링크·'>' 인용 줄 안의 말은 찾지 않음", !G.findHits("'재다'는 쓰지 않는다. `축으로` 코드\n> 세 축으로 봤다\n\"재 보니\" https://x.y/축으로", blockList).length);
check("앞말에 붙는 꼴(~을 통해)을 찾음", G.findHits("설문을 통해 모았다", blockList).length === 1);
const preMd = G.run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/w/보고.md", content: "가격, 속도 세 축으로 봤습니다." } }, { block: blockList });
check("글 파일에 막을 말을 쓰면 막고(exit 2) 바꿀 말을 알려 줌", preMd.code === 2 && preMd.stderr.includes("'기준'") && preMd.stderr.includes("축으로"));
check("코드 파일은 검사하지 않음", G.run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/w/a.js", content: "// 세 축으로" } }, { block: blockList }).code === 0);
check("Edit·MultiEdit은 새로 쓰는 글만 봄", G.run({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/w/a.md", old_string: "세 축으로", new_string: "세 기준으로" } }, { block: blockList }).code === 0 &&
  G.run({ hook_event_name: "PreToolUse", tool_name: "MultiEdit", tool_input: { file_path: "/w/a.md", edits: [{ old_string: "x", new_string: "열 번 재 보니" }] } }, { block: blockList }).code === 2);
check("skipPaths(이 스킬 폴더)는 검사하지 않음", G.run({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/h/.claude/skills/preference-survey/설계.md", content: "세 축으로" } }, { block: blockList, skipPaths: ["/.claude/skills/preference-survey/"] }).code === 0);
const tr = path.join(tmp, "tr.jsonl");
const trLine = (type, content, extra) => JSON.stringify(Object.assign({ type, message: { role: type, content } }, extra || {}));
fs.writeFileSync(tr, [
  trLine("user", "지난 질문"), trLine("assistant", [{ type: "text", text: "예전 답: 세 축으로 봤습니다." }]),
  trLine("user", "이번 질문"), trLine("assistant", [{ type: "text", text: "확인하겠습니다." }, { type: "tool_use", id: "1", name: "Read", input: {} }]),
  trLine("user", [{ type: "tool_result", tool_use_id: "1", content: "..." }]), trLine("assistant", [{ type: "text", text: "열 번 재 보니 평균 2초였습니다." }])
].join("\n"));
const stop = G.run({ hook_event_name: "Stop", transcript_path: tr, stop_hook_active: false }, { block: blockList });
const stopJ = stop.stdout ? JSON.parse(stop.stdout) : {};
check("채팅 답에 막을 말이 있으면 되돌려 다시 쓰게 함(Stop decision=block)", stopJ.decision === "block" && stopJ.reason.includes("'측정하다'"));
check("이번 턴의 답만 봄(지난 턴의 '축으로'는 안 봄)", !stopJ.reason.includes("축으로"));
check("이미 한 번 되돌렸으면(stop_hook_active) 다시 막지 않음", G.run({ hook_event_name: "Stop", transcript_path: tr, stop_hook_active: true }, { block: blockList }).code === 0 && !G.run({ hook_event_name: "Stop", transcript_path: tr, stop_hook_active: true }, { block: blockList }).stdout);
check("chat: warn이면 알리기만 함", JSON.parse(G.run({ hook_event_name: "Stop", transcript_path: tr }, { block: blockList, chat: "warn" }).stdout).systemMessage.includes("재"));
check("질문마다 바꿔 쓸 말을 일러 줌(UserPromptSubmit)", G.run({ hook_event_name: "UserPromptSubmit" }, { block: blockList, soft: [{ w: "인사이트", to: "시사점" }] }).stdout.includes("재다→측정하다, 축→기준, ~을 통해→~(으)로, 인사이트→시사점"));

// 용어 문항 검사(build.js)
console.log("\n[용어 문항 검사]");
const writeLex = o => fs.writeFileSync(path.join(pb, "lex.json"), JSON.stringify(o));
const pLex = JSON.parse(fs.readFileSync(path.join(pb, "lex.json"), "utf8"));
const bl1 = JSON.parse(JSON.stringify(pLex)); bl1.items[0].texts["재다"] = "앱이 뜨는 시간을 열 번 달아 보니 평균 2초였습니다.";
writeLex(bl1);
check("문장에 그 말의 꼴이 없으면 build가 막음", node([B_, "--bank", pb]).out.includes("measure.r: '재다' 문장에 그 말의 꼴"));
const bl2 = JSON.parse(JSON.stringify(pLex)); bl2.items[0].texts["측정하다"] = "앱이 뜨는 시간을 열 번 재 보니 측정 결과 평균 2초였습니다.";
writeLex(bl2);
check("문장이 다른 말의 꼴에도 걸리면 build가 막음", node([B_, "--bank", pb]).out.includes("'측정하다' 문장이 다른 말 '재다'의 꼴"));
const bl3 = JSON.parse(JSON.stringify(pLex)); bl3.concepts[2].options[0].forms.push("축");
writeLex(bl3);
check("한 글자 꼴은 build가 막음", node([B_, "--bank", pb]).out.includes("꼴 '축'가 너무 짧음"));
const bl4 = JSON.parse(JSON.stringify(pLex)); bl4.concepts[2].options[0].forms.push("축하");
writeLex(bl4);
check("걸리면 안 되는 문장(neg)에 꼴이 걸리면 build가 막음", node([B_, "--bank", pb]).out.includes("생일 축하합니다"));
const bl5 = JSON.parse(JSON.stringify(pLex)); bl5.items[1].context = bl5.items[0].context;
writeLex(bl5);
check("읽기·쓰기 문항의 상황이 같으면 build가 막음", node([B_, "--bank", pb]).out.includes("measure: 읽기·쓰기 문항의 상황"));
writeLex(pLex);

// 반영: 출력 스타일·용어 훅·CLAUDE.md를 실제로 써 본다(임시 폴더)
console.log("\n[반영(apply)]");
const ap = path.join(tmp, "apply"); fs.mkdirSync(ap);
const setP = path.join(ap, "settings.json"), mdP = path.join(ap, "CLAUDE.md"), hd = path.join(ap, "hooks"), sd = path.join(ap, "styles");
fs.writeFileSync(setP, JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo other" }] }] }, outputStyle: "Explanatory" }));
const laFile = path.join(ap, "ans.json"); fs.writeFileSync(laFile, JSON.stringify(la));
const A_ = path.join(__dirname, "apply.js");
const apArgs = extra => [A_, laFile, "--claude-md", mdP, "--settings", setP, "--hooks-dir", hd, "--style-dir", sd, "--hook", path.join(ap, "none.py")].concat(extra);
const show = node(apArgs([]));
check("반영안에 출력 스타일·용어 훅·용어 줄([lex:말])이 나옴", show.code === 0 && show.out.includes("## 2. 맞춤 출력 스타일") && show.out.includes("## 3. 용어 지키기 훅") && show.out.includes("[lex:재다]"));
check("보여 주기만 하면 아무 파일도 고치지 않음", !fs.existsSync(mdP) && !fs.existsSync(hd) && JSON.parse(fs.readFileSync(setP, "utf8")).outputStyle === "Explanatory");
const w1 = node(apArgs(["--write", "--write-style", "--install-guard", "--skip", "lex:컨펌"]));
const cfg = JSON.parse(fs.readFileSync(setP, "utf8"));
check(`CLAUDE.md가 없으면 「대화 선호」 절만 든 파일을 만듦(${w1.code})`, fs.existsSync(mdP) && /^## 대화 선호/.test(fs.readFileSync(mdP, "utf8")) && fs.readFileSync(mdP, "utf8").includes("'재다' → '측정하다'"));
const styleTxt = fs.existsSync(path.join(sd, "preference.md")) ? fs.readFileSync(path.join(sd, "preference.md"), "utf8") : "";
check("출력 스타일 파일: 이름·코딩 지침 유지·규칙·용어가 들어감", /^---\nname: 선호 맞춤\n/.test(styleTxt) && styleTxt.includes("keep-coding-instructions: true") && styleTxt.includes("'레버리지' → '활용'"));
check("outputStyle을 맞춤 스타일로 바꿈", cfg.outputStyle === "선호 맞춤");
check("permissions와 다른 훅은 그대로 둠", JSON.stringify(cfg.permissions) === JSON.stringify({ allow: ["Bash(ls:*)"] }) && cfg.hooks.Stop.some(g => g.hooks.some(h => h.command === "echo other")));
check("훅 세 가지를 등록함(UserPromptSubmit·PreToolUse(Write|Edit|MultiEdit)·Stop)", ["UserPromptSubmit", "PreToolUse", "Stop"].every(ev => (cfg.hooks[ev] || []).some(g => g.hooks.some(h => h.command.includes("pref_lex_guard.js")))) && cfg.hooks.PreToolUse.find(g => g.hooks.some(h => h.command.includes("pref_lex_guard"))).matcher === "Write|Edit|MultiEdit");
const lexInst = JSON.parse(fs.readFileSync(path.join(hd, "pref_lexicon.json"), "utf8"));
check("--skip한 용어는 규칙 파일·CLAUDE.md에서 빠짐", !lexInst.block.some(a => a.w === "컨펌") && lexInst.block.some(a => a.w === "재다") && !fs.readFileSync(mdP, "utf8").includes("컨펌"));
check("고친 settings.json의 백업이 남음", fs.readdirSync(ap).some(f => f.startsWith("settings.json.bak-pref-")));
node(apArgs(["--install-guard"]));
const cfg2 = JSON.parse(fs.readFileSync(setP, "utf8"));
check("다시 넣어도 훅이 겹치지 않음", ["UserPromptSubmit", "PreToolUse", "Stop"].every(ev => cfg2.hooks[ev].filter(g => g.hooks.some(h => h.command.includes("pref_lex_guard.js"))).length === 1));
const runGuard = input => require("child_process").spawnSync(process.execPath, [path.join(hd, "pref_lex_guard.js")], { input: JSON.stringify(input), encoding: "utf8" });
const g1 = runGuard({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(ap, "메모.md"), content: "열 번 재 보니 2초" } });
check(`설치한 훅이 혼자 돌아 실제로 막음(exit ${g1.status})`, g1.status === 2 && g1.stderr.includes("측정하다"));
const g2 = require("child_process").spawnSync(process.execPath, [path.join(hd, "pref_lex_guard.js")], { input: "{깨진 JSON", encoding: "utf8" });
check("입력이 깨져도 세션을 막지 않음(exit 0)", g2.status === 0);
const g3 = require("child_process").spawnSync(process.execPath, [path.join(hd, "pref_lex_guard.js")], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "a.md", content: "재 보니" } }), encoding: "utf8", env: Object.assign({}, process.env, { PREF_LEX_OFF: "1" }) });
check("PREF_LEX_OFF=1이면 끔", g3.status === 0);
const badSet = path.join(ap, "bad.json"); fs.writeFileSync(badSet, "{ 깨짐");
check("settings.json을 읽지 못하면 고치지 않음", node([A_, laFile, "--claude-md", mdP, "--settings", badSet, "--hooks-dir", hd, "--style-dir", sd, "--write-style"]).code !== 0 && fs.readFileSync(badSet, "utf8") === "{ 깨짐");
fs.rmSync(tmp, { recursive: true, force: true });

console.log(fail ? `\n실패 ${fail}건` : "\n모두 통과");
process.exit(fail ? 1 : 0);

// collect.js — 1단계: 사용자가 그동안 AI에게 한 말과 지침·기억 파일에서 대화 선호의 근거를 모은다.
//   node collect.js --out <폴더> [--owner 텔레그램id,id] [--since 2026-04-01] [--max 120] [--project <폴더>]
//   --claude-dir <폴더>   ~/.claude 대신 읽을 곳(시험용)
//
// 읽는 곳
//   ~/.claude/history.jsonl          터미널에서 직접 친 말
//   ~/.claude/projects/*/*.jsonl      세션 기록. 사람이 친 말만 읽고, 채널(텔레그램 등) 메시지는 --owner로 준 id가 보낸 것만 읽는다.
//                                     다른 세션·하위 에이전트·예약 작업·시스템이 넣은 말, 붙여 넣은 남의 글(<pasted_content>)은 뺀다.
//   CLAUDE.md                         ~/.claude/CLAUDE.md, --project 폴더부터 위로 git 저장소 루트까지(홈 폴더 위로는 가지 않음)
//   ~/.claude/projects/*/memory/*.md  type이 feedback인 기억
// 쓰는 것: <폴더>/signals.md(AI가 읽고 설문을 짠다), <폴더>/signals.json
// 비밀번호·PIN·키·토큰 같은 말이 든 문장은 빼고, 메일·링크·4자리 이상 숫자·20자 이상 영숫자 덩어리는 가린다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
function fail(msg) { console.error(msg); process.exit(1); }
const CL = path.resolve(opt("--claude-dir", path.join(os.homedir(), ".claude")));
if (!fs.existsSync(CL)) fail(`읽을 폴더가 없습니다: ${CL}`);
const outDir = opt("--out");
if (!outDir) fail("--out <폴더>를 주세요.");
const owners = (opt("--owner", "") || "").split(",").map(s => s.trim()).filter(Boolean);
const sinceStr = opt("--since", ymd(Date.now() - 180 * 864e5));
const since = Date.parse(sinceStr);
if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceStr) || isNaN(since)) fail(`--since는 2026-04-01 같은 날짜여야 합니다: ${sinceStr}`);
const MAX = +opt("--max", 120);
if (!Number.isInteger(MAX) || MAX < 1) fail(`--max는 1 이상의 정수여야 합니다: ${opt("--max")}`);
const project = path.resolve(opt("--project", process.cwd()));

// 날짜는 이 PC의 현지 날짜로 쓴다
function ymd(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// 어느 축과 관련된 말인지 붙이는 표지
const TAGS = {
  length: /장황|길어|길게|짧게|간단히|간결|요약|핵심만|한 줄|늘어놓|길이/,
  order: /결론|먼저 말|핵심부터|두괄/,
  autonomy: /물어보|묻지|묻고|알아서|허락|승인|확인받|마음대로|맘대로|시키지도/,
  format: /표로|표를|표 |목록|불릿|글머리|문단/,
  report: /보고|과정|검증|확인했|확인 안|확인도/,
  emoji: /이모지|이모티콘|느낌표/,
  hedge: /단정|추측|확실|것 같|아마|모르면/,
  explain: /설명|이유|원리|왜 그런/,
  pushback: /반대|의견|토 달|반박|시킨 대로|시킨대로/,
  options: /선택지|대안|골라|추천/,
  jargon: /용어|어려운 말|쉽게|어렵|번역투|어색/,
  tone: /말투|반말|존댓|딱딱|친근|호칭/,
  honesty: /거짓|둘러대|지어내|속이|사실대로|정직|모른다고/,
  repeat: /반복|같은 말|자꾸|몇 번|매번/
};
// 지적·선호를 말하는 표지(하나는 있어야 고른다)
const FEEL = /지 ?마(?![가-힣])|지 ?말(?:고|라|아|것)|말고|싫|왜 |왜\?|잖아|앞으로|항상|절대|제발|짜증|답답|대충|제대로|틀렸|아니야|아니라고|좋아|좋겠|마음에 들|이렇게 해|이런 식|don'?t|do not|stop|never|always|prefer|instead|too long/i;
const STRONG = /앞으로|항상|절대|하지 ?마|하지 말|다시는|몇 번/;
const SECRET = /비밀번호|비번|패스워드|암호|password|passwd|\bpw\b|\bpin\b|핀 ?번호|인증 ?번호|\botp\b|api ?key|api ?키|토큰|token|secret|시크릿|private ?key|개인 ?키|bearer|주민(등록)?번호|계좌|카드 ?번호|\bsk-|ghp_|github_pat|AKIA|xox[abpr]-/i;

// 사용자의 말이 아닌 덩어리: 붙여 넣은 남의 글, 시스템 알림
function stripForeign(t) {
  return String(t)
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, " ")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/\[SYSTEM NOTIFICATION[\s\S]*$/, " ");
}
function clean(t) {
  return String(t)
    .replace(/<channel [^>]*>|<\/channel>/g, "")
    .replace(/\[(Image|Pasted text)[^\]]*\]/g, "")
    .replace(/\s+/g, " ").trim();
}
// 한 줄(문장)을 가린다. 비밀이 든 줄이면 null
function redact(t) {
  if (SECRET.test(t)) return null;
  return t.replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}[\w.]*/gi, "[메일]")
    .replace(/https?:\/\/\S+/g, "[링크]")
    .replace(/[A-Za-z0-9_+/=-]{20,}/g, "[가림]")
    .replace(/\d[\d\- ]{2,}\d/g, "[숫자]");
}
function tagsOf(t) { return Object.keys(TAGS).filter(k => TAGS[k].test(t)); }

const said = new Map();   // 같은 말은 한 번만
const counts = { history: 0, sessions: 0, human: 0, channel: 0, channelSkipped: 0 };
// 긴 지시문에서 지적·선호가 든 문장만 뽑는다(한 메시지에서 3문장까지). 비밀이 든 문장은 그 문장만 뺀다
function addSaid(text, ts, src) {
  const raw = stripForeign(text);
  const t0 = clean(raw);
  if (!t0 || t0.length < 6 || /^[/!]/.test(t0)) return;
  if (t0.length > 3000) return;   // 붙여 넣은 문서·프롬프트
  // 줄바꿈·문장부호·번호·'그리고' 앞에서 나눈다(마침표 없이 이어 쓴 말도 나뉘게)
  const hits = raw.split(/(?<=[.?!])\s+|\s(?=\d+\.\s)|\s(?=그리고\s)|\n+/).map(clean)
    .filter(x => x.length >= 6 && FEEL.test(x) && tagsOf(x).length)
    .map(x => ({ x, r: redact(x.length > 160 ? x.slice(0, 160) + "…" : x) })).filter(h => h.r);
  if (!hits.length) return;
  const picked = hits.sort((a, b) => (STRONG.test(b.x) - STRONG.test(a.x)) || a.x.length - b.x.length).slice(0, 3);
  const text1 = picked.map(h => h.r).join(" / ");
  const key = text1.replace(/\s/g, "").slice(0, 80);
  if (said.has(key)) return;
  const tags = [...new Set(picked.flatMap(h => tagsOf(h.x)))];
  const score = Math.min(tags.length, 3) + (picked.some(h => STRONG.test(h.x)) ? 2 : 0) + (text1.length <= 120 ? 1 : 0);
  said.set(key, { d: ymd(ts), src, tags, score, text: text1 });
}

// 사람이 쓴 말이 아닌 것(시스템·다른 세션·명령 출력)
const NOT_HUMAN = /^(<|Another Claude session|This session is being continued|Base directory for this skill|\[Request interrupted|Caveat:)/;

async function readLines(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) fn(line);
}
function statOf(p) { try { return fs.statSync(p); } catch (e) { return null; } }   // 끊어진 정션·지워진 파일은 건너뛴다
function listDir(p) { try { return fs.readdirSync(p); } catch (e) { return []; } }

async function main() {
  // 1) 터미널에서 친 말
  const hist = path.join(CL, "history.jsonl");
  if (statOf(hist)) {
    await readLines(hist, line => {
      let o; try { o = JSON.parse(line); } catch (e) { return; }
      if (!o.display || !(o.timestamp >= since)) return;
      counts.history++;
      addSaid(o.display, o.timestamp, "터미널");
    });
  }
  // 2) 세션 기록
  const pdir = path.join(CL, "projects");
  const projDirs = listDir(pdir).map(d => path.join(pdir, d)).filter(d => { const s = statOf(d); return s && s.isDirectory(); });
  for (const d of projDirs) {
    for (const f of listDir(d)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = path.join(d, f), st = statOf(fp);
      if (!st || st.mtimeMs < since) continue;
      counts.sessions++;
      await readLines(fp, line => {
        if (!line.includes('"type":"user"') || line.includes('"toolUseResult":')) return;   // 도구 결과 줄은 풀기 전에 건너뛴다
        let o; try { o = JSON.parse(line); } catch (e) { return; }
        if (o.type !== "user" || o.toolUseResult !== undefined || o.isCompactSummary || o.isSidechain || o.scheduledTaskId) return;
        const ts = Date.parse(o.timestamp); if (!(ts >= since)) return;
        const c = o.message && o.message.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter(b => b.type === "text").map(b => b.text).join("\n") : "";
        const kind = o.origin && o.origin.kind;
        // 채널 메시지는 isMeta로 기록되고, 한 턴에 여러 사람의 메시지가 묶여 올 수 있어 <channel> 하나씩 본다
        const blocks = [...text.matchAll(/<channel ([^>]*)>([\s\S]*?)<\/channel>/g)];
        if (blocks.length || kind === "channel") {
          if (!blocks.length) { counts.channelSkipped++; return; }
          blocks.forEach(b => {
            const uid = (b[1].match(/user_id="([^"]*)"/) || [])[1];
            if (!uid || !owners.includes(uid)) { counts.channelSkipped++; return; }
            counts.channel++;
            addSaid(b[2], ts, "채널");
          });
          return;
        }
        if (o.isMeta || (kind && kind !== "human")) return;   // 시스템이 넣은 말, peer·task-notification 등
        const own = stripForeign(text).trim();
        if (!own || NOT_HUMAN.test(own)) return;
        counts.human++;
        addSaid(own, ts, "터미널");
      });
    }
  }

  // 3) 지침 파일: 프로젝트 폴더에서 위로 git 저장소 루트까지 찾는다(홈 폴더 위로는 가지 않는다. 홈의 .claude는 따로 읽는다)
  const mdFiles = [path.join(CL, "CLAUDE.md")];
  const home = path.resolve(os.homedir());
  for (let dir = project, n = 0; dir !== home && path.dirname(dir) !== dir && n < 8; dir = path.dirname(dir), n++) {
    ["CLAUDE.md", "CLAUDE.local.md", path.join(".claude", "CLAUDE.md")].forEach(f => mdFiles.push(path.join(dir, f)));
    if (statOf(path.join(dir, ".git"))) break;
  }
  const STYLE_SEC = /말하기|대화|답변|글쓰기|문체|말투|스타일|style|tone|선호|소통/i;
  const RULE = /않는다|금지|말 것|하지 마|먼저|항상|반드시|쓴다\.|한다\./;
  const rules = [], readFiles = [];
  let prevResult = null;
  [...new Set(mdFiles)].filter(f => statOf(f)).forEach(f => {
    let lines; try { lines = fs.readFileSync(f, "utf8").split(/\r?\n/); } catch (e) { return; }
    readFiles.push(f);
    let sec = "", fence = false, inStyle = false;
    const style = [], other = [];
    lines.forEach(l => {
      if (/^\s*```/.test(l)) { fence = !fence; return; }
      if (!fence && /^#{1,3} /.test(l)) { sec = l.replace(/^#+ /, ""); inStyle = STYLE_SEC.test(sec); return; }
      const t = l.trim(); if (!t || t.length < 6 || /^\|/.test(t)) return;   // 표의 줄은 규칙이 아니다
      if (/^대화 선호/.test(sec)) return;
      if (inStyle) style.push(t);
      else if (RULE.test(t) && tagsOf(t).length) other.push(t);
    });
    const sIdx = lines.findIndex(l => /^## 대화 선호/.test(l));
    if (sIdx >= 0 && !prevResult) {
      const end = lines.findIndex((l, i) => i > sIdx && /^#{1,2} /.test(l));
      prevResult = { file: f, lines: lines.slice(sIdx, end < 0 ? lines.length : end).filter(Boolean).map(redact).filter(Boolean) };
    }
    const pick = style.slice(0, 30).concat(other.slice(0, 20)).map(t => redact(t.slice(0, 200))).filter(Boolean);
    if (pick.length) rules.push({ file: f, lines: pick });
  });

  // 4) 기억(피드백)
  const feedback = [];
  projDirs.forEach(d => {
    const md = path.join(d, "memory");
    listDir(md).filter(f => f.endsWith(".md") && f !== "MEMORY.md").forEach(f => {
      let s; try { s = fs.readFileSync(path.join(md, f), "utf8"); } catch (e) { return; }
      const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm || !/type:\s*feedback/.test(fm[1])) return;
      const name = redact(((fm[1].match(/name:\s*(.+)/) || [])[1] || f).trim());
      const desc = ((fm[1].match(/description:\s*(.+)/) || [])[1] || "").replace(/^"|"$/g, "");
      const t = redact(desc ? desc.slice(0, 200) : clean(s.slice(fm[0].length)).slice(0, 160));
      const st = statOf(path.join(md, f));
      if (t && name) feedback.push({ d: st ? ymd(st.mtimeMs) : "", name, text: t });
    });
  });

  const list = [...said.values()].sort((a, b) => b.score - a.score || (b.d > a.d ? 1 : -1)).slice(0, MAX);
  const tagCount = {};
  list.forEach(s => s.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  feedback.forEach(fb => tagsOf(fb.text).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const empty = !list.length && !rules.length && !feedback.length;

  fs.mkdirSync(outDir, { recursive: true });
  const today = ymd(Date.now());
  fs.writeFileSync(path.join(outDir, "signals.json"), JSON.stringify({ date: today, since: sinceStr, counts, readFiles, tags: tagCount, prevResult, rules, feedback, said: list }, null, 1));
  const o = [];
  o.push(`# 대화 선호 근거 (모은 날 ${today}, ${sinceStr}부터)`);
  o.push(`- 읽은 것: 터미널 입력 ${counts.history}건, 세션 ${counts.sessions}개(사람이 친 말 ${counts.human}건, 채널 메시지 ${counts.channel}건${owners.length ? "" : " — 주인 id(--owner)를 주지 않아 채널 메시지는 모두 뺌"}, 다른 사람이 보낸 채널 메시지 ${counts.channelSkipped}건 뺌), 피드백 기억 ${feedback.length}개`);
  o.push(`- 읽은 지침 파일: ${readFiles.join(", ") || "없음"}`);
  o.push(`- 고른 것: 지적·선호가 담긴 말 ${list.length}건(최대 ${MAX}건, 점수 높은 순)`);
  o.push(`- 가린 것: 메일·링크·4자리 이상 숫자·20자 이상 영숫자 덩어리는 가렸고, 비밀번호·PIN·키·토큰·계좌 같은 말이 든 문장은 뺐다.`);
  if (empty) {
    o.push(`\n## 근거 없음\n모은 근거가 없다. 기본 문항을 그대로 쓴다: \`node build.js --init <폴더>\` 다음 고치지 않고 \`node build.js --bank <폴더>\`.`);
  } else {
    o.push(`\n## 축별로 나온 횟수`);
    Object.entries(tagCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => o.push(`- ${k}: ${n}`));
    if (prevResult) { o.push(`\n## 0. 지난 선호 진단 결과(${prevResult.file})`); prevResult.lines.forEach(l => o.push(l)); }
    o.push(`\n## 1. 지침 파일에 이미 있는 규칙`);
    rules.forEach(r => { o.push(`### ${r.file}`); r.lines.forEach(l => o.push(`- ${l.replace(/^[-*]\s*/, "")}`)); });
    o.push(`\n## 2. 기억에 남은 피드백`);
    feedback.forEach(fb => o.push(`- [${fb.d}] ${fb.name}: ${fb.text}`));
    o.push(`\n## 3. 대화에서 한 말`);
    list.forEach(s => o.push(`- [${s.d} ${s.src} #${s.tags.join(" #")}] ${s.text}`));
  }
  o.push(`\n## 다음\nAI는 이 파일과 설계원칙.md를 읽고 문항을 짠다(SKILL.md 2단계). 이 파일에는 사용자의 원래 말이 들어 있으므로 폴더 밖으로 보내지 않고, git 저장소 안이면 .gitignore에 넣는다.`);
  fs.writeFileSync(path.join(outDir, "signals.md"), o.join("\n") + "\n");
  console.log(`모음: ${path.join(outDir, "signals.md")} — 말 ${list.length}건, 지침 파일 ${readFiles.length}개(${readFiles.join(", ")}), 피드백 ${feedback.length}개${empty ? " (근거 없음 → 기본 문항)" : ""}`);
}

main().catch(e => { console.error(e); process.exit(1); });

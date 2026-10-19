/* score.js — AI 대화 선호 진단 채점 (브라우저·Node 공용, v1.3 2026-10-19)
 *
 * bank = items.json 내용 + bank.deep(deep.json 내용)
 * 응답 형식(answers)
 *   ab[id]   = {s, r, t}  s: 0이면 '가'에 왼쪽 극(left), 1이면 '가'에 오른쪽 극(right)
 *                          r: -2 확실히 가, -1 조금 가, 1 조금 나, 2 확실히 나 / t: 응답 시간(ms)
 *                          r: 0이면 고르지 않음 — u:1 잘 모르겠다, x:1 둘 다 싫다(note: 어떻게 고치면 좋을지)
 *   deep[id] = {s, r, t}  심층 설문 고르기(형식은 ab와 같음)
 *   tone[id] = {c, t}     c: 고른 말투(formal|polite|memo|casual), "none"이면 모두 별로(note)
 *   ox[id]   = 1(거슬린다) | 0(괜찮다) | 2(잘 모르겠다)
 *   sl[axis] = 1~N        말로 답한 선호(1=왼쪽 극, N=오른쪽 극, N=bank.slider_points)
 *   att      = {s, r, t}  집중 확인 문항
 *   open[id] = "글"       주관식(자동 채점하지 않음). open["lex.more"]의 '바꿀 말 → 쓸 말' 줄은 용어 규칙으로 읽는다
 *   lex[id]  = {c, x, t}  용어 고르기. c: 고른 말(options[].w) 또는 "any"(다 비슷하다) / x: 거슬린다고 표시한 말들
 *   b        = 문항 은행 id(사용자에 맞게 짠 은행이면 그 id)
 * 점수는 -1(왼쪽 극) ~ +1(오른쪽 극). |점수| < 0.25는 "가운데".
 */
(function (root) {
  "use strict";
  var RESP = { "-2": -1, "-1": -0.5, "1": 0.5, "2": 1 };
  var MID = 0.25, STRONG = 0.6;

  function sign(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function pearson(x, y) {
    var n = x.length; if (n < 3) return null;
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }
  function poleScore(a) {
    var v = RESP[String(a.r)];
    if (v === undefined) return null;
    return a.s === 0 ? v : -v;
  }
  function minMs(it) { return Math.max(1200, (it.prompt.length + it.left.length + it.right.length) * 10); }
  function strengthOf(F) { return Math.abs(F) >= STRONG ? "강함" : Math.abs(F) >= MID ? "약함" : "가운데"; }

  function axisRows(bank, ans, axisId, sets) {
    var rows = [];
    bank.ab.forEach(function (it) {
      if (it.axis !== axisId || (sets && sets.indexOf(it.set) < 0)) return;
      var a = ans.ab && ans.ab[it.id]; if (!a) return;
      var s = poleScore(a); if (s === null) return;
      var fast = a.t < minMs(it);
      rows.push({ id: it.id, set: it.set, s: s, w: fast ? 0.5 : 1, fast: fast });
    });
    return rows;
  }

  function needsReserve(bank, ans, axisId) {
    var rows = axisRows(bank, ans, axisId, ["a1", "a2", "a1r"]);
    var skipped = bank.ab.some(function (it) {
      var a = ans.ab && ans.ab[it.id];
      return it.axis === axisId && it.set !== "a3" && a && !a.r;
    });
    if (skipped) return true;
    if (rows.length < 3) return false;
    var signs = rows.map(function (r) { return sign(r.s); });
    return !signs.every(function (x) { return x === signs[0]; });
  }

  // v1.0 답은 직접 답하기가 7점이었다(v1.1부터 5점)
  function sliderScore(bank, v, ver) {
    if (!v) return null;
    var p = ver === "1.0" ? 7 : (bank.slider_points || 7), mid = (p + 1) / 2;
    return Math.max(-1, Math.min(1, (v - mid) / (mid - 1)));
  }

  function axisResult(bank, ans, ax) {
    var rows = axisRows(bank, ans, ax.id);
    var W = rows.reduce(function (t, r) { return t + r.w; }, 0);
    var R = W ? rows.reduce(function (t, r) { return t + r.w * r.s; }, 0) / W : 0;
    var C = W ? Math.abs(rows.reduce(function (t, r) { return t + r.w * sign(r.s); }, 0)) / W : 0;
    var a1 = rows.filter(function (r) { return r.set === "a1"; })[0];
    var a1r = rows.filter(function (r) { return r.set === "a1r"; })[0];
    var retest = (a1 && a1r) ? sign(a1.s) === sign(a1r.s) : null;
    var S = sliderScore(bank, ans.sl && ans.sl[ax.id], ans.v);
    var F = S === null ? R : 0.7 * R + 0.3 * S;  // 고른 선호(R)를 말로 답한 선호(S)보다 무겁게 본다
    var sayDiff = S !== null && Math.abs(S) >= 0.3 && Math.abs(R) >= 0.3 && sign(S) !== sign(R);
    var grade;
    if (C >= 0.6 && retest !== false && !sayDiff) grade = "높음";
    else if (C < 0.34 || (retest === false && C < 0.6)) grade = "낮음";
    else grade = "보통";
    var dir = Math.abs(F) < MID ? 0 : sign(F);
    var unsureN = 0, bothBadN = 0;
    bank.ab.forEach(function (it) {
      if (it.axis !== ax.id) return;
      var a = ans.ab && ans.ab[it.id]; if (!a || a.r) return;
      if (a.x) bothBadN++; else unsureN++;
    });
    // 고르지 못한 문항이 2개 이상이거나, 재검사 짝을 건너뛰어 재검사를 못 했으면 높음을 주지 않는다
    if (unsureN + bothBadN >= 2 || (retest === null && unsureN + bothBadN >= 1)) grade = grade === "높음" ? "보통" : grade;
    return {
      id: ax.id, name: ax.name, left: ax.left, right: ax.right, unsureN: unsureN, bothBadN: bothBadN,
      R: R, S: S, F: F, C: C, retest: retest, sayDiff: sayDiff, grade: grade, dir: dir, strength: strengthOf(F),
      n: rows.length, fast: rows.filter(function (r) { return r.fast; }).length,
      rule: dir < 0 ? ax.rule_left : dir > 0 ? ax.rule_right : null,
      pole: dir < 0 ? ax.left : dir > 0 ? ax.right : "가운데",
      unclear: grade === "낮음" || dir === 0 || unsureN + bothBadN >= 2
    };
  }

  // 길이 축이 아닌 문항에서 두 답의 글자 수가 2자 이상 다르면 긴 쪽을 골랐는지 센다.
  // 문항은 축마다 길이 방향을 반반으로 섞어 두었으므로, 한쪽으로 크게 쏠리면 길이만 보고 고른 것이다.
  //   이모지·결론 순서·단정 정도 축은 한쪽에 말이 붙어 늘 오른쪽이 길다(build.js가 방향 규칙에서 뺀다). 여기서도 빼야 길이 취향이 섞이지 않는다
  var EXEMPT = ["length", "emoji", "order", "hedge"];
  function clen(s) { return Array.from(String(s || "")).length; }   // build.js와 같이 코드 포인트로 센다(이모지 하나 = 한 글자)
  function lengthPull(bank, ans) {
    var n = 0, longer = 0;
    var exempt = {};
    bank.axes.forEach(function (ax) { if (EXEMPT.indexOf(ax.id) >= 0 || ax.exempt) exempt[ax.id] = 1; });
    bank.ab.forEach(function (it) {
      if (exempt[it.axis]) return;
      var a = ans.ab && ans.ab[it.id]; if (!a) return;
      var dl = clen(it.right) - clen(it.left);
      if (Math.abs(dl) < 2) return;
      var s = poleScore(a); if (s === null) return;
      n++; if (sign(s) === sign(dl)) longer++;
    });
    var share = n >= 5 ? longer / n : null;
    var bias = share !== null && n >= 10 && (share >= 0.85 || share <= 0.15);
    return { n: n, share: share, bias: bias, side: bias ? (share >= 0.5 ? "long" : "short") : null };
  }

  function toneResult(bank, ans) {
    var styles = bank.tone.styles, picks = {}, counts = {};
    Object.keys(styles).forEach(function (k) { counts[k] = 0; });
    bank.tone.items.forEach(function (it) {
      var a = ans.tone && ans.tone[it.id]; if (!a || !styles[a.c]) return;   // "none"(모두 별로)은 고른 말투로 세지 않는다
      picks[it.id] = a.c; counts[a.c]++;
    });
    var bySet = {};
    bank.tone.items.forEach(function (it) { bySet[it.set] = it; });
    function p(set) { return bySet[set] ? picks[bySet[set].id] : undefined; }
    function ctx(set) { return bySet[set] ? bySet[set].context : set; }
    var work = p("t1"), workR = p("t1r");
    var byContext = [
      { context: ctx("t1"), pick: work && work === workR ? work : null, shaky: !!(work && workR && work !== workR), picks: [work, workR] },
      { context: ctx("t2"), pick: p("t2") || null },
      { context: ctx("t3"), pick: p("t3") || null }
    ];
    var chosen = byContext.map(function (c) { return c.pick; }).filter(Boolean);
    var allSame = chosen.length === 3 && chosen.every(function (x) { return x === chosen[0]; });
    var rules = [];
    if (allSame) rules.push("말투: 어느 상황에서나 " + bank.tone.rule[chosen[0]] + ".");
    else byContext.forEach(function (c) { if (c.pick) rules.push("말투(" + c.context + "): " + bank.tone.rule[c.pick] + "."); });
    return { picks: picks, counts: counts, byContext: byContext, retest: work && workR ? work === workR : null, rules: rules };
  }

  // 심층 설문: 축마다 상황별 점수를 낸다. 상황끼리 방향이 다르면 상황별 규칙을 만든다
  function deepResult(bank, ans) {
    var D = bank.deep; if (!D || !ans.deep) return [];
    var out = [];
    Object.keys(D.situations).forEach(function (axisId) {
      var ax = bank.axes.filter(function (a) { return a.id === axisId; })[0];
      var sits = D.situations[axisId].map(function (sit) {
        var ss = [];
        D.items.forEach(function (it) {
          if (it.axis !== axisId || it.sit !== sit.id) return;
          var a = ans.deep[it.id]; if (!a) return;
          var s = poleScore(a); if (s !== null) ss.push(s);
        });
        if (!ss.length) return null;
        var m = mean(ss), agree = ss.every(function (x) { return sign(x) === sign(ss[0]); });
        var dir = (!agree && Math.abs(m) < 0.5) || Math.abs(m) < MID ? 0 : sign(m);
        return { id: sit.id, name: sit.name, score: m, agree: agree, dir: dir,
                 pole: dir < 0 ? ax.left : dir > 0 ? ax.right : "가운데", strength: strengthOf(m),
                 rule: dir < 0 ? ax.rule_left : dir > 0 ? ax.rule_right : null };
      }).filter(Boolean);
      if (!sits.length) return;
      var dirs = sits.map(function (s) { return s.dir; }).filter(function (d) { return d !== 0; });
      // 답한 상황이 3개 미만이면 몇 상황만 보고 축 전체 규칙을 만들지 않는다(추가 설문에서 상황 하나만 물은 경우 등)
      var same = sits.length >= 3 && dirs.length === sits.length && dirs.every(function (d) { return d === dirs[0]; });
      var mixed = dirs.some(function (d) { return d !== dirs[0]; });
      var rules = [];
      if (same) rules.push((dirs[0] < 0 ? ax.rule_left : ax.rule_right) + " (상황별 질문에서도 같음)");
      else sits.forEach(function (s) { if (s.rule) rules.push(s.name + ": " + s.rule); });
      var head = same ? null : "[" + ax.name + "] " + (mixed ? "상황에 따라 다르게 한다." : "아래 상황에서는 이렇게 한다(다른 상황은 정하지 않았다).");
      out.push({ id: axisId, name: ax.name, left: ax.left, right: ax.right, situations: sits, sameAll: same, head: head, rules: rules });
    });
    return out;
  }


  // 용어 고르기: 낱말 묶음마다 읽기(read)·쓰기(self) 고른 말을 맞춰 보고, 바꿔 쓸 말(avoid)을 정한다.
  //   쓸 말(prefer): 두 문항에서 같은 말 → 신뢰 높음 / 한 문항만 고름(다른 하나는 '다 비슷하다') → 보통
  //                  두 문항이 엇갈리면 1단계 기록에서 실제로 더 자주 쓴 말(2번 이상, 다른 말의 2배 이상), 아니면 정하지 않음(흔들림)
  //   막을 말(strong): 거슬린다고 표시한 AI 버릇 말, 또는 두 문항 모두에서 거슬린다고 한 흔한 말. 꼴(forms)이 있어야 훅이 찾을 수 있다
  //   피할 말(strong 아님): 신뢰 높게 다른 말을 고른 묶음의 AI 버릇 말(ai). 지침에만 넣고 막지는 않는다
  var LEX_HEAD = "용어: 아래 말은 바꿔 쓴다. 인용, 코드, 고유 이름, 사용자의 말을 옮길 때는 그대로 둔다.";
  function parseLexMore(text) {
    var out = [];
    String(text || "").split(/\n|[,;／/]/).forEach(function (line) {
      var l = line.trim().replace(/^[-*•]\s*/, ""); if (!l) return;
      var q = "['\"‘’“”]?";
      var m = l.match(new RegExp("^" + q + "(.+?)" + q + "\\s*(?:->|→|=>|⇒|대신에?|말고)\\s*" + q + "(.+?)" + q + "(?:\\s*(?:으로|로)\\s*(?:써\\s*줘|써줘|써|쓰기|쓴다|바꿔\\s*줘|바꿔줘|바꿔|해\\s*줘|해줘))?\\s*[.!]?$"));
      if (m) { out.push({ w: m[1].trim(), to: m[2].trim() }); return; }
      m = l.match(new RegExp("^" + q + "(.+?)" + q + "\\s*(?:는|은|이|가|을|를)?\\s*(?:쓰지\\s*마|쓰지\\s*말|금지|싫)"));
      if (m) out.push({ w: m[1].trim(), to: null });
    });
    return out.filter(function (e) { return e.w && e.w.length <= 20 && e.w !== e.to; });
  }
  function lexResult(bank, ans, opts) {
    var L = bank.lex;
    var usage = (opts && opts.usage && opts.usage.user) || {};
    var concepts = [];
    if (L) L.concepts.forEach(function (c) {
      var ws = c.options.map(function (o) { return o.w; });
      var picks = {}, x = {}, n = 0;
      L.items.forEach(function (it) {
        if (it.concept !== c.id) return;
        var a = ans.lex && ans.lex[it.id]; if (!a) return;
        n++; picks[it.kind] = a.c;
        (a.x || []).forEach(function (w) { if (w !== a.c && ws.indexOf(w) >= 0) x[w] = (x[w] || 0) + 1; });
      });
      if (!n) return;
      var real = function (w) { return w && ws.indexOf(w) >= 0 ? w : null; };
      var r = real(picks.read), s = real(picks.self), u = usage[c.id] || {};
      var prefer = null, conf = null, how;
      if (r && s && r === s) { prefer = r; conf = "높음"; how = "읽기·쓰기 모두"; }
      else if (r && s) {
        var ur = u[r] || 0, us = u[s] || 0, hi = Math.max(ur, us), lo = Math.min(ur, us);
        if (hi >= 2 && hi >= 2 * lo) { prefer = ur > us ? r : s; conf = "보통"; how = "고른 말이 엇갈려 기록에서 더 자주 쓴 말"; }
        else how = "흔들림(읽기 " + r + " · 쓰기 " + s + ")";
      } else if (r || s) { prefer = r || s; conf = "보통"; how = r ? "읽기에서만 고름" : "쓰기에서만 고름"; }
      else how = "다 비슷하다";
      if (prefer && x[prefer]) { prefer = null; conf = null; how = "흔들림(고른 말을 거슬린다고도 표시)"; }
      var alt = function (w) {
        var o = c.options.filter(function (z) { return z.w !== w && !x[z.w] && !z.ai; })[0];
        return o ? o.w : null;
      };
      var avoid = [];
      c.options.forEach(function (o) {
        if (o.w === prefer) return;
        var forms = o.forms || [];
        // AI 버릇 말은 한 번만 거슬린다고 해도 막는다. 흔한 말(확인하다·보이다 등)은 두 문항 모두에서 거슬린다고 해야 막고, 한 번이면 지침에만 넣는다
        if (x[o.w]) avoid.push({ w: o.w, to: prefer || alt(o.w), forms: forms, strong: forms.length > 0 && (!!o.ai || x[o.w] >= 2),
                                 why: o.ai || x[o.w] >= 2 ? "거슬린다고 표시" : "한 문항에서만 거슬린다고 표시" });
        else if (o.ai && prefer && conf === "높음") avoid.push({ w: o.w, to: prefer, forms: forms, strong: false, why: "다른 말을 골라서" });
      });
      concepts.push({ id: c.id, name: c.name, read: picks.read || null, self: picks.self || null, prefer: prefer, conf: conf, how: how,
                      disliked: Object.keys(x), avoid: avoid, used: u });
    });
    var user = parseLexMore(ans.open && ans.open[(L && L.more && L.more.id) || "lex.more"]).map(function (e) {
      // 용어 묶음에 있는 말이면 그 활용형(forms)으로 찾는다('재다'라고 적어도 '재 보니'·'잰'을 잡게). 없는 말은 적은 그대로 찾는다
      var known = null;
      if (L) L.concepts.forEach(function (c) { c.options.forEach(function (o) { if (o.w === e.w && (o.forms || []).length) known = o; }); });
      return { w: e.w, to: e.to, forms: known ? known.forms : [e.w], strong: true, why: "직접 적음", user: true };
    });
    var all = [];
    concepts.forEach(function (c) { c.avoid.forEach(function (a) { all.push(a); }); });
    user.forEach(function (e) {   // 직접 적은 말이 이미 '피할 말'이면 막을 말로 올리고, 적은 쓸 말을 따른다
      var same = all.filter(function (a) { return a.w === e.w; })[0];
      if (!same) all.push(e);
      else { same.strong = same.forms.length > 0; same.to = e.to || same.to; same.why = "직접 적음"; }
    });
    var lines = all.map(function (a) { return "'" + a.w + "' → " + (a.to ? "'" + a.to + "'" : "다른 말로 바꾼다"); });
    return { concepts: concepts, user: user, avoid: all, lines: lines, head: LEX_HEAD,
             unclear: concepts.filter(function (c) { return !c.prefer && c.how !== "다 비슷하다"; }) };
  }

  function score(bank, ans, opts) {
    opts = opts || {};
    var axes = bank.axes.map(function (ax) { return axisResult(bank, ans, ax); });

    // 반분 신뢰도: 축마다 a1과 a2 점수를 두 반으로 보고 상관을 구한 뒤 Spearman-Brown으로 고친다
    var x = [], y = [], rx = [], ry = [];
    bank.axes.forEach(function (ax) {
      var r1 = axisRows(bank, ans, ax.id, ["a1"])[0], r2 = axisRows(bank, ans, ax.id, ["a2"])[0], r1r = axisRows(bank, ans, ax.id, ["a1r"])[0];
      if (r1 && r2) { x.push(r1.s); y.push(r2.s); }
      if (r1 && r1r) { rx.push(r1.s); ry.push(r1r.s); }
    });
    var rHalf = pearson(x, y);
    var sb = rHalf === null ? null : (2 * rHalf) / (1 + rHalf);
    var rRetest = pearson(rx, ry);
    var agree = rx.length >= 3 ? rx.filter(function (v, i) { return sign(v) === sign(ry[i]); }).length / rx.length : null;

    var allAb = Object.keys(ans.ab || {}).map(function (k) { return ans.ab[k]; });
    var abAns = allAb.filter(function (a) { return a.r; });
    var rightShare = abAns.length ? abAns.filter(function (a) { return a.r > 0; }).length / abAns.length : null;
    var mildShare = abAns.length ? abAns.filter(function (a) { return Math.abs(a.r) === 1; }).length / abAns.length : null;
    var fastN = axes.reduce(function (t, a) { return t + a.fast; }, 0);
    var posBias = rightShare !== null && abAns.length >= 10 && (rightShare > 0.8 || rightShare < 0.2);
    var attPass = ans.att ? ans.att.r === bank.attention.expect : null;
    var lp = lengthPull(bank, ans);
    var unsureShare = allAb.length ? (allAb.length - abAns.length) / allAb.length : null;

    var overall;
    if (attPass === false || (sb !== null && sb < 0.3) || (agree !== null && agree < 0.5)) overall = "참고용";
    else if (attPass && (sb === null || sb >= 0.6) && (agree === null || agree >= 0.7) && !posBias && !lp.bias && !(unsureShare > 0.3)) overall = "믿을 만함";
    else overall = "대체로 믿을 만함";

    // 한쪽 극 몰림: 왼쪽 극은 대개 간결·직접, 오른쪽 극은 자세히·친절이라 한 가지 성향이 여러 축에 번질 수 있다.
    // 그런 사람일 수도 있으므로 종합을 내리지 않고 표시만 한다(지침을 넣은 뒤 A/B 검증을 권한다).
    var leftN = axes.filter(function (a) { return !a.unclear && a.dir < 0; }).length, rightN = axes.filter(function (a) { return !a.unclear && a.dir > 0; }).length;
    var oneSide = Math.max(leftN, rightN) >= 10 ? { side: leftN > rightN ? "left" : "right", n: Math.max(leftN, rightN), total: axes.length } : null;

    var tone = toneResult(bank, ans);
    var ox = bank.ox.map(function (o) { return { id: o.id, text: o.text, rule: o.rule, dislike: ans.ox ? ans.ox[o.id] === 1 : null }; });
    var deep = deepResult(bank, ans);
    var deepIds = deep.map(function (d) { return d.id; });

    var clear = axes.filter(function (a) { return !a.unclear; }).sort(function (a, b) { return Math.abs(b.F) - Math.abs(a.F); });
    var strong = clear.filter(function (a) { return a.strength === "강함"; });
    var unclear = axes.filter(function (a) { return a.unclear; });

    var date = (opts.date || ans.d || "").slice(0, 10);
    var lines = [];
    tone.rules.forEach(function (r) { lines.push("- " + r); });
    clear.forEach(function (a) { if (deepIds.indexOf(a.id) < 0) lines.push("- " + a.rule); });
    deep.forEach(function (d) {
      if (d.rules.length === 1 && d.sameAll) lines.push("- " + d.rules[0]);
      else if (d.rules.length) { lines.push("- " + d.head); d.rules.forEach(function (r) { lines.push("  - " + r); }); }
    });
    ox.filter(function (o) { return o.dislike; }).forEach(function (o) { lines.push("- " + o.rule); });
    var lex = lexResult(bank, ans, opts);
    if (lex.lines.length) { lines.push("- " + lex.head); lex.lines.forEach(function (l) { lines.push("  - " + l); }); }
    var rules = ["## 대화 선호 (선호 진단 " + date + ", 신뢰도 " + overall + ")", ""].concat(lines).join("\n");

    var unsure = [];
    function collectUnsure(list, store, round) {
      (list || []).forEach(function (it) {
        var a = store && store[it.id]; if (!a || a.r) return;
        unsure.push({ id: it.id, axis: it.axis, sit: it.sit || null, round: round, kind: a.x ? "둘 다 싫다" : "잘 모르겠다", note: a.note || "", prompt: it.prompt });
      });
    }
    collectUnsure(bank.ab, ans.ab, 1);
    collectUnsure(bank.deep && bank.deep.items, ans.deep, 2);
    Object.keys(ans.tone || {}).forEach(function (k) { var a = ans.tone[k]; if (a.c === "none") unsure.push({ id: k, axis: "tone", round: 1, kind: "모두 별로", note: a.note || "" }); });
    Object.keys(ans.ox || {}).forEach(function (k) { if (ans.ox[k] === 2) unsure.push({ id: k, axis: "ox", round: 1, kind: "잘 모르겠다", note: "" }); });
    // 상황별 질문에서 규칙이 나온 축은 이미 풀렸으므로 추가 질문 대상에서 뺀다
    var solved = deep.filter(function (d) { return d.rules.length; }).map(function (d) { return d.id; });
    var followAxes = axes.filter(function (a) { return (a.unclear || a.bothBadN) && solved.indexOf(a.id) < 0; }).map(function (a) { return a.id; });
    var pendingN = unsure.filter(function (u) { return solved.indexOf(u.axis) < 0; }).length;

    var open = [];
    if (ans.open) Object.keys(ans.open).forEach(function (k) { if (String(ans.open[k]).trim()) open.push({ id: k, text: String(ans.open[k]).trim() }); });

    return {
      version: bank.version, date: date, overall: overall,
      reliability: {
        splitHalf: sb, splitHalfRaw: rHalf, halfPairs: x.length,
        retestAgree: agree, retestR: rRetest, retestPairs: rx.length,
        attention: attPass, rightShare: rightShare, posBias: posBias, mildShare: mildShare, fast: fastN,
        longShare: lp.share, longN: lp.n, longBias: lp.bias, longSide: lp.side, oneSide: oneSide,
        unsureShare: unsureShare
      },
      axes: axes, tone: tone, ox: ox, deep: deep, lex: lex, open: open, unsure: unsure,
      followup: { axes: followAxes, items: pendingN, recommend: followAxes.length > 0 || pendingN >= 3 },
      summary: (strong.length ? strong : clear).slice(0, 3).map(function (a) { return a.pole + "(" + a.strength + ")"; }),
      sayDiff: axes.filter(function (a) { return a.sayDiff; }),
      unclear: unclear,
      rules: rules
    };
  }

  function compare(r1, r2) {
    var f1 = [], f2 = [], changed = [];
    r1.axes.forEach(function (a) {
      var b = r2.axes.filter(function (z) { return z.id === a.id; })[0]; if (!b) return;
      f1.push(a.F); f2.push(b.F);
      if (a.dir !== b.dir) changed.push({ id: a.id, name: a.name, before: a.pole, after: b.pole });
    });
    return { r: pearson(f1, f2), changed: changed, same: f1.length - changed.length, total: f1.length };
  }

  var api = { score: score, compare: compare, needsReserve: needsReserve, poleScore: poleScore, minMs: minMs, sliderScore: sliderScore, parseLexMore: parseLexMore };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PrefScore = api;
})(this);

import type { EngineInterface, Register, TurnStepChunk } from 'claude-code'

// 선호 진단의 용어 규칙(pref_lexicon.json)의 swap 목록대로, 채팅 답이 화면에 나가기 전에 막을 말을 바꿀 말로 바꾼다.
// lex_guard.js 훅의 Stop은 답을 다 쓴 뒤 되돌려 다시 쓰게 하지만, 이 mod는 쓰는 동안 바꾸므로 답이 두 번 나오지 않는다.
// swap에 없는 꼴은 바꾸지 않는다(그것은 Stop 훅이 맡는다). 인용(따옴표·낫표), 코드(`…`, ```…```), 링크, '>' 인용 줄은 그대로 둔다.
// 규칙 파일: 환경 변수 PREF_LEXICON, 없으면 ~/.claude/hooks/pref_lexicon.json. PREF_LEX_OFF=1이거나 chat이 "off"면 아무것도 하지 않는다.
type Lex = { chat?: string; swap?: Array<[string, string]> }
type Rule = { rx: RegExp; to: string }
export type Conf = { on: boolean; rules: Rule[] }

// 패턴 앞에는 (?<![가-힣])가 붙는다. 앞 글자가 한글이면 맞지 않는다(낱말 가운데를 잡지 않으려고)
export function parse(j: Lex, off = false): Conf {
  const rules: Rule[] = []
  for (const [p, to] of j.swap ?? []) {
    if (typeof to !== 'string' || !to.trim()) continue
    try {
      rules.push({ rx: new RegExp(`(?<![가-힣])(?:${p})`, 'g'), to })
    } catch {
      // 틀린 패턴은 건너뛴다. words.js check가 알린다.
    }
  }
  return { on: !off && j.chat !== 'off' && rules.length > 0, rules }
}

let conf: Conf = parse({})
let file = ''
let stamp = -1

async function load($: EngineInterface): Promise<void> {
  try {
    const off = (await $.env.get('PREF_LEX_OFF')) === '1'
    if (!file) {
      const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
      file = (await $.env.get('PREF_LEXICON')) || `${home}/.claude/hooks/pref_lexicon.json`
    }
    const { mtimeMs } = await $.fs.stat(file)
    if (mtimeMs === stamp && conf.on !== off) return
    conf = parse(JSON.parse(await $.fs.read(file)) as Lex, off)
    stamp = mtimeMs
  } catch {
    conf = parse({})
    stamp = -1
  }
}

const KEEP = /`[^`\n]*`|https?:\/\/\S+|"[^"\n]*"|“[^”\n]*”|'[^'\n]*'|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/g
const FENCE = /^\s*(```|~~~)/

type State = { fence: boolean }

function sub(text: string, c: Conf): string {
  for (const r of c.rules) text = text.replace(r.rx, r.to)
  return text
}

function fixLine(line: string, c: Conf): string {
  if (/^\s*>/.test(line)) return line
  let out = ''
  let last = 0
  for (const m of line.matchAll(KEEP)) {
    out += sub(line.slice(last, m.index), c) + m[0]
    last = (m.index ?? 0) + m[0].length
  }
  return out + sub(line.slice(last), c)
}

export function fix(text: string, c: Conf = conf, st: State = { fence: false }): string {
  if (!c.on) return text
  return text
    .split('\n')
    .map(line => {
      if (FENCE.test(line)) {
        st.fence = !st.fence
        return line
      }
      return st.fence ? line : fixLine(line, c)
    })
    .join('\n')
}

// 낱말과 인용이 조각 사이에 걸리지 않게 줄 끝(아주 긴 줄이면 마지막 빈 곳)까지만 내보내고 나머지는 다음 조각과 붙여 고친다
export function cut(text: string): number {
  const nl = text.lastIndexOf('\n')
  if (nl >= 0) return nl + 1
  return text.length > 600 ? text.lastIndexOf(' ') + 1 : 0
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    await load($)
    const it = next(e)
    let held: Extract<TurnStepChunk, { kind: 'text' }> | null = null
    let st: State = { fence: false }
    for (;;) {
      const r = await it.next()
      if (r.done) {
        if (held) yield { ...held, text: fix(held.text, conf, st) }
        return { ...r.value, answer: fix(r.value.answer) }
      }
      const c = r.value
      if (c.kind === 'text' && held && held.index === c.index) {
        const all = held.text + c.text
        const n = cut(all)
        if (n > 0) yield { ...held, text: fix(all.slice(0, n), conf, st) }
        held = { ...c, text: all.slice(n) }
        continue
      }
      if (held) {
        yield { ...held, text: fix(held.text, conf, st) }
        held = null
      }
      if (c.kind === 'text') {
        held = c
        st = { fence: false }
      } else yield c
    }
  })
}

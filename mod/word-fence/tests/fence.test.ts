import { expect, test } from 'claude-code/testing'
import { cut, fix, parse } from '../hooks/register'

const c = parse({
  swap: [
    ['잰다', '측정한다'],
    ['재 (?=[보봤본볼봐])', '측정해 '],
    ['축(?=으로|을|이)', '기준'],
    ['갈래(?![요?])', '가지'],
    ['레버리지', ''],
    ['((', 'x'],
  ],
})

test('swap대로 바꾼다', () => {
  expect(fix('기준을 재 보지 않았고, 두 갈래로 나뉜다. 길이를 잰다. 세 축으로 봤다.', c))
    .toBe('기준을 측정해 보지 않았고, 두 가지로 나뉜다. 길이를 측정한다. 세 기준으로 봤다.')
})
test('다른 낱말 안의 같은 글자는 그대로 둔다', () => {
  expect(fix('현재는 괜찮고 생일 축하해요. 건축 허가. 갈래요?', c)).toBe('현재는 괜찮고 생일 축하해요. 건축 허가. 갈래요?')
})
test('인용·코드·링크·> 인용 줄은 그대로 둔다', () => {
  expect(fix('원문은 "잰다"이고 우리는 잰다.', c)).toBe('원문은 "잰다"이고 우리는 측정한다.')
  expect(fix('`잰다` 말고 잰다', c)).toBe('`잰다` 말고 측정한다')
  expect(fix('「갈래」와 갈래', c)).toBe('「갈래」와 가지')
  expect(fix('https://x.y/축으로 세 축으로', c)).toBe('https://x.y/축으로 세 기준으로')
  expect(fix('> 세 축으로 봤다', c)).toBe('> 세 축으로 봤다')
})
test('코드 상자 안은 그대로 두고, 조각 사이에 걸려도 이어서 안다', () => {
  expect(fix('a 잰다\n```\nb 잰다\n```\nc 잰다', c)).toBe('a 측정한다\n```\nb 잰다\n```\nc 측정한다')
  const st = { fence: false }
  expect(fix('```\n잰다\n', c, st)).toBe('```\n잰다\n')
  expect(fix('잰다\n```\n잰다', c, st)).toBe('잰다\n```\n측정한다')
})
test('바꿀 말이 빈 줄과 틀린 패턴은 건너뛴다', () => {
  expect(c.rules.length).toBe(4)
  expect(fix('레버리지 효과', c)).toBe('레버리지 효과')
})
test('chat이 off거나 PREF_LEX_OFF면 바꾸지 않는다', () => {
  expect(fix('잰다', parse({ chat: 'off', swap: [['잰다', '측정한다']] }))).toBe('잰다')
  expect(fix('잰다', parse({ swap: [['잰다', '측정한다']] }, true))).toBe('잰다')
  expect(fix('잰다', parse({}))).toBe('잰다')
})
test('줄 끝까지만 내보낸다', () => {
  expect(cut('첫 줄\n둘째 줄 가르')).toBe(4)
  expect(cut('짧은 조각')).toBe(0)
})

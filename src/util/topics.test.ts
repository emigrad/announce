import { getTopicSelectorRegExp } from './topics'

describe('topics', () => {
  it.each([
    ['foo.**', 'foo', true],
    ['foo.**', 'bar', false],
    ['foo.**.bar', 'foo.bar', true],
    ['foo.**.bar', 'foo.1.bar', true],
    ['foo.**.bar', 'foo.1.2.bar', true],
    ['foo.**.bar', 'foo.1.2.baz', false]
  ])(
    'should correctly match the selector (selector: %s, topic: %s)',
    (selector, topic, expected) => {
      expect(getTopicSelectorRegExp(selector).test(topic)).toBe(expected)
    }
  )
})

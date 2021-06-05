import { Subscriber } from '../types'
import { getDeadLetterQueue, hasDeadLetterQueue } from './index'

describe('Selectors', () => {
  it.each([
    [true, true],
    [false, false],
    [undefined, true]
  ])(
    'Should determine whether a subscriber has a dead letter queue (deadLetterQueue: %p)',
    (deadLetterQueue, expected) => {
      const subscriber = { options: { deadLetterQueue } } as Subscriber<any>

      expect(hasDeadLetterQueue(subscriber)).toBe(expected)
    }
  )

  it.each([
    [true, 'test.dlq'],
    [false, null]
  ])(
    'Should determine the dead letter queue (deadLetterQueue: %p)',
    (deadLetterQueue, expected) => {
      const subscriber = {
        name: 'test',
        options: { deadLetterQueue }
      } as Subscriber<any>

      expect(getDeadLetterQueue(subscriber)).toBe(expected)
    }
  )
})

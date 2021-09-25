import { Message, Subscriber } from '../types'
import {
  getConcurrency,
  getDeadLetterQueue,
  getHeader,
  hasDeadLetterQueue
} from './index'

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

  it.each([
    [undefined, 1],
    [{}, 1],
    [{ concurrency: 4 }, 4]
  ])('Should determine the concurrency (%p)', (options, expected) => {
    expect(getConcurrency({ options } as Subscriber<any>)).toBe(expected)
  })

  it.each(['Content-Type', 'content-Type', 'content-type'])(
    'Should correctly fetch the header %p',
    (headerName) => {
      const expected = 'expected value'
      const message: Message<any> = {
        topic: 'abc',
        body: null,
        headers: {
          id: '3',
          published: '',
          header1: '1',
          [headerName]: expected,
          header2: '2'
        }
      }

      expect(getHeader(message, 'Content-Type')).toBe(expected)
    }
  )
})

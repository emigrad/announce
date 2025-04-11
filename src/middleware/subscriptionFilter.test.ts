import { Announce } from '../Announce'
import { InMemoryBackend } from '../backends'
import { Subscriber } from '../types'
import { spy } from './spy'
import { subscriptionFilter } from './subscriptionFilter'

describe('Logger middleware', () => {
  let announce: Announce
  let backend: InMemoryBackend

  beforeEach(() => {
    jest.useRealTimers()

    backend = new InMemoryBackend()
    announce = new Announce({ backendFactory: () => backend })
  })

  it.each([
    ['abc', true],
    ['b', false],
    [/b/, true],
    [/xyz/, false],
    [() => true, true],
    [() => false, false]
  ])(
    'should only subscribe if the filter matches (%p, expected: %p)',
    async (filter, expected) => {
      const onSubscribe = jest.fn()
      const subscriber = {
        queueName: 'abc',
        topics: ['abc'],
        handle: () => {
          // Do nothing
        }
      } as Subscriber

      announce.use(spy({ onSubscribe }), subscriptionFilter({ filter }))
      await announce.subscribe(subscriber)

      expect(onSubscribe).toHaveBeenCalledTimes(expected ? 1 : 0)
    }
  )
})

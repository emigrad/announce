import { Announce } from '../Announce'
import { MiddlewareArgs, SubscribeMiddleware, Subscriber } from '../types'
import { getCompleteMessage } from '../util'
import { delay, withDelay } from './delay'

jest.useFakeTimers()

describe('delay middware', () => {
  let announce: Announce

  beforeEach(() => {
    announce = { on: jest.fn() } as unknown as Announce
  })

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllTimers()
  })

  it('Should pass the subscriber details as-is', async () => {
    const delayMs = 100
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const subscriber = {
      queueName: 'fred',
      topics: ['abc'],
      options: { concurrency: 5 }
    } as Subscriber
    let subscribeMiddleware!: SubscribeMiddleware

    delay({ delay: delayMs })({
      announce,
      addSubscribeMiddleware(_subscibeMiddleware) {
        subscribeMiddleware = _subscibeMiddleware
      }
    } as MiddlewareArgs)

    expect(await subscribeMiddleware({ subscriber, next })).toBe(nextResult)
    expect(next).toHaveBeenCalledWith(expect.objectContaining(subscriber))
  })

  it.each([0, 500, 1000])(
    'Should process messages after a delay (elapsed: %p)',
    async (elapsed) => {
      const delayMs = 750
      const message = getCompleteMessage({
        topic: 'abc',
        body: null,
        properties: { date: new Date(Date.now() - elapsed) }
      })
      let handlerCalled = false
      let promiseResolved = false
      const subscriber = {
        queueName: 'fred',
        topics: ['abc'],
        handle: () => {
          handlerCalled = true
        }
      } as Subscriber
      let wrappedSubscriber!: Subscriber
      let subscribeMiddleware!: SubscribeMiddleware

      delay({ delay: delayMs })({
        announce,
        addSubscribeMiddleware(_subscibeMiddleware) {
          subscribeMiddleware = _subscibeMiddleware
        }
      } as MiddlewareArgs)

      const next = jest.fn((_subscriber) => {
        wrappedSubscriber = _subscriber
        return Promise.resolve()
      })

      await subscribeMiddleware({ subscriber, next })

      const handlePromise = (
        wrappedSubscriber.handle(message, { announce }) as Promise<unknown>
      ).then(() => {
        promiseResolved = true
      })

      // Give the system a chance to run the handler if it wants to
      jest.advanceTimersByTime(Math.max(0, delayMs - elapsed - 1))
      await Promise.resolve()

      if (elapsed > delayMs) {
        expect(handlerCalled).toBe(true)
        await handlePromise
      } else {
        expect(handlerCalled).toBe(false)
        expect(promiseResolved).toBe(false)
      }

      jest.advanceTimersByTime(2)

      await handlePromise
      expect(handlerCalled).toBe(true)
    }
  )

  it('Should not call handlers after announce instance has closed', async () => {
    let listener!: () => unknown
    announce.on = ((event: string, _listener: () => unknown) => {
      expect(event).toBe('close')
      listener = _listener
    }) as Announce['on']
    const message = getCompleteMessage({ topic: 'abc', body: {} })

    let handlerCalled = false
    const subscriber = {
      queueName: 'fred',
      topics: ['abc'],
      handle: () => {
        handlerCalled = true
      }
    } as Subscriber
    let wrappedSubscriber!: Subscriber
    let subscribeMiddleware!: SubscribeMiddleware

    const next = jest.fn((_subscriber) => {
      wrappedSubscriber = _subscriber
      return Promise.resolve()
    })

    delay({ delay: 100 })({
      announce,
      addSubscribeMiddleware(_subscibeMiddleware) {
        subscribeMiddleware = _subscibeMiddleware
      }
    } as MiddlewareArgs)

    await subscribeMiddleware({ subscriber, next })
    const handlePromise = wrappedSubscriber.handle(message, { announce })

    listener()

    await expect(handlePromise).rejects.toBeDefined()
    expect(handlerCalled).toBe(false)
  })

  it('Should support variation in delays', async () => {
    const numMessages = 1000
    const handle = jest.fn()
    const delayMs = 50
    const variation = 0.75
    const expectedMinDelay = delayMs - (delayMs * variation) / 2
    const expectedMaxDelay = delayMs + (delayMs * variation) / 2
    const subscriber = withDelay(
      { queueName: 'fred', topics: ['abc'], handle },
      { delay: delayMs, variation }
    )

    const spy = jest.spyOn(global, 'setTimeout')
    const promises: Promise<void>[] = []
    for (let i = 0; i < numMessages; i++) {
      promises.push(
        subscriber.handle(getCompleteMessage({ topic: 'abc', body: 'abc' }), {
          announce
        }) as Promise<void>
      )
    }

    jest.advanceTimersByTime(delayMs * 2)
    await Promise.all(promises)

    const delays = spy.mock.calls.map((args: unknown[]) => args[1] as number)
    const minDelay = Math.min(...delays)
    const maxDelay = Math.max(...delays)

    expect(delays.length).toBe(numMessages)
    expect(minDelay).toBeGreaterThanOrEqual(expectedMinDelay)
    expect(minDelay).toBeLessThan(
      ratio(expectedMinDelay, expectedMaxDelay, 0.25)
    )
    expect(maxDelay).toBeGreaterThan(
      ratio(expectedMinDelay, expectedMaxDelay, 0.75)
    )
    expect(minDelay).toBeLessThanOrEqual(expectedMaxDelay)
  })
})

function ratio(a: number, b: number, ratio: number) {
  return a + (b - a) * ratio
}

import { Deferred } from 'ts-deferred'
import { Announce } from './announce'
import { InMemory } from './backends/inMemory'
import { getCompleteHeaders } from './message'
import { errorLoggerMiddleware, loggerMiddleware } from './middleware'
import { Backend, LeveledLogMethod, Logger, Subscriber } from './types'

describe('Announce', () => {
  it.each(['***', ' hello', '..foo', '.bar', 'bar.', 'something-else'])(
    'Should reject subscribers that listen to invalid topic %p',
    (topic) => {
      const subscriber: Subscriber<any, any> = {
        name: 'test',
        topics: [topic],
        handle: jest.fn()
      }
      const announce = new Announce(new InMemory(), [])

      expect(() => announce.subscribe(subscriber)).toThrow()
    }
  )

  it.each(['***', ' hello', '..foo', '.bar', 'bar.', 'something-else'])(
    'Should reject attempts to send messages to invalid topic %p',
    (topic) => {
      const publish = jest.fn()
      const backend = { publish, subscribe: jest.fn() } as Backend
      const announce = new Announce(backend, [])

      expect(() =>
        announce.publish({
          body: { hi: 'there' },
          headers: getCompleteHeaders(),
          topic
        })
      ).toThrow()
      expect(backend.publish).not.toHaveBeenCalled()
    }
  )

  it('Should pass subscriptions onto the backend, after applying middleware', async () => {
    const dfd = new Deferred<[string, Error]>()
    const error = new Error('no')
    const subscriber: Subscriber<any, any> = {
      name: 'test',
      topics: ['foo'],
      handle: jest.fn().mockRejectedValue(error)
    }
    const logger = {
      error: function (message, err) {
        dfd.resolve([message, err])
        return this
      },
      debug: jest.fn() as LeveledLogMethod
    } as Logger
    const announce = new Announce(new InMemory(), [
      loggerMiddleware(logger),
      errorLoggerMiddleware()
    ])

    announce.subscribe(subscriber)
    announce.publish({
      topic: 'foo',
      body: { hi: 'there' },
      headers: getCompleteHeaders()
    })

    expect(await dfd.promise).toEqual(['Error processing message', { error }])
  })
})

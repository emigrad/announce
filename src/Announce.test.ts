import { Deferred } from 'ts-deferred'
import { Announce } from './Announce'
import { InMemoryBackend } from './backends'
import { getCompleteHeaders } from './message'
import { Logger, LoggerMiddleware } from './middleware'
import { Subscriber } from './types'

describe('Announce', () => {
  beforeEach(() => {
    delete process.env.ANNOUNCE_BACKEND_URL
  })

  it.each(['***', ' hello', '..foo', '.bar', 'bar.', 'something-else'])(
    'Should reject subscribers that listen to invalid topic %p',
    (topic) => {
      const subscriber: Subscriber<any> = {
        name: 'test',
        topics: [topic],
        handle: jest.fn()
      }
      const announce = new Announce('memory://')

      expect(() => announce.subscribe(subscriber)).toThrow()
    }
  )

  it.each(['***', ' hello', '..foo', '.bar', 'bar.', 'something-else'])(
    'Should reject attempts to send messages to invalid topic %p',
    async (topic) => {
      const backend = new InMemoryBackend()
      backend.publish = jest.fn()

      const announce = new Announce('test://', {
        backendFactory: { getBackend: () => backend }
      })

      await expect(
        announce.publish({
          body: { hi: 'there' },
          headers: getCompleteHeaders(),
          topic
        })
      ).rejects.toBeDefined()
      expect(backend.publish).not.toHaveBeenCalled()
    }
  )

  it('Should pass subscriptions onto the backend, after applying middleware', async () => {
    const dfd = new Deferred<[string, Error]>()
    const error = new Error('no')
    const subscriber: Subscriber<any> = {
      name: 'test',
      topics: ['foo'],
      handle: jest.fn().mockRejectedValue(error)
    }
    const logger = {
      error: () => dfd.resolve(),
      info: jest.fn(),
      trace: jest.fn()
    } as Logger
    const announce = new Announce('memory://')
    announce.use(new LoggerMiddleware(logger))

    await announce.subscribe(subscriber)
    await announce.publish({
      topic: 'foo',
      body: { hi: 'there' },
      headers: getCompleteHeaders()
    })

    await dfd.promise
  })

  it('Should throw an error if the URL is not defined', () => {
    expect(() => new Announce()).toThrow(Error)
  })

  it('Should read backend URL from ANNOUNCE_BACKEND_URL', () => {
    const backendUrl = 'blah://'
    process.env.ANNOUNCE_BACKEND_URL = backendUrl

    const backendFactory = {
      getBackend: jest.fn().mockReturnValue(new InMemoryBackend())
    }

    new Announce(undefined, { backendFactory })
    expect(backendFactory.getBackend).toHaveBeenCalledWith(backendUrl)
  })

  it('Should immediately throw an error if the URL is unsupported', () => {
    const backendUrl = 'blah://'
    const backendFactory = { getBackend: jest.fn() }

    expect(() => new Announce(backendUrl, { backendFactory })).toThrow(Error)
    expect(backendFactory.getBackend).toHaveBeenCalledWith(backendUrl)
  })
})

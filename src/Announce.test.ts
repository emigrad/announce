import { Deferred } from 'ts-deferred'
import { Announce } from './Announce'
import { InMemoryBackend } from './backends'
import { getCompleteMessage } from './util'
import { jsonSerializer, log } from './middleware'
import { Logger, Message, Subscriber } from './types'

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
        announce.publish(getCompleteMessage({ body: { hi: 'there' }, topic }))
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
    announce.use(log(logger))

    await announce.subscribe(subscriber)
    await announce.publish(
      getCompleteMessage({ topic: 'foo', body: Buffer.from('hi there') })
    )

    await dfd.promise
  })

  it('Should be able to round-trip a JSON-encoded message', async () => {
    const dfd = new Deferred()
    const announce = new Announce('memory://')
    const body = { hi: 'there' }
    announce.use(jsonSerializer())

    await announce.subscribe({
      name: 'test',
      topics: ['test'],
      handle(message: Message<any>) {
        dfd.resolve(message)
      }
    })
    await announce.publish({ topic: 'test', body })

    expect(await dfd.promise).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
      body
    })
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

  it('Should close the backend when the backend encounters an error', async () => {
    const error = new Error()
    const errorDfd = new Deferred()
    const closeDfd = new Deferred()
    const backend = new InMemoryBackend()
    const backendFactory = {
      getBackend: jest.fn().mockReturnValue(backend)
    }
    // Simulate a rejection of the close promise, to ensure we correctly
    // handle it
    backend.close = jest.fn().mockRejectedValue(undefined)

    const announce = new Announce('memory://', { backendFactory })
    announce.on('error', errorDfd.resolve)
    announce.on('close', closeDfd.resolve)

    // Report a unrecoverable error
    backend.emit('error', error)

    expect(await errorDfd.promise).toBe(error)
    expect(backend.close).toHaveBeenCalled()

    await closeDfd.promise
  })

  it.each([false, true])(
    'Should emit a close event when closing, even if the backend rejects the promise (rejected %p)',
    async (rejection) => {
      const dfd = new Deferred()
      const backend = new InMemoryBackend()
      const backendFactory = { getBackend: jest.fn().mockReturnValue(backend) }
      // Simulate a rejection of the close promise, to ensure we correctly
      // handle it
      if (rejection) {
        backend.close = () => Promise.reject()
      } else {
        backend.close = () => Promise.resolve()
      }

      const announce = new Announce('memory://', { backendFactory })
      announce.on('close', dfd.resolve)

      await announce.close()
      await dfd.promise
    }
  )

  it('Should support with()', async () => {
    const rawDfd = new Deferred()
    const jsonDfd = new Deferred()
    const middleware = {
      publish: jest.fn(({ message, next }) => next(message))
    }
    const announce = new Announce('memory://')
    announce.use(() => middleware)
    const jsonAnnounce = announce.with(jsonSerializer())
    const message = { topic: 'blah', body: { hi: 'there' } }

    await announce.subscribe({
      name: 'raw',
      topics: ['*'],
      handle: rawDfd.resolve
    })
    await jsonAnnounce.subscribe({
      name: 'json',
      topics: ['*'],
      handle: jsonDfd.resolve
    })

    // The base announce should not serialise the message to a Buffer,
    // so should not be able to publish non-buffer messages
    await expect(announce.publish(message)).rejects.toBeDefined()

    middleware.publish.mockClear()

    // This should succeed because we have the JSON middleware
    await jsonAnnounce.publish(message)

    expect(((await rawDfd.promise) as Message<any>).body).toBeInstanceOf(Buffer)
    expect(((await jsonDfd.promise) as Message<any>).body).toEqual(message.body)

    // The base announce's middleware should have been called before the
    // json announce's middleware. If it's called after, the message body
    // will be a Buffer instead
    expect(middleware.publish).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining(message) })
    )
  })

  it('Should skip non-publish middlewares when publishing', async () => {
    const dfd = new Deferred()
    const middleware = {
      subscribe: jest.fn(({ subscriber, next }) => next(subscriber))
    }
    const announce = new Announce('memory://')
    announce.use(jsonSerializer(), () => middleware)

    await announce.subscribe({
      name: 'json',
      topics: ['*'],
      handle: dfd.resolve
    })

    const message = { topic: 'blah', body: { hi: 'there' } }
    await announce.publish(message)

    expect(await dfd.promise).toMatchObject(message)
  })

  it(`with()'ed instances should still emit events`, async () => {
    const dfd = new Deferred()
    const announce = new Announce('memory://')
    announce.with(jsonSerializer()).on('close', dfd.resolve)

    await announce.close()
    await dfd.promise
  })

  it('Calling close() more than once should be a no-op', () => {
    const announce = new Announce('memory://')

    expect(announce.close()).toBe(announce.close())
  })
})

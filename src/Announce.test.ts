import { Deferred } from 'ts-deferred'
import { Announce } from './Announce'
import { InMemoryBackend } from './backends'
import { createMessage, getCompleteMessage } from './util'
import { json, log } from './middleware'
import { Logger, Message, MiddlewareArgs, Subscriber } from './types'

describe('Announce', () => {
  beforeEach(() => {
    delete process.env.ANNOUNCE_BACKEND_URL
  })

  it.each(['***', ' hello', '..foo', '.bar', 'bar.', 'something-else'])(
    'Should reject subscribers that listen to invalid topic %p',
    async (topic) => {
      const subscriber: Subscriber<any> = {
        queueName: 'test',
        topics: [topic],
        handle: jest.fn()
      }
      const announce = new Announce('memory://')

      await expect(announce.subscribe(subscriber)).rejects.toBeDefined()
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
      queueName: 'test',
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
    announce.use(json())

    await announce.subscribe({
      queueName: 'test',
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
    const publishMiddleware = jest.fn(({ message, next }) => next(message))
    const announce = new Announce('memory://')
    announce.use(({ addPublishMiddleware }) =>
      addPublishMiddleware(publishMiddleware)
    )
    const jsonAnnounce = announce.with(json())
    const message = { topic: 'blah', body: { hi: 'there' } }

    await announce.subscribe({
      queueName: 'raw',
      topics: ['*'],
      handle: rawDfd.resolve
    })
    await jsonAnnounce.subscribe({
      queueName: 'json',
      topics: ['*'],
      handle: jsonDfd.resolve
    })

    // The base announce should not serialise the message to a Buffer,
    // so should not be able to publish non-buffer messages
    await expect(announce.publish(message)).rejects.toBeDefined()

    publishMiddleware.mockClear()

    // This should succeed because we have the JSON middleware
    await jsonAnnounce.publish(message)

    expect(((await rawDfd.promise) as Message<any>).body).toBeInstanceOf(Buffer)
    expect(((await jsonDfd.promise) as Message<any>).body).toEqual(message.body)

    // The base announce's middleware should have been called after the
    // json announce's middleware since it was defined first and we're publishing, therefore
    // it should receive a Buffer
    expect(publishMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          body: Buffer.from(JSON.stringify(message.body))
        })
      })
    )
  })

  it('Should skip non-publish middlewares when publishing', async () => {
    const dfd = new Deferred()
    const middleware = {
      subscribe: jest.fn(({ subscriber, next }) => next(subscriber))
    }
    const announce = new Announce('memory://')
    announce.use(json(), () => middleware)

    await announce.subscribe({
      queueName: 'json',
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
    announce.with(json()).on('close', dfd.resolve)

    await announce.close()
    await dfd.promise
  })

  it('Calling close() more than once should be a no-op', () => {
    const announce = new Announce('memory://')

    expect(announce.close()).toBe(announce.close())
  })

  it('Should correctly handle subscribers that are class instances', async () => {
    const subscriber = new TestSubscriber()
    const announce = new Announce('memory://')
    const body = Buffer.from('hi there')
    await announce.subscribe(subscriber)

    await announce.publish(createMessage(subscriber.topics[0], body))

    expect(await subscriber.dfd.promise).toMatchObject({ body })
  })

  it('Should prevent middleware from registering handlers/subscribers after it has completed', () => {
    let args: MiddlewareArgs
    const announce = new Announce('memory://')
    announce.use((_args) => (args = _args))

    expect(() => args.addSubscribeMiddleware(async () => {})).toThrowError(
      'addSubscribeMiddleware() must be called immediately'
    )
    expect(() => args.addPublishMiddleware(async () => {})).toThrowError(
      'addPublishMiddleware() must be called immediately'
    )
    expect(() => args.addHandleMiddleware(async () => {})).toThrowError(
      'addHandleMiddleware() must be called immediately'
    )
  })
})

class TestSubscriber implements Subscriber<Buffer> {
  topics = ['test.test']
  queueName = 'test'
  dfd: Deferred<any>

  constructor() {
    this.dfd = new Deferred()
  }

  handle(message: Message<Buffer>) {
    this.dfd.resolve(message)
  }
}

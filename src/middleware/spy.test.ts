import { Announce } from '../Announce'
import { Subscriber } from '../types'
import { createMessage, getCompleteMessage } from '../util'
import { spy } from './spy'

describe('spy middleware', () => {
  it('Should notify of successful subscriptions', async () => {
    const announce = new Announce('memory://')
    const beforeSubscribe = jest.fn()
    const onSubscribe = jest.fn()
    const subscriber: Subscriber<any> = {
      name: 'test',
      topics: ['test'],
      handle: () => {}
    }

    announce.use(spy({ beforeSubscribe, onSubscribe }))

    await announce.subscribe(subscriber)

    // Note that the handle function is altered by announce
    expect(beforeSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        announce
      })
    )
    expect(onSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        announce
      })
    )
  })

  it('Should notify of failed subscriptions', async () => {
    const announce = new Announce('memory://')
    const onSubscribeError = jest.fn()
    const subscriber: Subscriber<any> = {
      name: 'test',
      topics: ['test'],
      handle: () => {}
    }
    const error = new Error('Oh no')

    announce.use(spy({ onSubscribeError }), () => ({
      subscribe: () => {
        throw error
      }
    }))

    await expect(announce.subscribe(subscriber)).rejects.toBe(error)

    // Note that the handle function is altered by announce
    expect(onSubscribeError).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        error,
        announce
      })
    )
  })

  it('Should notify of successful publishes', async () => {
    const announce = new Announce('memory://')
    const beforePublish = jest.fn()
    const onPublish = jest.fn()
    const message = getCompleteMessage(createMessage('hi', Buffer.from('')))

    announce.use(spy({ beforePublish, onPublish }))
    await announce.publish(message)

    expect(beforePublish).toHaveBeenCalledWith({ message, announce })
    expect(onPublish).toHaveBeenCalledWith({ message, announce })
  })

  it('Should notify of failed publishes', async () => {
    const announce = new Announce('memory://')
    const onPublishError = jest.fn()
    const message = getCompleteMessage(
      createMessage('hi', 'Strings are not allowed - must be a Buffer')
    )

    announce.use(spy({ onPublishError }))
    await expect(announce.publish(message)).rejects.toBeInstanceOf(Error)

    expect(onPublishError).toHaveBeenCalledWith(
      expect.objectContaining({
        message,
        announce,
        error: expect.any(Error)
      })
    )
  })

  it('Should notify when a message is successfully handled', async () => {
    const announce = new Announce('memory://')
    const beforeHandle = jest.fn()
    const onHandle = jest.fn()
    const subscriber: Subscriber<any> = {
      name: 'test',
      topics: ['test'],
      handle: () => {}
    }
    const message = getCompleteMessage(
      createMessage(subscriber.topics[0], Buffer.from(''))
    )

    announce.use(spy({ beforeHandle, onHandle }))

    await announce.subscribe(subscriber)
    await announce.publish(message)

    // Note that the handle function is altered by announce
    expect(beforeHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        message,
        announce
      })
    )
    expect(onHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        message,
        announce
      })
    )
  })

  it('Should notify when a message is rejected', async () => {
    const announce = new Announce('memory://')
    const onHandleError = jest.fn()
    const error = new Error('Oh no')
    const subscriber: Subscriber<any> = {
      name: 'test',
      topics: ['test'],
      handle: () => {
        throw error
      }
    }
    const message = getCompleteMessage(
      createMessage(subscriber.topics[0], Buffer.from(''))
    )

    announce.use(spy({ onHandleError }))

    await announce.subscribe(subscriber)
    await announce.publish(message)

    // Note that the handle function is altered by announce
    expect(onHandleError).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber: {
          name: subscriber.name,
          topics: subscriber.topics,
          handle: expect.any(Function)
        },
        message,
        announce,
        error
      })
    )
  })
})

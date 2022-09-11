import {
  HandleMiddleware,
  Message,
  MiddlewareArgs,
  PublishMiddleware,
  Subscriber
} from '../types'
import { getCompleteMessage, getHeader } from '../util'
import { json } from './json'

describe('json middleware', () => {
  const subscriber = {} as Subscriber
  let publishMiddleware: PublishMiddleware
  let handleMiddleware: HandleMiddleware

  beforeAll(() => {
    json()({
      addPublishMiddleware(_publishMiddleware) {
        publishMiddleware = _publishMiddleware
      },
      addHandleMiddleware(_handleMiddleware) {
        handleMiddleware = _handleMiddleware
      }
    } as MiddlewareArgs)
  })

  it('Should stringify messages that are not Buffers', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const message = { body: { hi: 'there' } } as Message

    expect(await publishMiddleware({ message, next })).toBe(nextResult)
    expect(JSON.parse(next.mock.calls[0][0].body.toString())).toEqual(
      message.body
    )
    expect(getHeader(next.mock.calls[0][0] as Message, 'Content-Type')).toBe(
      'application/json'
    )
  })

  it('Should not stringify messages with a Buffer body', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const message = {
      body: Buffer.from('hi there'),
      headers: {}
    } as Message

    expect(await publishMiddleware({ message, next })).toBe(nextResult)
    expect(next).toHaveBeenCalledWith(message)
    expect(
      getHeader(next.mock.calls[0][0] as Message, 'Content-Type')
    ).not.toBeDefined()
  })

  it('Should parse messages with a content type of application/json', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const body = { hi: 'there' }
    const message = getCompleteMessage({
      topic: 'fred',
      body: Buffer.from(JSON.stringify(body)),
      headers: { 'content-type': 'application/json' }
    })

    expect(await handleMiddleware({ message, next, subscriber })).toBe(
      nextResult
    )
    expect(next.mock.calls[0][0].body).toEqual(body)
  })

  it.each(['binary/image', undefined])(
    'Should not parse messages with a content type of %p',
    async (contentType) => {
      const nextResult = '55'
      const next = jest.fn().mockResolvedValue(nextResult)
      const message = getCompleteMessage({
        topic: 'fred',
        body: Buffer.from('1234'),
        headers: { 'content-type': contentType as string }
      })

      expect(await handleMiddleware({ message, next, subscriber })).toBe(
        nextResult
      )
      expect(next).toHaveBeenCalledWith(message)
    }
  )
})

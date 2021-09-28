import { Announce } from '../Announce'
import { getHeader } from '../selectors'
import { Message, Subscriber } from '../types'
import { jsonSerializer } from './jsonSerializer'

describe('JSONSerializer', () => {
  const announce = {} as Announce
  const serializer = jsonSerializer()(announce)
  const subscriber = {} as Subscriber<any>

  it('Should stringify messages that are not Buffers', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const message = { body: { hi: 'there' } } as Message<any>

    expect(await serializer.publish!({ message, next })).toBe(nextResult)
    expect(JSON.parse(next.mock.calls[0][0].body.toString())).toEqual(
      message.body
    )
    expect(
      getHeader(next.mock.calls[0][0] as Message<any>, 'Content-Type')
    ).toBe('application/json')
  })

  it('Should not stringify messages with a Buffer body', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const message = {
      body: Buffer.from('hi there'),
      headers: {}
    } as Message<any>

    expect(await serializer.publish!({ message, next })).toBe(nextResult)
    expect(next).toHaveBeenCalledWith(message)
    expect(
      getHeader(next.mock.calls[0][0] as Message<any>, 'Content-Type')
    ).not.toBeDefined()
  })

  it('Should parse messages with a content type of application/json', async () => {
    const nextResult = '55'
    const next = jest.fn().mockResolvedValue(nextResult)
    const body = { hi: 'there' }
    const message = {
      body: Buffer.from(JSON.stringify(body)),
      topic: 'fred',
      headers: { id: '3', published: 'ff', 'content-type': 'application/json' }
    } as Message<any>

    expect(await serializer.handle!({ message, next, subscriber })).toBe(
      nextResult
    )
    expect(next.mock.calls[0][0].body).toEqual(body)
  })

  it.each(['binary/image', undefined])(
    'Should not parse messages with a content type of %p',
    async (contentType) => {
      const nextResult = '55'
      const next = jest.fn().mockResolvedValue(nextResult)
      const message = {
        body: Buffer.from('1234'),
        topic: 'fred',
        headers: { id: '3', published: 'ff', 'content-type': contentType }
      } as Message<any>

      expect(await serializer.handle!({ message, next, subscriber })).toBe(
        nextResult
      )
      expect(next).toHaveBeenCalledWith(message)
    }
  )
})

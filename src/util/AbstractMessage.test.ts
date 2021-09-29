import { AbstractMessage } from '.'

describe('Abstract message', () => {
  it('Should create a valid message', () => {
    const body = { fred: 4 }
    const message = new TestMessage(body)

    expect(message.body).toBe(body)
    expect(message.topic).toBe('test')
    expect(message.headers).toBeDefined()
    expect(message.properties).toBeDefined()
  })

  it('Should be able to set the headers and properties', () => {
    const body = { fred: 4 }
    const headers = { abc: 'def' }
    const properties = { id: '123' }
    const message = new TestMessage(body, headers, properties)

    expect(message.body).toBe(body)
    expect(message.topic).toBe('test')
    expect(message.headers).toBe(headers)
    expect(message.properties).toBe(properties)
  })
})

class TestMessage extends AbstractMessage<any> {
  topic = 'test'
}

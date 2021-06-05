import { AbstractMessage } from './index'

describe('Abstract message', () => {
  it('Should create a valid message', () => {
    const body = { fred: 4 }
    const message = new TestMessage(body)

    expect(message.body).toBe(body)
    expect(message.topic).toBe('test')
    expect(message.headers.id.length).toBeGreaterThan(10)
    expect(
      message.headers.published > new Date('2010-01-01').toISOString()
    ).toBe(true)
  })
})

class TestMessage extends AbstractMessage<any> {
  topic = 'test'
}

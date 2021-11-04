import { getHeader } from '../util'
import { Middleware } from '../types'

export const json: () => Middleware = () => () => ({
  async publish({ message, next }): Promise<void> {
    const { body, headers } = message

    if (!(body instanceof Buffer)) {
      message = {
        ...message,
        body: Buffer.from(JSON.stringify(body)),
        headers: { ...headers, 'Content-Type': 'application/json' }
      }
    }

    return next(message)
  },

  async handle({ message, next }): Promise<void> {
    if (getHeader(message, 'Content-Type') === 'application/json') {
      return next({
        ...message,
        body: JSON.parse(message.body.toString())
      })
    } else {
      return next(message)
    }
  }
})

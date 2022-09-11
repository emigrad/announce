import { getHeader } from '../util'
import { Middleware } from '../types'

export const json: () => Middleware =
  () =>
  ({ addPublishMiddleware, addHandleMiddleware }) => {
    addPublishMiddleware(async ({ message, next }) => {
      const { body, headers } = message

      if (!(body instanceof Buffer)) {
        message = {
          ...message,
          body: Buffer.from(JSON.stringify(body)),
          headers: { ...headers, 'Content-Type': 'application/json' }
        }
      }

      return next(message)
    })

    addHandleMiddleware(async ({ message, next }) => {
      if (getHeader(message, 'Content-Type') === 'application/json') {
        return next({
          ...message,
          body: JSON.parse(String(message.body))
        })
      } else {
        return next(message)
      }
    })
  }

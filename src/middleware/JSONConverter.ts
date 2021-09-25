import { getHeader } from '../selectors'
import {
  HandleMiddlewareArgs,
  Middleware,
  PublishMiddlewareArgs
} from '../types'

export class JSONConverter implements Middleware {
  async publish({ message, next }: PublishMiddlewareArgs): Promise<void> {
    const { body, headers } = message

    if (!(body instanceof Buffer)) {
      message = {
        ...message,
        body: Buffer.from(JSON.stringify(body)),
        headers: { ...headers, 'Content-Type': 'application/json' }
      }
    }

    return next(message)
  }

  async handle({ message, next }: HandleMiddlewareArgs): Promise<void> {
    if (getHeader(message, 'Content-Type') === 'application/json') {
      return next({
        ...message,
        body: JSON.parse(message.body.toString())
      })
    } else {
      return next(message)
    }
  }
}

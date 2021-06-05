import cuid from 'cuid'
import { Headers, Message } from '../types'

export abstract class AbstractMessage<Body extends {}>
  implements Message<Body>
{
  public abstract topic: string
  public headers: Headers
  public body: Body

  constructor(body: Body, headers?: Partial<Headers>) {
    this.body = body
    this.headers = getCompleteHeaders(headers)
  }
}

export function getCompleteHeaders(headers?: Partial<Headers>): Headers {
  return { id: cuid(), published: new Date().toISOString(), ...headers }
}

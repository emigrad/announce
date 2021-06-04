import { Optional } from './lib'

export interface Headers {
  /**
   * The message's unique ID
   */
  id: string
  /**
   * When the message was published
   */
  published: Date
}

export type Message<Body extends {} | undefined> = Body extends {}
  ? MessageWithBody<Body>
  : Optional<MessageWithBody<{}>, 'body'>

export interface MessageWithBody<Body extends {} | undefined> {
  /** The topic of the message. Must be a dotted string */
  topic: string
  /** Metadata about the message */
  headers: Headers
  /** The actual data. Must be JSON-serialisable */
  body: Body
}

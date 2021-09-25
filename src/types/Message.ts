export interface Headers {
  /**
   * The message's unique ID
   */
  id: string
  /**
   * When the message was published, in ISO 8601 format
   */
  published: string
  /**
   * Any other metadata that should be sent with
   */
  [key: string]: string
}

export interface Message<Body extends any> {
  /** The topic of the message. Must be a dotted string */
  topic: string
  /** Metadata about the message */
  headers: Headers
  /** The actual data. Must be JSON-serialisable */
  body: Body
}

export type PublishMessage<Body extends any> = Omit<
  Message<Body>,
  'headers'
> & {
  headers?: Record<string, string>
}

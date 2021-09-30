export interface UnpublishedMessage<Body extends any> {
  /** The topic of the message. Must be a dotted string */
  topic: string
  /** The actual data. Must be JSON-serialisable */
  body: Body
  /** Application-specific headers */
  headers?: Record<string, string>
  /** The message's metadata */
  properties?: Partial<MessageProperties>
}

export interface Message<Body extends any>
  extends Required<UnpublishedMessage<Body>> {
  /** The message's metadata */
  properties: MessageProperties
}

export interface MessageProperties {
  /** The message's unique ID */
  id: string
  /** When the message was published */
  date: Date
}

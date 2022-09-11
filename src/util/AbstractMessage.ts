import { MessageProperties, UnpublishedMessage } from '../types'

/**
 * This is a utility class
 */
export abstract class AbstractMessage<Body = unknown>
  implements UnpublishedMessage<Body>
{
  public abstract topic: string
  public headers: Record<string, string>
  public properties: Partial<MessageProperties>
  public body: Body

  constructor(
    body: Body,
    headers: Record<string, string> = {},
    properties: Partial<MessageProperties> = {}
  ) {
    this.body = body
    this.headers = headers
    this.properties = properties
  }
}

import { Announce } from '../Announce'
import { Message } from './Message'

export interface Handler<Body = unknown> {
  (message: Message<Body>, args: HandlerArgs): unknown | Promise<unknown>
}

export interface HandlerArgs {
  announce: Announce
}

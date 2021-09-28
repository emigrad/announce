import { Announce } from '../Announce'
import { Message } from './Message'

export interface Handler<Body extends any> {
  (message: Message<Body>, args: HandlerArgs): any | Promise<any>
}

export interface HandlerArgs {
  announce: Announce
}

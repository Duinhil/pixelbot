import { EventEmitter } from 'events';

export interface EmoteRef {
  id: string;
  name: string;
  begin: number;
  end: number;
}

export type OverlayEvent =
  | { type: 'chat.message';   ts: number; sender: string; text: string; emotes: EmoteRef[] }
  | { type: 'stream.online';  ts: number; broadcasterName: string }
  | { type: 'stream.offline'; ts: number; broadcasterName: string }
  | { type: 'redemption';     ts: number; rewardId: string; rewardTitle: string; userId: string; userLogin: string; userInput: string }
  | { type: 'ping';           ts: number };

export const overlayBus = new EventEmitter();

export function emitOverlayEvent(event: OverlayEvent): void {
  overlayBus.emit('event', event);
}

import mqtt from 'mqtt';
import colourNameList from 'color-name-list';
import { config } from './config';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const COLOUR_MAP: Record<string, [number, number, number]> = Object.fromEntries(
  (colourNameList as { name: string; hex: string }[]).map(({ name, hex }) => [
    name.toLowerCase().replace(/\s+/g, ' '),
    hexToRgb(hex),
  ])
);

let client: mqtt.MqttClient | null = null;

export function initLights(): void {
  if (!config.mqttBrokerUrl) {
    console.log('[lights] No MQTT broker configured — skipping.');
    return;
  }
  client = mqtt.connect(config.mqttBrokerUrl, {
    username: config.mqttUsername,
    password: config.mqttPassword,
    reconnectPeriod: 5000,
  });
  client.on('connect', () => console.log('[lights] MQTT connected'));
  client.on('error', (err) => console.error('[lights] MQTT error:', err));
  client.on('offline', () => console.warn('[lights] MQTT offline'));
}

export function publishColour(r: number, g: number, b: number): void {
  client?.publish('pixellights/colour', JSON.stringify({ r, g, b }));
}

export function publishPower(on: boolean): void {
  client?.publish('pixellights/power', JSON.stringify({ on }));
}

export function publishEffect(id: number, speed = 16, brightness = 100): void {
  client?.publish('pixellights/effect', JSON.stringify({ id, speed, brightness }));
}

export function parseColour(args: string[]): { r: number; g: number; b: number } | null {
  if (!args.length) return null;

  // Named colour — try progressively shorter phrases (e.g. "hot pink" before "hot")
  for (let len = args.length; len >= 1; len--) {
    const phrase = args.slice(0, len).join(' ').toLowerCase();
    const named = COLOUR_MAP[phrase];
    if (named) return { r: named[0], g: named[1], b: named[2] };
  }

  // R G B as three decimal integers (checked before 3-char hex to avoid ambiguity)
  if (args.length >= 3 && args.slice(0, 3).every((a) => /^\d+$/.test(a))) {
    const r = parseInt(args[0], 10);
    const g = parseInt(args[1], 10);
    const b = parseInt(args[2], 10);
    if ([r, g, b].every((v) => v >= 0 && v <= 255)) return { r, g, b };
  }

  // Hex: #RRGGBB, RRGGBB, #RGB, RGB
  const hex = args[0].replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }

  return null;
}

export function colourToHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

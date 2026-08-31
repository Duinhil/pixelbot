import mqtt from 'mqtt';
import { config } from './config';

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

const CSS_COLOURS: Record<string, [number, number, number]> = {
  red:     [255,   0,   0],
  green:   [  0, 255,   0],
  blue:    [  0,   0, 255],
  yellow:  [255, 255,   0],
  cyan:    [  0, 255, 255],
  magenta: [255,   0, 255],
  white:   [255, 255, 255],
  orange:  [255, 165,   0],
  purple:  [128,   0, 128],
  pink:    [255, 105, 180],
  black:   [  0,   0,   0],
  teal:    [  0, 128, 128],
  lime:    [  0, 255,   0],
  indigo:  [ 75,   0, 130],
  violet:  [238, 130, 238],
  gold:    [255, 215,   0],
  silver:  [192, 192, 192],
};

export function parseColour(args: string[]): { r: number; g: number; b: number } | null {
  if (!args.length) return null;

  // Named colour
  const named = CSS_COLOURS[args[0].toLowerCase()];
  if (named) return { r: named[0], g: named[1], b: named[2] };

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

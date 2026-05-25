// --- MascotRenderer ---
// Image renderer: loads /{clipName}.svg and displays it for durationMs.
// Replace play() with real spritesheet / frame / Lottie logic when final assets exist.

class MascotRenderer {
  constructor(container) {
    this._el = document.createElement('img');
    this._el.style.cssText = 'display:none; width:200px; height:200px;';
    container.appendChild(this._el);
    this._timer = null;
  }

  play(clipName, loop, durationMs, onComplete) {
    this._cancel();
    this._el.src = `/${clipName}.svg`;
    this._el.style.display = 'block';
    if (!loop) {
      this._timer = setTimeout(onComplete, durationMs);
    }
  }

  stop() {
    this._cancel();
    this._el.style.display = 'none';
  }

  _cancel() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}

// --- MascotStateMachine ---

const QUEUE_MAX = 5;

class MascotStateMachine {
  constructor(renderer, config) {
    this._renderer = renderer;
    this._config = config;
    this._state = 'hidden';
    this._queue = [];
    this._idleTimer = null;
  }

  // Public: called when a command or redemption maps to an animation state name.
  trigger(stateName) {
    if (!this._config.states[stateName]) {
      console.warn('[mascot] unknown state:', stateName);
      return;
    }
    switch (this._state) {
      case 'hidden':
        this._queue.push(stateName);
        this._transition('entering');
        break;
      case 'idle':
        this._cancelIdleTimer();
        this._transition('animating', stateName);
        break;
      case 'entering':
      case 'animating':
      case 'exiting':
        if (this._queue.length < QUEUE_MAX) {
          this._queue.push(stateName);
        }
        break;
    }
  }

  _transition(state, stateName) {
    this._state = state;
    console.log(`[mascot] → ${state}${stateName ? ` (${stateName})` : ''}`);

    switch (state) {
      case 'entering': {
        const s = this._config.states['enter'];
        this._renderer.play(s.clip, false, s.durationMs, () => this._onClipComplete());
        break;
      }
      case 'animating': {
        const s = this._config.states[stateName];
        this._renderer.play(s.clip, false, s.durationMs, () => this._onClipComplete());
        this._currentStateName = stateName;
        break;
      }
      case 'idle': {
        const s = this._config.states['idle'];
        this._renderer.play(s.clip, true, s.durationMs, null);
        this._startIdleTimer();
        break;
      }
      case 'exiting': {
        const s = this._config.states['exit'];
        this._renderer.play(s.clip, false, s.durationMs, () => this._onClipComplete());
        break;
      }
      case 'hidden': {
        this._renderer.stop();
        break;
      }
    }
  }

  _onClipComplete() {
    switch (this._state) {
      case 'entering':
      case 'animating': {
        const next = this._queue.shift();
        if (next) {
          this._transition('animating', next);
        } else {
          this._transition('idle');
        }
        break;
      }
      case 'exiting': {
        if (this._queue.length > 0) {
          this._transition('entering');
        } else {
          this._transition('hidden');
        }
        break;
      }
    }
  }

  _startIdleTimer() {
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      this._transition('exiting');
    }, this._config.idleTimeoutMs);
  }

  _cancelIdleTimer() {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}

// --- Widget initialisation ---

async function initMascotWidget() {
  let config;
  try {
    config = await fetch('/mascot-config.json').then((r) => r.json());
  } catch (err) {
    console.error('[mascot] failed to load mascot-config.json:', err);
    return;
  }

  const container = document.createElement('div');
  container.className = 'widget';
  container.style.left = config.position.x;
  container.style.top = config.position.y;
  document.getElementById('canvas').appendChild(container);

  const renderer = new MascotRenderer(container);
  const sm = new MascotStateMachine(renderer, config);

  PixelOverlay.register('mascot', {
    onEvent(event) {
      if (event.type === 'command') {
        const state = config.commands[event.command];
        if (state) sm.trigger(state);
      } else if (event.type === 'redemption') {
        const state = config.redemptions[event.rewardId];
        if (state) sm.trigger(state);
      }
    },
  });

  console.log('[mascot] widget ready');
}

initMascotWidget();

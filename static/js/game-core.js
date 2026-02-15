/**
 * Shared Core Logic for Loto Game
 * Handles SSE connection, API calls, and common Audio utilities.
 */

export class GameClient {
    constructor(onStateUpdate) {
        this.onStateUpdate = onStateUpdate;
        this.eventSource = null;
        this.reconnectTimer = null;
    }

    connect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        try {
            console.log("Connecting to SSE...");
            this.eventSource = new EventSource('/api/game/stream');

            this.eventSource.onmessage = (event) => {
                try {
                    const state = JSON.parse(event.data);
                    if (this.onStateUpdate) this.onStateUpdate(state);
                } catch (e) {
                    console.warn('SSE parse error:', e);
                }
            };

            this.eventSource.onerror = (e) => {
                console.warn('SSE connection error, reconnecting in 3s...', e);
                this.eventSource.close();
                this.eventSource = null;
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = setTimeout(() => this.connect(), 3000);
            };
        } catch (e) {
            console.error("Error setting up SSE:", e);
        }
    }

    // API: Sync Volume
    async setVolume(data) {
        // data: { bg_volume, call_volume, duck_level, playback_rate }
        return this._post('/api/game/volume', data);
    }

    // API: Toggle BG Music
    async setBgMusic(enabled) {
        return this._post('/api/game/bg_music', { enabled });
    }

    // API: Call Number
    async callNumber(number, audioUrl, playbackRate = 1.0) {
        return this._post('/api/game/call', {
            number,
            audio_url: audioUrl,
            playback_rate: playbackRate
        });
    }

    // API: Done Call
    async doneCall() {
        return this._post('/api/game/done', {});
    }

    // API: Play Special (Start / Kinh)
    async playSpecial(url, rate = 1.0) {
        return this._post('/api/game/special', { audio_url: url, playback_rate: rate });
    }

    // API: Reset Game
    async resetGame() {
        return this._post('/api/game/reset', {});
    }

    async _post(url, body) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            return await res.json();
        } catch (e) {
            console.error(`Error posting to ${url}:`, e);
            throw e;
        }
    }
}

export const AudioUtils = {
    fadeTimers: new WeakMap(),

    /**
     * Smoothly fades an audio element to a target volume.
     * @param {HTMLAudioElement} el 
     * @param {number} target Target volume (0.0 to 1.0)
     * @param {number} duration Duration in ms
     * @param {Function} [cb] Callback when done
     */
    smoothFade(el, target, duration, cb) {
        // Clear existing fade for this element
        const existing = this.fadeTimers.get(el);
        if (existing) clearInterval(existing);

        const start = el.volume;
        const diff = target - start;

        // If change is very small, just set it
        if (Math.abs(diff) < 0.01) {
            el.volume = Math.max(0, Math.min(1, target));
            if (target > 0 && el.paused) {
                el.play().catch(e => console.warn('Fade play error', e));
            }
            if (cb) cb();
            return;
        }

        // Ensure playing if fading in
        if (target > 0 && el.paused) {
            el.play().catch(e => console.warn('Fade play error', e));
        }

        const steps = 20;
        const stepTime = duration / steps;
        const stepSize = diff / steps;
        let i = 0;

        const timer = setInterval(() => {
            i++;
            if (i >= steps) {
                el.volume = Math.max(0, Math.min(1, target));
                clearInterval(timer);
                this.fadeTimers.delete(el);
                if (cb) cb();
            } else {
                let nextVol = start + stepSize * i;
                el.volume = Math.max(0, Math.min(1, nextVol));
            }
        }, stepTime);

        this.fadeTimers.set(el, timer);
    },

    /**
     * Attempts to unlock audio context on user interaction.
     * @param {HTMLAudioElement} el Audio element to use for unlocking
     */
    unlock(el) {
        return new Promise((resolve, reject) => {
            el.volume = 0;
            el.play().then(() => {
                el.pause();
                el.currentTime = 0;
                resolve(true);
            }).catch((e) => {
                console.warn("Audio unlock failed:", e);
                resolve(false);
            });
        });
    }
};

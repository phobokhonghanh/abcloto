import { GameClient, AudioUtils } from './game-core.js';

// --- State ---
const state = {
    audioUnlocked: false,
    bgPlaying: false,
    isPlayingCall: false,

    lastStatus: '',
    lastPlayId: 0,
    lastLatestNumber: null,

    // Timers
    callSafetyTimer: null,
    callAudioTimeout: null
};

// --- DOM Elements ---
const els = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Cache Elements
    const id = (i) => document.getElementById(i);
    els.boardLeft = id('boardLeft');
    els.boardCenter = id('boardCenter');
    els.boardRight = id('boardRight');
    els.currentBox = id('currentBox');
    els.currentNumber = id('currentNumber');
    els.currentText = id('currentText');
    els.callCounter = id('callCounter');
    els.audioUnlock = id('audioUnlock');
    els.bgAudio = id('bgAudio');
    els.callAudio = id('callAudio');

    // Generate Board
    generateBoard();

    // Init Client
    window.gameClient = new GameClient(processState);

    // Bind Events
    window.unlockAudio = unlockAudio;

    // BG Error Handling
    els.bgAudio.onerror = () => {
        console.warn('Display: bg music error');
        state.bgPlaying = false;
        // Retry logic managed in processState recovery or here
        setTimeout(() => {
            if (!state.bgPlaying && state.audioUnlocked) {
                els.bgAudio.load();
                els.bgAudio.play().catch(() => { });
            }
        }, 5000);
    };
});

function generateBoard() {
    for (let i = 0; i < 100; i++) {
        const cell = document.createElement('div');
        cell.className = 'bingo-cell';
        cell.id = `cell-${i}`;
        cell.textContent = String(i).padStart(2, '0');

        if (i <= 35) {
            els.boardLeft.appendChild(cell);
        } else if (i <= 63) {
            els.boardCenter.appendChild(cell);
        } else {
            els.boardRight.appendChild(cell);
        }
    }
}

// --- Audio Handling ---
function unlockAudio() {
    // Attempt unlock with minimal playback
    els.bgAudio.volume = 0;
    els.bgAudio.play().then(() => {
        els.bgAudio.pause();
        els.bgAudio.currentTime = 0;
        activateDisplay();
    }).catch((e) => {
        console.warn("Audio unlock rejected:", e);
        // Try fallback activation anyway
        activateDisplay();
    });

    // Fallback if promise hangs
    setTimeout(() => {
        if (!state.audioUnlocked) activateDisplay();
    }, 3000);
}

function activateDisplay() {
    if (state.audioUnlocked) return;
    state.audioUnlocked = true;
    els.audioUnlock.classList.add('hidden');
    // Connect to Server only after interaction (optional, but good practice)
    window.gameClient.connect();
}

function forceRestoreBg(bgVol) {
    clearTimeout(state.callSafetyTimer);
    state.callSafetyTimer = null;

    if (!els.callAudio.paused) {
        els.callAudio.pause();
        els.callAudio.onended = null;
        els.callAudio.onerror = null;
    }

    if (state.bgPlaying && bgVol != null) {
        AudioUtils.smoothFade(els.bgAudio, bgVol, 500);
    }
}

// --- State Processing ---
function processState(gameState) {
    if (!state.audioUnlocked) return;

    try {
        // 1. Sync Playback Rate
        if (gameState.playback_rate) {
            if (Math.abs(els.callAudio.playbackRate - gameState.playback_rate) > 0.1) {
                els.callAudio.playbackRate = gameState.playback_rate;
            }
            if (Math.abs(els.bgAudio.playbackRate - gameState.playback_rate) > 0.1) {
                els.bgAudio.playbackRate = gameState.playback_rate;
            }
        }

        // 1.5 Handle Global Pause (Server-Side)
        if (gameState.hasOwnProperty('is_paused')) {
            if (gameState.is_paused) {
                // FORCE PAUSE
                if (!els.callAudio.paused) els.callAudio.pause();
                if (!els.bgAudio.paused) els.bgAudio.pause();
                // Return early? No, we still want to process other state changes (like board updates)
                // But we should prevent auto-play below.
            } else {
                // RESUME if applicable
                // Resume Call
                if (els.callAudio.paused && els.callAudio.src && !els.callAudio.ended && state.isPlayingCall) {
                    els.callAudio.play().catch(() => { });
                }
                // Resume BG (if it should be playing)
                // We rely on logic below to handle BG play/pause based on gameState.bg_music
            }
        }

        // If paused, we should bypass the auto-play logic below or ensure it doesn't trigger play()
        const isGlobalPause = gameState.is_paused;

        // 2. Background Music
        if (gameState.bg_music) {
            // Debug Log
            // console.log('BG Debug:', { ... });

            if (!isGlobalPause) {
                // Determine target volume
                let targetVol = gameState.bg_volume;
                if (state.isPlayingCall || !els.callAudio.paused) {
                    targetVol = gameState.duck_level * gameState.bg_volume;
                }

                // If not playing, start it
                if (els.bgAudio.paused || !state.bgPlaying) {
                    console.log("Starting BG Music...");
                    els.bgAudio.volume = 0;

                    const doPlay = () => {
                        els.bgAudio.play().then(() => {
                            state.bgPlaying = true;
                            // SYNC IMMEDIATELY AFTER START
                            if (gameState.bg_started_at) {
                                const duration = els.bgAudio.duration;
                                if (duration > 0) {
                                    let elapsed = gameState.server_time - gameState.bg_started_at;
                                    let target = (elapsed % duration + duration) % duration;
                                    if (Math.abs(els.bgAudio.currentTime - target) > 0.5) {
                                        els.bgAudio.currentTime = target;
                                        console.log("BG Start Synced to:", target);
                                    }
                                }
                            }
                            AudioUtils.smoothFade(els.bgAudio, targetVol, 1000);
                        }).catch(e => console.warn("BG Play Error:", e));
                    };

                    doPlay();
                }
                // If already playing, maintain volume and sync
                else {
                    // Volume
                    if (Math.abs(els.bgAudio.volume - targetVol) > 0.05) {
                        AudioUtils.smoothFade(els.bgAudio, targetVol, 500);
                    }

                    // Sync Check (Periodic)
                    if (gameState.bg_started_at) {
                        const duration = els.bgAudio.duration;
                        if (duration > 0) {
                            let elapsed = gameState.server_time - gameState.bg_started_at;
                            let target = (elapsed % duration + duration) % duration;

                            let diff = Math.abs(els.bgAudio.currentTime - target);
                            if (diff > duration / 2) diff = duration - diff; // Wrap around check

                            // If drift > 2.0s, hard sync
                            if (diff > 2.0) {
                                console.log(`BG Drift ${diff.toFixed(2)}s -> Resync to ${target.toFixed(2)}`);
                                els.bgAudio.currentTime = target;
                            }
                        }
                    }
                }
            }
        } else {
            // Should stop
            if (state.bgPlaying || !els.bgAudio.paused) {
                state.bgPlaying = false;
                AudioUtils.smoothFade(els.bgAudio, 0, 800, () => els.bgAudio.pause());
            }
        }

        // 3. Call Audio (New Call)
        if (gameState.play_id > 0 && gameState.play_id !== state.lastPlayId && gameState.audio_url) {
            // New call always resets pause state (server sets is_paused=False on new call)
            // So we don't need to check isGlobalPause here, assuming server did its job.
            state.lastPlayId = gameState.play_id;
            state.isPlayingCall = true;

            // Stop previous
            forceRestoreBg(null);

            // Duck BG
            if (state.bgPlaying || !els.bgAudio.paused) {
                const duckVol = gameState.duck_level * gameState.bg_volume;
                AudioUtils.smoothFade(els.bgAudio, duckVol, 300);
            }

            // Play Call
            const bgVol = gameState.bg_volume;
            els.callAudio.volume = gameState.call_volume;
            els.callAudio.src = gameState.audio_url;
            els.callAudio.playbackRate = gameState.playback_rate || 1.0;

            // Handlers
            els.callAudio.onended = () => {
                clearTimeout(state.callSafetyTimer);
                state.isPlayingCall = false;
                if (state.bgPlaying) AudioUtils.smoothFade(els.bgAudio, bgVol, 600);
            };

            els.callAudio.onerror = () => {
                console.warn('Display: call audio error');
                clearTimeout(state.callSafetyTimer);
                clearTimeout(state.callAudioTimeout);
                state.isPlayingCall = false;
                if (state.bgPlaying) AudioUtils.smoothFade(els.bgAudio, bgVol, 600);
            };

            // Sync Start / Late Join Logic
            els.callAudio.onloadedmetadata = () => {
                const duration = els.callAudio.duration;
                // Check server time
                if (gameState.started_at && gameState.server_time) {
                    const elapsed = gameState.server_time - gameState.started_at;
                    const seek = elapsed * (gameState.playback_rate || 1.0);
                    if (seek > 0) {
                        if (seek < duration) {
                            els.callAudio.currentTime = seek;
                        } else {
                            // Finished already
                            els.callAudio.currentTime = duration;
                        }
                    }
                }

                // Safety Timeout
                clearTimeout(state.callAudioTimeout);
                state.callAudioTimeout = setTimeout(() => {
                    forceRestoreBg(bgVol);
                    state.isPlayingCall = false;
                }, (duration * 1000) + 5000);
            };

            els.callAudio.play().catch(e => {
                console.warn('Display: cannot play call audio:', e);
                // Retry once
                setTimeout(() => {
                    els.callAudio.play().catch(() => {
                        state.isPlayingCall = false;
                        if (state.bgPlaying) AudioUtils.smoothFade(els.bgAudio, bgVol, 600);
                    });
                }, 500);
            });
        }

        // 4. Cleanup/Restore if Admin moved on
        if ((gameState.status === 'showing' || gameState.status === 'idle')) {
            // Check if audio is still playing significantly
            if (!els.callAudio.paused && !els.callAudio.ended) {
                const remaining = els.callAudio.duration - els.callAudio.currentTime;
                // Heuristic: If > 1.0s remaining, assume SKIP or Reset -> Force Stop
                // If < 1.0s, assume natural finish (desync) -> let it finish
                if (remaining > 1.0) {
                    console.log("Forcing stop (Skip/Reset detected) - Immediate");
                    // Stop immediately
                    els.callAudio.pause();
                    state.isPlayingCall = false;
                    // Restore BG smoothly
                    if (state.bgPlaying) AudioUtils.smoothFade(els.bgAudio, gameState.bg_volume, 600);
                }
            } else if (state.isPlayingCall && els.callAudio.paused) {
                // If paused but we think playing (maybe just finished?), ensure state cleanup
                state.isPlayingCall = false;
            }

            // Ensure BG restores if call is done
            if (els.callAudio.paused || els.callAudio.ended) {
                if (state.bgPlaying && els.bgAudio.volume < gameState.bg_volume * 0.8) {
                    AudioUtils.smoothFade(els.bgAudio, gameState.bg_volume, 600);
                }
            }
        }

        state.lastStatus = gameState.status;

        // 5. Visual Updates
        if (gameState.called_numbers) {
            els.callCounter.textContent = `${gameState.called_numbers.length}/100`;
        }

        if (gameState.status === 'idle') {
            els.currentBox.className = 'current-number-box waiting';
            els.currentNumber.textContent = '--';
            els.currentText.textContent = 'Chờ hô số...';
        } else if (gameState.status === 'playing') {
            els.currentBox.className = 'current-number-box playing';
            els.currentNumber.textContent = '♪';
            els.currentText.textContent = 'Đang kêu số...';
        } else if (gameState.status === 'showing') {
            if (state.lastStatus !== 'showing') {
                els.currentBox.className = 'current-number-box showing';
            }
            els.currentNumber.textContent = String(gameState.current_number).padStart(2, '0');
            els.currentText.textContent = '';
        }

        // 6. Board Highlighting
        // Clear previous latest
        if (state.lastLatestNumber !== null) {
            const prev = document.getElementById(`cell-${state.lastLatestNumber}`);
            if (prev) prev.classList.remove('latest');
        }

        // Reset
        if (gameState.called_numbers.length === 0) {
            document.querySelectorAll('.bingo-cell').forEach(c => {
                c.classList.remove('active', 'latest');
            });
            state.lastLatestNumber = null;
        } else {
            // Apply batches (optimize?)
            gameState.called_numbers.forEach(item => {
                const cell = document.getElementById(`cell-${item.number}`);
                if (cell) cell.classList.add('active');
            });

            const latest = gameState.called_numbers[gameState.called_numbers.length - 1];
            if (latest) {
                const cell = document.getElementById(`cell-${latest.number}`);
                if (cell) {
                    cell.classList.add('latest');
                    state.lastLatestNumber = latest.number;
                }
            }
        }

    } catch (e) {
        console.error('processState error:', e);
    }
}

// --- Local Mute ---
state.localMute = false;

function toggleLocalMute() {
    state.localMute = !state.localMute;

    // Apply
    els.bgAudio.muted = state.localMute;
    els.callAudio.muted = state.localMute;

    // UI
    const btn = document.getElementById('btnLocalMute');
    if (btn) {
        if (state.localMute) {
            btn.classList.add('muted');
            btn.querySelector('.icon').textContent = '🔇';
            btn.title = "Bật tiếng";
        } else {
            btn.classList.remove('muted');
            btn.querySelector('.icon').textContent = '🔊';
            btn.title = "Tắt tiếng (Chỉ máy này)";
        }
    }
}
window.toggleLocalMute = toggleLocalMute;

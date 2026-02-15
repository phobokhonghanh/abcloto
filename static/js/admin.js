import { GameClient, AudioUtils } from './game-core.js';

// --- State & Config ---
const state = {
    calledSet: new Set(),
    callQueue: JSON.parse(localStorage.getItem('loto_queue') || '[]'),
    isProcessingQueue: false,
    isBusy: false,

    // Audio State
    bgMusicPlaying: false,
    localMute: false,
    bgMaxVolume: 0.8,
    callVolume: 1.0,
    duckLevel: 0.15,
    playbackRate: 1.0,

    currentNumber: null, // Track current number for skip logic

    // Timers
    safetyTimer: null,
    syncTimer: null,

    // Priority Audio State
    priorityAudio: {
        active: false,
        muteBg: false
    },

    initialSyncDone: false
};

// --- DOM Elements ---
const els = {};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Cache elements
    const id = (i) => document.getElementById(i);
    els.numberInput = id('numberInput');
    els.btnCall = document.querySelector('.btn-call');
    els.btnSkip = id('btnSkip');
    els.btnRandom = document.querySelector('.btn-random');
    els.status = id('status');
    els.calledCount = id('calledCount');
    els.bgAudio = id('bgAudio');
    els.audioPlayer = id('audioPlayer');
    els.volumePanel = id('volumePanel');
    els.bgVolLabel = id('bgVolLabel');
    els.callVolLabel = id('callVolLabel');
    els.bgMusicBtn = id('bgMusicBtn');
    els.queueContainer = id('queueContainer');
    els.queueList = id('queueList');
    els.progressContainer = id('progressContainer');
    els.progressBar = document.getElementById('progressBar');
    els.timeDisplay = id('timeDisplay');

    els.iconPlay = id('iconPlay');
    els.iconPause = id('iconPause');

    // Init Client
    window.gameClient = new GameClient(onServerStateUpdate);
    window.gameClient.connect();

    // Init Sounds
    loadSounds('start');
    loadSounds('end');

    // Bind Global Events (for HTML onclicks)
    window.addToQueue = addToQueue;
    window.randomCall = randomCall;
    window.skipCurrent = skipCurrent;
    window.startGame = startGame;
    window.kinhGame = kinhGame;
    window.resetGame = resetGame;
    window.toggleVolPanel = toggleVolPanel;
    window.setBgVolume = setBgVolume;
    window.setCallVolume = setCallVolume;
    window.setPlaybackRate = setPlaybackRate;
    window.toggleBgMusic = toggleBgMusic;
    window.removeFromQueue = removeFromQueue;
    window.clearQueue = clearQueue;
    window.togglePlayPause = togglePlayPause;
    window.toggleLocalMute = toggleLocalMute;

    // Load initial queue UI
    updateQueueUI();

    // BG Audio Error Handling
    els.bgAudio.onerror = () => {
        if (state.bgMusicPlaying) {
            setTimeout(() => { els.bgAudio.load(); els.bgAudio.play(); }, 2000);
        }
    };

    // Progress Bar Listeners
    els.audioPlayer.addEventListener('timeupdate', () => {
        if (!isNaN(els.audioPlayer.duration)) {
            const percent = (els.audioPlayer.currentTime / els.audioPlayer.duration) * 100;
            els.progressBar.style.width = `${percent}%`;
            els.timeDisplay.textContent = `${formatTime(els.audioPlayer.currentTime)} / ${formatTime(els.audioPlayer.duration)}`;
        }
    });

    els.audioPlayer.addEventListener('play', () => {
        els.progressContainer.style.display = 'block';
        updatePlayPauseUI();
    });

    els.audioPlayer.addEventListener('pause', updatePlayPauseUI);

    els.audioPlayer.addEventListener('ended', () => {
        els.progressContainer.style.display = 'none';
        els.progressBar.style.width = '0%';
        els.timeDisplay.textContent = "00:00 / 00:00";
    });

    // Also hide on manual stop/pause if intended (optional, but requested behavior is "khi hô số" - implies while playing)
    // If we pause, we might want to keep it visible? Let's leave it visible on pause.
    // But if we reset or skip?
    els.audioPlayer.addEventListener('emptied', () => {
        els.progressBar.style.width = '0%';
    });
});

// --- Server Sync Handlers ---
function onServerStateUpdate(serverState) {
    // 1. Sync Volume / Settings (if not dragging/editing?)
    //    For simplicity, we always update internal state, but maybe throttle UI updates
    //    Or only update UI if significantly different to avoid fighting the slider
    if (Math.abs(state.bgMaxVolume - serverState.bg_volume) > 0.05) {
        // Update slider if it exists? 
        // We'll trust the Admin is the source of truth mainly, but if another admin changes it...
    }

    // Sync logic for multi-admin is complex. 
    // Let's at least sync the "Called Numbers" and "Status" 

    // Update Called Count/Set
    if (serverState.called_numbers) {
        const serverSet = new Set(serverState.called_numbers.map(c => c.number));
        // Merge? Or replace? 
        // If we just replace, we might lose local state if out of sync?
        // Actually server is truth.
        state.calledSet = serverSet;
        updateCount();
    }

    // If server says "playing" and we are "idle", maybe we should show it?
    // But we avoid auto-playing audio to prevent double-play.

    // 2. Initial Sync Logic (Restore Audio & Queue)
    if (!state.initialSyncDone) {
        state.initialSyncDone = true;
        const activeRemote = (serverState.status === 'playing' && serverState.audio_url);
        const hasQueue = state.callQueue.length > 0;

        if (activeRemote || hasQueue) {
            showResumeOverlay(() => {
                // A. Restore Playback
                if (activeRemote) {
                    console.log("Restoring active playback...");
                    state.currentNumber = serverState.current_number;
                    // Assume normal call
                    state.priorityAudio = { active: true, muteBg: false };

                    els.audioPlayer.src = serverState.audio_url;
                    els.audioPlayer.volume = state.callVolume;
                    els.audioPlayer.playbackRate = state.playbackRate;
                    try {
                        els.audioPlayer.preservesPitch = false;
                        els.audioPlayer.mozPreservesPitch = false;
                    } catch (e) { }

                    if (serverState.started_at) {
                        const elapsed = serverState.server_time - serverState.started_at;
                        if (elapsed > 0) els.audioPlayer.currentTime = elapsed;
                    }

                    els.audioPlayer.onended = () => {
                        if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);
                        state.priorityAudio = { active: false, muteBg: false };
                        window.gameClient.doneCall().catch(() => { });
                        finalizeCall(state.currentNumber);
                    };

                    els.audioPlayer.onerror = () => {
                        console.warn("Restored audio error");
                        state.priorityAudio = { active: false, muteBg: false };
                        if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);
                        finalizeCall(state.currentNumber);
                    };

                    // Handle Pause State on Restore
                    if (serverState.is_paused) {
                        // don't play, just update UI
                        updatePlayPauseUI();
                    } else {
                        els.audioPlayer.play().catch(e => {
                            console.error("Restored play error:", e);
                            finalizeCall(state.currentNumber);
                        });
                    }

                    if (state.bgMusicPlaying) fadeBg(state.duckLevel * state.bgMaxVolume);
                    showStatus(serverState.current_text ? `Đang hô: ${serverState.current_text}` : "Đang phát...");
                    setButtonsBusy(true);
                }
                // B. Resume Queue
                else if (hasQueue) {
                    console.log("Resuming queue...");
                    processQueue();
                }
            });
        }
    } else {
        // 3. Runtime Sync (after initial)
        // Check Pause State
        if (serverState.hasOwnProperty('is_paused')) {
            if (serverState.is_paused && !els.audioPlayer.paused) {
                els.audioPlayer.pause();
            } else if (!serverState.is_paused && els.audioPlayer.paused && els.audioPlayer.currentSrc) {
                // Only resume if we have a source and it's not ended
                if (!els.audioPlayer.ended) {
                    els.audioPlayer.play().catch(e => console.error("Resume error:", e));
                }
            }
        }
    }

    // 4. Background Music Sync
    if (serverState.bg_music && serverState.bg_started_at && !state.priorityAudio.active && !els.bgAudio.paused) {
        const duration = els.bgAudio.duration;
        if (duration > 0) {
            let elapsed = serverState.server_time - serverState.bg_started_at;
            elapsed = elapsed % duration;
            if (elapsed < 0) elapsed += duration;

            const current = els.bgAudio.currentTime;
            let diff = Math.abs(current - elapsed);
            if (diff > duration / 2) diff = duration - diff;

            // Sync if diff > 2.0s
            if (diff > 2.0) {
                els.bgAudio.currentTime = elapsed;
            }
        }
    }
}

function showResumeOverlay(onResume) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; display:flex; justify-content:center; align-items:center; flex-direction:column; color:#fff;';

    const msg = document.createElement('h2');
    msg.textContent = "Nhấn để tiếp tục";
    msg.style.marginBottom = "20px";

    const btn = document.createElement('button');
    btn.textContent = "▶ TIP TỤC";
    btn.style.cssText = 'padding:15px 30px; font-size:18px; border:none; background:#4caf50; color:white; border-radius:50px; cursor:pointer;';

    btn.onclick = () => {
        // Unlock Audio Contexts just in case
        AudioUtils.unlock(els.bgAudio);
        AudioUtils.unlock(els.audioPlayer);

        div.remove();
        onResume();
    };

    div.appendChild(msg);
    div.appendChild(btn);
    document.body.appendChild(div);
}

// --- Audio / Volume Logic ---
function toggleVolPanel() {
    els.volumePanel.classList.toggle('show');
    document.getElementById('volToggle').classList.toggle('active');
}

function syncVolume() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
        window.gameClient.setVolume({
            bg_volume: state.bgMaxVolume,
            call_volume: state.callVolume,
            duck_level: state.duckLevel,
            playback_rate: state.playbackRate
        });
    }, 300);
}

function setBgVolume(val) {
    state.bgMaxVolume = val / 100;
    els.bgVolLabel.textContent = val + '%';
    if (state.bgMusicPlaying && els.audioPlayer.paused) {
        els.bgAudio.volume = state.bgMaxVolume;
    }
    syncVolume();
}

function setCallVolume(val) {
    state.callVolume = val / 100;
    els.callVolLabel.textContent = val + '%';
    els.audioPlayer.volume = state.callVolume;
    syncVolume();
}

function setPlaybackRate(val) {
    state.playbackRate = parseFloat(val);
    els.audioPlayer.playbackRate = state.playbackRate;
    els.bgAudio.playbackRate = state.playbackRate;

    // Fix pitch
    if (els.bgAudio.preservesPitch !== undefined) {
        els.bgAudio.preservesPitch = false;
        els.bgAudio.mozPreservesPitch = false;
        els.audioPlayer.preservesPitch = false;
    }

    syncVolume();
}

function toggleBgMusic() {
    if (!state.bgMusicPlaying) {
        // Enable
        els.bgAudio.volume = 0;
        els.bgAudio.play().then(() => {
            state.bgMusicPlaying = true;
            els.bgMusicBtn.textContent = "🔇 Tắt Nhạc Nền";
            window.gameClient.setBgMusic(true);

            // Determine target volume based on priority state
            let targetVol = state.bgMaxVolume;
            if (state.priorityAudio.active) {
                targetVol = state.priorityAudio.muteBg ? 0 : (state.duckLevel * state.bgMaxVolume);
            }

            AudioUtils.smoothFade(els.bgAudio, targetVol, 1000);
        });
    } else {
        // Disable
        state.bgMusicPlaying = false;
        els.bgMusicBtn.textContent = "🎵 Bật Nhạc Nền";
        AudioUtils.smoothFade(els.bgAudio, 0, 800, () => els.bgAudio.pause());
        window.gameClient.setBgMusic(false);
    }
}

function toggleLocalMute() {
    state.localMute = !state.localMute;

    // Apply Mute
    els.audioPlayer.muted = state.localMute;
    els.bgAudio.muted = state.localMute;

    // Update Icons and Style
    const btn = document.getElementById('btnLocalMute');
    if (btn) {
        const iconUnmuted = btn.querySelector('#iconUnmuted');
        const iconMuted = btn.querySelector('#iconMuted');

        if (state.localMute) {
            iconUnmuted.style.display = 'none';
            iconMuted.style.display = 'block';
            btn.title = "Bật tiếng (Admin)";
            btn.classList.add('muted');
        } else {
            iconUnmuted.style.display = 'block';
            iconMuted.style.display = 'none';
            btn.title = "Tắt tiếng (Chỉ Admin)";
            btn.classList.remove('muted');
        }
    }
}

function fadeBg(target) {
    AudioUtils.smoothFade(els.bgAudio, target, 500);
}

function togglePlayPause() {
    const player = els.audioPlayer;
    // We want to toggle the state.
    // If currently playing (not paused), we want to PAUSE (paused=true).
    // If currently paused, we want to RESUME (paused=false).

    // However, we rely on Server State mostly. 
    // But for UI responsiveness we can check local state or just send the inverse of current known server state?
    // Let's use local player state as proxy for now, but ideally we should track 'isPaused' in state object.

    const willPause = !player.paused;

    fetch('/api/game/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: willPause })
    }).catch(e => console.error("Pause API error:", e));

    // Note: We do NOT pause locally here immediately. We wait for SSE to confirm.
    // Or we could optimistic update? 
    // Let's wait for SSE to ensure sync. The lag should be minimal on local network.
}

function updatePlayPauseUI() {
    if (els.audioPlayer.paused) {
        els.iconPlay.style.display = 'block';
        els.iconPause.style.display = 'none';
        if (els.bgMusicBtn) els.bgMusicBtn.style.color = ''; // Reset if needed, or just remove this logic
    } else {
        els.iconPlay.style.display = 'none';
        els.iconPause.style.display = 'block';
    }
}

// --- Game Logic ---
function setButtonsBusy(busy) {
    state.isBusy = busy;
    els.btnRandom.disabled = busy;

    if (busy) {
        els.btnCall.textContent = "Thêm vào hàng đợi";
        els.btnCall.classList.add('queue-mode');
        els.btnSkip.classList.add('active');
        els.btnSkip.disabled = false;
    } else {
        els.btnCall.textContent = "HÔ SỐ";
        els.btnCall.classList.remove('queue-mode');
        els.btnSkip.classList.remove('active');
        els.btnSkip.disabled = true;
    }
}

function showStatus(msg) { els.status.textContent = msg; }

function updateCount() {
    const count = state.calledSet.size;
    els.calledCount.textContent = count > 0 ? `Đã gọi: ${count} số` : '';
}

function showError(msg) {
    // Simple alert or toast
    let toast = document.getElementById('errorToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'errorToast';
        toast.style.cssText = 'position:fixed;top:20px;right:20px;background:rgba(220,50,50,0.9);color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity 0.5s;pointer-events:none;opacity:0;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// --- Queue Logic ---
function addToQueue() {
    const input = els.numberInput;
    const number = parseInt(input.value);

    if (isNaN(number) || number < 0 || number > 99) {
        alert("Vui lòng nhập số từ 0 đến 99");
        return;
    }
    if (state.calledSet.has(number)) {
        showStatus(`⚠️ Số ${number} đã gọi rồi!`);
        return;
    }
    if (state.callQueue.includes(number)) return;

    state.callQueue.push(number);
    localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
    updateQueueUI();
    input.value = '';
    input.focus();
    processQueue();
}

function updateQueueUI() {
    els.queueList.innerHTML = '';
    if (state.callQueue.length === 0) {
        els.queueContainer.style.display = 'none';
        return;
    }
    els.queueContainer.style.display = 'flex';

    // Header with Clear Button
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:5px;';

    // Use queue-label class for text but modify style slightly
    const label = document.createElement('span');
    label.className = 'queue-label';
    label.style.marginBottom = '0';
    label.textContent = `Hàng đợi (${state.callQueue.length})`;

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑️ Xóa hết';
    clearBtn.className = 'btn-text-danger'; // We might need to add this class or style inline
    clearBtn.style.cssText = 'background:none; border:none; color:#e53935; cursor:pointer; font-size:12px; font-weight:bold;';
    clearBtn.onclick = clearQueue;

    header.appendChild(label);
    header.appendChild(clearBtn);
    els.queueList.appendChild(header);

    // List Items
    state.callQueue.forEach((n, index) => {
        const div = document.createElement('div');
        div.className = 'queue-item';
        // Make queue item flex to hold number and close button
        div.style.cssText = 'display:inline-flex; align-items:center; gap:5px; padding-right:5px; position:relative;';

        const numSpan = document.createElement('span');
        numSpan.textContent = n;

        const removeBtn = document.createElement('span');
        removeBtn.innerHTML = '&times;'; // Multiplication sign x
        removeBtn.style.cssText = 'cursor:pointer; color:#999; font-weight:bold; font-size:16px; margin-left:4px; line-height:1; display:flex; align-items:center;';
        removeBtn.title = "Xóa số này";
        removeBtn.onmouseover = () => removeBtn.style.color = 'red';
        removeBtn.onmouseout = () => removeBtn.style.color = '#999';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromQueue(index);
        };

        div.appendChild(numSpan);
        div.appendChild(removeBtn);
        els.queueList.appendChild(div);
    });
}

function removeFromQueue(index) {
    if (index >= 0 && index < state.callQueue.length) {
        state.callQueue.splice(index, 1);
        localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
        updateQueueUI();
    }
}

function clearQueue() {
    if (confirm("Xóa toàn bộ hàng đợi?")) {
        state.callQueue = [];
        localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
        updateQueueUI();
    }
}

function processQueue() {
    if (state.isProcessingQueue || state.isBusy || state.callQueue.length === 0) return;
    state.isProcessingQueue = true;
    const number = state.callQueue.shift();
    localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
    updateQueueUI();

    doCallNumber(number).catch(e => console.error(e));
}

// --- Call Logic ---
async function doCallNumber(number) {
    state.currentNumber = number;
    setButtonsBusy(true);
    showStatus(`Đang xử lý số ${number}...`);

    // Set Priority State
    state.priorityAudio = { active: true, muteBg: false };

    try {
        // 1. Get URL from Server
        const res = await fetch(`/api/call_number?number=${number}`);
        const data = await res.json();

        if (!data.found || !data.audio_url) {
            const msg = `Số ${number}: Không có nhạc.`;
            showStatus(msg);
            showError(msg);
            setButtonsBusy(false);

            // Reset Priority State
            state.priorityAudio = { active: false, muteBg: false };

            state.isProcessingQueue = false; // Release queue
            if (state.callQueue.length > 0) setTimeout(processQueue, 500);
            return;
        }

        // 2. Notify Server (Update Game State)
        await window.gameClient.callNumber(number, data.audio_url, state.playbackRate);

        // 3. Play Local Preview
        showStatus(`Đang hô số ${number}...`);
        if (state.bgMusicPlaying) fadeBg(state.duckLevel * state.bgMaxVolume);

        const player = els.audioPlayer;
        player.src = data.audio_url;
        player.volume = state.callVolume;
        player.playbackRate = state.playbackRate;
        try {
            player.preservesPitch = false;
            player.mozPreservesPitch = false;
        } catch (e) { }

        // Handle Playback
        return new Promise((resolve) => {
            // Safety Cleanup
            const cleanup = () => {
                clearTimeout(state.safetyTimer);
            };

            player.onended = () => {
                cleanup();
                finalizeCall(number);
                resolve();
            };

            player.onerror = () => {
                cleanup();
                console.warn("Local audio error");
                finalizeCall(number);
                resolve();
            };

            // Loading Metadata for Dynamic Timeout
            player.onloadedmetadata = () => {
                const durationMs = (player.duration * 1000) / state.playbackRate;
                clearTimeout(state.safetyTimer);
                state.safetyTimer = setTimeout(() => {
                    cleanup();
                    // Force stop if stuck
                    try { player.pause(); } catch (e) { }
                    finalizeCall(number);
                    resolve();
                }, durationMs + 10000); // 10s buffer
            };

            // Fallback Timeout
            clearTimeout(state.safetyTimer);
            state.safetyTimer = setTimeout(() => {
                cleanup();
                finalizeCall(number);
                resolve();
            }, 60000);

            player.play().catch(e => {
                console.error("Local play error:", e);

                if (e.name === 'NotAllowedError') {
                    showStatus("⚠️ Autoplay bị chặn. Nhấn Resume.");
                    showResumeOverlay(() => {
                        player.play().catch(err => {
                            console.error("Retry failed", err);
                            cleanup();
                            finalizeCall(number); // Skip if retry fails
                            resolve();
                        });
                    });
                    return; // Don't finalize yet
                }

                cleanup();
                finalizeCall(number);
                resolve();
            });
        });

    } catch (e) {
        console.error("Call error:", e);
        showStatus("Lỗi kết nối.");

        // Reset Priority State
        state.priorityAudio = { active: false, muteBg: false };

        // Check for Autoplay Block
        if (e.name === 'NotAllowedError') {
            showStatus("⚠️ Autoplay bị chặn.");
            showResumeOverlay(() => {
                doCallNumber(number);
            });
            return;
        }

        setButtonsBusy(false);
        state.isProcessingQueue = false;
    }
}

async function finalizeCall(number) {
    if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);

    // Reset Priority State
    state.priorityAudio = { active: false, muteBg: false };

    // Notify Done
    try { await window.gameClient.doneCall(); } catch (e) { }

    // Check for null explicitly because null >= 0 is true in JS
    if (number !== null && number >= 0 && !state.calledSet.has(number)) {
        state.calledSet.add(number);
        updateCount();
    }
    showStatus(`Đã gọi số ${number}`);
    setButtonsBusy(false);
    state.isProcessingQueue = false;

    // Continue Queue
    if (state.callQueue.length > 0) {
        setTimeout(processQueue, 500);
    }

    // Ensure progress is hidden
    els.progressContainer.style.display = 'none';
}

function skipCurrent() {
    if (!state.isBusy) return;
    const player = els.audioPlayer;
    player.pause();
    // Move to end to trigger onended
    // Or just manually call finalize?
    // Manually calling finalize is safer to ensure next item triggers.
    // Assuming doCallNumber logic handles 'pause' causing 'onended' or we just force it.
    // Force finalize:
    player.onended = null; // Prevent double trigger
    player.onerror = null;

    // Need to know WHO we were calling? 
    // We don't store "currentNumber" clearly in state, but UI has it. 
    // Actually `doCallNumber` closure has it. 
    // But we are outside closure.
    // Solution: Just finalize with state.currentNumber
    // But we want to add to "calledSet" if it was valid?
    // Let's assume queue mode handles skipping = finished.
    finalizeCall(state.currentNumber);
}

function randomCall() {
    if (state.calledSet.size >= 100) { alert("Đã gọi hết số!"); return; }
    let r;
    do { r = Math.floor(Math.random() * 100); } while (state.calledSet.has(r) || state.callQueue.includes(r));

    els.numberInput.value = r;
    addToQueue();
}

async function resetGame() {
    if (!confirm("Reset game?")) return;
    els.audioPlayer.pause();
    state.callQueue = [];
    localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
    state.isProcessingQueue = false;
    updateQueueUI();
    state.calledSet.clear();
    updateCount();
    setButtonsBusy(false);

    await window.gameClient.resetGame();
    showStatus("Đã reset.");
    els.progressContainer.style.display = 'none';
}

// --- Special Sounds ---
async function loadSounds(type) {
    try {
        const res = await fetch(`/api/sounds/${type}`);
        const files = await res.json();
        const select = document.getElementById(type === 'start' ? 'startSoundSelect' : 'kinhSoundSelect');
        if (!select) return;

        files.forEach(f => {
            const opt = document.createElement('option');
            opt.value = `/data/songs/${type}/${f}`;
            opt.textContent = f;
            select.appendChild(opt);
        });
    } catch (e) { console.error("Error loading sounds", e); }
}

async function startGame() {
    playSpecial('startSoundSelect', "ĐANG BẮT ĐẦU...", true);
}

async function kinhGame() {
    playSpecial('kinhSoundSelect', "KINH RỒI !!!");
}

async function playSpecial(selectId, statusMsg, muteBg = false) {
    // Clear queue
    state.callQueue = [];
    localStorage.setItem('loto_queue', JSON.stringify(state.callQueue));
    state.isProcessingQueue = false;
    updateQueueUI();

    const select = document.getElementById(selectId);
    let url = select.value;
    if (url === 'random') {
        const opts = Array.from(select.options).filter(o => o.value !== 'random');
        if (opts.length > 0) {
            url = opts[Math.floor(Math.random() * opts.length)].value;
        } else {
            showStatus("Chưa có nhạc!");
            return;
        }
    }

    // Set Priority State
    state.priorityAudio = { active: true, muteBg: muteBg };

    if (state.bgMusicPlaying) {
        const target = muteBg ? 0 : (state.duckLevel * state.bgMaxVolume);
        fadeBg(target);
    }
    showStatus(statusMsg);

    // Notify Server
    try {
        await window.gameClient.playSpecial(url, 1.0);
    } catch (e) {
        console.error("Special audio sync error:", e);
    }

    const player = els.audioPlayer;
    player.src = url;
    player.volume = state.callVolume;
    player.playbackRate = 1.0;

    // Fix pitch
    try {
        player.preservesPitch = false;
        player.mozPreservesPitch = false;
    } catch (e) { }

    player.onended = () => {
        if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);

        // Reset Priority State
        state.priorityAudio = { active: false, muteBg: false };

        // Also notify done so display restores BG? 
        // Or just let display handle its own timing?
        // Display handles it via audio end or state change. 
        // We might want to send "done" to restore state to idle/showing?
        // Let's send "done" to be safe and clean up state.
        window.gameClient.doneCall().catch(() => { });
    };

    player.onerror = () => {
        console.error("Special audio playback error");
        if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);
        state.priorityAudio = { active: false, muteBg: false };
        showStatus("Lỗi phát audio!");
    };

    player.play().catch(e => {
        console.error("Play error:", e);
        if (state.bgMusicPlaying) fadeBg(state.bgMaxVolume);
        state.priorityAudio = { active: false, muteBg: false };
    });
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

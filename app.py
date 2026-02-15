from fastapi import FastAPI, Query, HTTPException, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
import os
import asyncio
from core.converter import number_to_vietnamese
from core.audio import cut_audio
import uuid
import json
from typing import List, Optional
from pydantic import BaseModel
import subprocess
import glob
import re
import time

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/data/songs", StaticFiles(directory="data/songs"), name="songs")
app.mount("/data/songs/full", StaticFiles(directory="data/songs/full"), name="full_songs")
app.mount("/data/songs/number", StaticFiles(directory="data/songs/number"), name="number_songs")
app.mount("/data/songs/start", StaticFiles(directory="data/songs/start"), name="start_songs")
app.mount("/data/songs/end", StaticFiles(directory="data/songs/end"), name="end_songs")

DATA_PATH = "data/lyrics/data.json"

TEMP_DIR = "static/temp"
os.makedirs(TEMP_DIR, exist_ok=True)

import random
import logging

logger = logging.getLogger(__name__)

# ====== SSE Client Registry ======
sse_clients: list[asyncio.Queue] = []

# ====== Game State ======
game_state = {
    "called_numbers": [],    # list of {number, text}
    "current_number": None,
    "current_text": "",
    "status": "idle",        # idle | playing | showing
    "bg_music": False,       # background music on/off
    "audio_url": None,       # current number audio URL
    "play_id": 0,            # incremented each call, so display can detect new audio
    "bg_volume": 0.8,
    "call_volume": 1.0,
    "duck_level": 0.15,
    "is_paused": False,      # server-side pause state
    "bg_started_at": 0,      # timestamp when bg music started
}

def notify_clients():
    """Push current game state to all SSE clients"""
    # Inject server time for sync
    current_state = game_state.copy()
    current_state["server_time"] = time.time()
    
    data = json.dumps(current_state, ensure_ascii=False)
    dead = []
    for q in sse_clients:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try: sse_clients.remove(q)
        except ValueError: pass

@app.get("/api/game/stream")
async def game_stream(request: Request):
    """SSE endpoint — real-time state sync for display pages"""
    queue: asyncio.Queue = asyncio.Queue(maxsize=20)
    sse_clients.append(queue)

    async def event_generator():
        try:
            # Send initial state immediately
            # Inject server time
            initial_state = game_state.copy()
            initial_state["server_time"] = time.time()
            data = json.dumps(initial_state, ensure_ascii=False)
            yield f"data: {data}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield ": keepalive\n\n"
        finally:
            try: sse_clients.remove(queue)
            except ValueError: pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@app.get("/")
async def read_root():
    return FileResponse('static/index.html')

@app.get("/admin")
async def admin_page():
    return FileResponse('static/admin.html')

# --- Game API ---

@app.get("/api/call_number")
async def call_number(number: int = Query(..., ge=0, le=99)):
    """Called by admin to get audio URL for a number"""
    text = number_to_vietnamese(number)
    
    # Check for pre-cut audio segments
    try:
        number_dir = os.path.join(NUMBER_SONGS_DIR, str(number))
        if os.path.exists(number_dir):
            clips = [f for f in os.listdir(number_dir) if f.endswith('.mp3')]
            if clips:
                chosen = random.choice(clips)
                return {
                    "number": number,
                    "text": text,
                    "found": True,
                    "lyric": "",
                    "song_name": "",
                    "audio_url": f"/data/songs/number/{number}/{chosen}",
                }
    except Exception as e:
        logger.warning(f"Error reading pre-cut segments for {number}: {e}")
    
    # Fallback: TTS voice — "Mỏi miệng quá. Số X"
    try:
        from gtts import gTTS
        tts_text = f"Mỏi miệng quá. Số {text}"
        filename = f"tts_{number}.mp3"
        output_path = os.path.join(TEMP_DIR, filename)
        # Reuse cached TTS file if it already exists
        if not os.path.exists(output_path):
            tts = gTTS(text=tts_text, lang='vi')
            tts.save(output_path)
        return {
            "number": number,
            "text": text,
            "found": True,
            "lyric": "Mỏi miệng quá!",
            "song_name": "",
            "audio_url": f"/static/temp/{filename}",
            "no_duck": True,  # Don't duck bg music for short TTS
        }
    except Exception as e:
        print(f"TTS fallback error: {e}")
        return {
            "number": number,
            "text": text,
            "found": False,
            "message": "Không tạo được âm thanh."
        }

class GameCallRequest(BaseModel):
    number: int
    audio_url: str = ""
    playback_rate: float = 1.0

@app.post("/api/game/call")
async def game_call(req: GameCallRequest):
    """Admin calls a number — update game state to playing"""
    text = number_to_vietnamese(req.number)
    game_state["current_number"] = req.number
    game_state["current_text"] = text
    game_state["status"] = "playing"
    game_state["audio_url"] = req.audio_url
    game_state["playback_rate"] = req.playback_rate
    game_state["started_at"] = time.time() # Capture start time
    game_state["started_at"] = time.time() # Capture start time
    game_state["play_id"] += 1  # Increment so display page detects new audio
    game_state["is_paused"] = False # Auto-resume on new call
    notify_clients()
    return {"status": "ok"}

@app.post("/api/game/done")
async def game_done():
    """Admin signals song ended — show number to display"""
    if game_state["current_number"] is not None:
        game_state["called_numbers"].append({
            "number": game_state["current_number"],
            "text": game_state["current_text"]
        })
        game_state["status"] = "showing"
    else:
        # Special sound ended (Start/Kinh)
        game_state["status"] = "idle"
        
    notify_clients()
    return {"status": "ok"}

@app.get("/api/game/state")
async def game_get_state():
    """Display page polls this"""
    state = game_state.copy()
    state["server_time"] = time.time()
    return state

@app.post("/api/game/reset")
async def game_reset():
    """Admin resets the game"""
    game_state["called_numbers"] = []
    game_state["current_number"] = None
    game_state["current_text"] = ""
    game_state["status"] = "idle"
    game_state["audio_url"] = None
    game_state["audio_url"] = None
    game_state["play_id"] = 0
    game_state["is_paused"] = False
    notify_clients()
    return {"status": "ok"}

class SpecialSoundRequest(BaseModel):
    audio_url: str
    playback_rate: float = 1.0

@app.post("/api/game/special")
async def game_special(req: SpecialSoundRequest):
    """Admin triggers a special sound (Start / Kinh)"""
    game_state["status"] = "playing"
    game_state["current_number"] = None 
    game_state["current_text"] = ""
    game_state["audio_url"] = req.audio_url
    game_state["playback_rate"] = req.playback_rate
    game_state["started_at"] = time.time()
    game_state["started_at"] = time.time()
    game_state["play_id"] += 1
    game_state["is_paused"] = False
    notify_clients()
    return {"status": "ok"}

class BgMusicRequest(BaseModel):
    enabled: bool

@app.post("/api/game/bg_music")
async def game_bg_music(req: BgMusicRequest):
    """Enable/Disable background music"""
    if req.enabled and not game_state["bg_music"]:
        game_state["bg_started_at"] = time.time()
    
    game_state["bg_music"] = req.enabled
    notify_clients()
    return {"status": "ok"}

class VolumeRequest(BaseModel):
    bg_volume: float = 0.8
    call_volume: float = 1.0
    duck_level: float = 0.15
    playback_rate: float = 1.0

@app.post("/api/game/volume")
async def game_volume(req: VolumeRequest):
    """Admin syncs volume settings"""
    game_state["bg_volume"] = req.bg_volume
    game_state["call_volume"] = req.call_volume
    game_state["duck_level"] = req.duck_level
    game_state["playback_rate"] = req.playback_rate
    notify_clients()
    notify_clients()
    return {"status": "ok"}

class PauseRequest(BaseModel):
    paused: bool

@app.post("/api/game/pause")
async def game_pause(req: PauseRequest):
    """Admin toggles pause state"""
    game_state["is_paused"] = req.paused
    notify_clients()
    return {"status": "ok"}

@app.get("/api/sounds/{type}")
async def list_sounds(type: str):
    """List available sound files for 'start' or 'end'"""
    if type not in ['start', 'end']:
        raise HTTPException(status_code=400, detail="Invalid type")
    
    directory = f"data/songs/{type}"
    if not os.path.exists(directory):
        return []
        
    files = [f for f in os.listdir(directory) if f.endswith('.mp3')]
    return files

# --- Cutter Routes ---

@app.get("/cutter")
async def cutter_ui():
    return FileResponse('static/cutter.html')

@app.get("/api/songs")
async def get_songs():
    if not os.path.exists(DATA_PATH):
        return []
    try:
        with open(DATA_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading songs data: {e}")
        raise HTTPException(status_code=500, detail="Lỗi đọc dữ liệu bài hát")


class SegmentRequest(BaseModel):
    song_id: str
    start_time: int
    end_time: int
    number: int
    lyric_text: str

@app.post("/api/segments")
async def save_segment(segment: SegmentRequest):
    if not os.path.exists(DATA_PATH):
        raise HTTPException(status_code=404, detail="Data file not found")
    
    try:
        with open(DATA_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        logger.error(f"Error reading data file: {e}")
        raise HTTPException(status_code=500, detail="Lỗi đọc dữ liệu")
        
    # Find song
    song_found = False
    new_seg = None
    for song in data:
        if song['song_id'] == segment.song_id:
            song_found = True
            new_seg = {
                "start_time": segment.start_time,
                "end_time": segment.end_time,
                "lyric_text": segment.lyric_text,
                "number": segment.number
            }
            song['segments'].append(new_seg)
            break
    
    if not song_found:
        raise HTTPException(status_code=404, detail="Song not found")
    
    try:
        with open(DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        logger.error(f"Error writing data file: {e}")
        raise HTTPException(status_code=500, detail="Lỗi ghi dữ liệu")
        
    return {"status": "success", "segment": new_seg}

# --- Refined Song Cutter Workflow Endpoints ---

NUMBER_JSON_PATH = "data/cutter/number.json"
FULL_SONGS_DIR = "data/songs/full"
NUMBER_SONGS_DIR = "data/songs/number"

NORMALIZED_MARKER_DIR = "data/cutter/.normalized"

def _ensure_normalized(filename: str):
    """Normalize a file to CBR if not already done"""
    os.makedirs(NORMALIZED_MARKER_DIR, exist_ok=True)
    marker_path = os.path.join(NORMALIZED_MARKER_DIR, filename + ".ok")
    
    if os.path.exists(marker_path):
        return
    
    target_path = os.path.join(FULL_SONGS_DIR, filename)
    tmp_path = target_path + ".tmp.mp3"
    
    # Convert to 192k CBR
    cmd = [
        "ffmpeg", "-y",
        "-i", target_path,
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        tmp_path
    ]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode == 0:
        os.replace(tmp_path, target_path)
        with open(marker_path, 'w') as f: f.write('ok')
        print(f"Auto-normalized {filename}")
    else:
        if os.path.exists(tmp_path): os.remove(tmp_path)

@app.get("/api/full_songs")
async def list_full_songs(background_tasks: BackgroundTasks):
    """List mp3 files and auto-normalize in background"""
    if not os.path.exists(FULL_SONGS_DIR):
        return []
    
    files = [f for f in os.listdir(FULL_SONGS_DIR) if f.endswith('.mp3') and not f.endswith('.tmp.mp3')]
    
    # Trigger auto-norm for all files
    for f in files:
        background_tasks.add_task(_ensure_normalized, f)
        
    files.sort()
    return files

@app.delete("/api/cutter/all")
async def delete_all_segments():
    """Clear all segments from number.json"""
    try:
        with open(NUMBER_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump({}, f)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class NormalizeRequest(BaseModel):
    filename: str

@app.post("/api/cutter/normalize")
async def normalize_to_cbr(req: NormalizeRequest):
    """Manually convert a file to CBR to fix timing issues"""
    target_path = os.path.join(FULL_SONGS_DIR, req.filename)
    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    tmp_path = target_path + ".tmp.mp3"
    cmd = [
        "ffmpeg", "-y",
        "-i", target_path,
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        tmp_path
    ]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode == 0:
        os.replace(tmp_path, target_path)
        return {"status": "success"}
    else:
        if os.path.exists(tmp_path): os.remove(tmp_path)
        raise HTTPException(status_code=500, detail=f"Normalization failed: {res.stderr.decode()}")

# --- Download tracking ---
download_status = {}  # {task_id: {status, progress, filename, error}}

class DownloadRequest(BaseModel):
    url: str

def _get_next_full_index():
    """Find next available full{N}.mp3 index"""
    os.makedirs(FULL_SONGS_DIR, exist_ok=True)
    existing = glob.glob(os.path.join(FULL_SONGS_DIR, "full*.mp3"))
    indices = []
    for f in existing:
        match = re.search(r'full(\d+)\.mp3$', os.path.basename(f))
        if match:
            indices.append(int(match.group(1)))
    return max(indices, default=0) + 1

import math
import concurrent.futures

def _do_download(task_id: str, url: str):
    """Background download task using yt-dlp with parallel chunking"""
    try:
        download_status[task_id] = {"status": "downloading", "progress": "Checking duration...", "filename": "", "error": None}
        
        # 1. Get Duration
        dur_cmd = ["yt-dlp", "--print", "duration", url]
        print(f"Checking duration: {dur_cmd}")
        dur_proc = subprocess.run(dur_cmd, capture_output=True, text=True)
        
        duration = 0
        if dur_proc.returncode == 0:
            try:
                duration = float(dur_proc.stdout.strip())
            except ValueError:
                pass
        
        print(f"Duration: {duration}s")
        
        # 2. Calculate Ranges
        # If > 45 mins (2700s), split into ~45 min chunks
        # Actually 45 mins is good safety margin against timeouts
        CHUNK_SIZE = 2700 
        ranges = [] 
        
        if duration > CHUNK_SIZE:
            num_chunks = math.ceil(duration / CHUNK_SIZE)
            for i in range(num_chunks):
                start = i * CHUNK_SIZE
                end = min((i + 1) * CHUNK_SIZE, duration)
                ranges.append((start, end))
        else:
            ranges.append(None) # Full download
            
        base_idx = _get_next_full_index()
        results = [None] * len(ranges)
        completed_count = 0
        total_parts = len(ranges)
        
        def download_part(index, rng):
            """Helper to download a single part"""
            try:
                part_suffix = f"_p{index+1}" if total_parts > 1 else ""
                
                if rng:
                    s, e = rng
                    def fmt_time(sec):
                        m, s = divmod(sec, 60)
                        h, m = divmod(m, 60)
                        return f"{int(h):02d}-{int(m):02d}-{int(s):02d}"
                    
                    filename = f"full{base_idx}_{fmt_time(s)}_{fmt_time(e)}.mp3"
                    dl_args = ["--download-sections", f"*{s}-{e}"]
                else:
                    filename = f"full{base_idx}.mp3"
                    dl_args = []
                    
                output_path = os.path.join(FULL_SONGS_DIR, filename)
                
                # Command construction
                cmd = [
                    "yt-dlp",
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", "0",
                    "-o", output_path.replace(".mp3", ".%(ext)s"),
                    "--no-playlist",
                    "--newline",
                ]
                cmd.extend(dl_args)
                cmd.append(url)
                
                # Run download
                # We don't stream output for parallel tasks to avoid mixed logs
                # checking log via process completion
                proc = subprocess.run(cmd, capture_output=True, text=True)
                
                if proc.returncode != 0:
                    raise Exception(f"yt-dlp failed: {proc.stderr}")
                    
                # Find valid file
                actual_file = None
                if os.path.exists(output_path):
                    actual_file = output_path
                else:
                    possible_exts = [".webm", ".m4a", ".flac", ".opus"]
                    for ext in possible_exts:
                        p = output_path.replace(".mp3", ext)
                        if os.path.exists(p):
                            actual_file = p
                            break
                            
                if not actual_file:
                    fallback_glob = glob.glob(os.path.join(FULL_SONGS_DIR, f"full{base_idx}*"))
                    if fallback_glob and len(ranges) == 1: # Only safe if single part
                         actual_file = fallback_glob[0]

                if not actual_file:
                     raise Exception(f"Output file not found for {filename}")

                # Normalize to CBR
                cbr_path = output_path.replace(".mp3", "_cbr.mp3")
                if cbr_path == output_path: cbr_path = output_path.replace(".mp3", "_temp_cbr.mp3")
                
                norm_cmd = [
                    "ffmpeg", "-y",
                    "-i", actual_file,
                    "-codec:a", "libmp3lame",
                    "-b:a", "192k",
                    cbr_path
                ]
                subprocess.run(norm_cmd, check=True, capture_output=True)
                
                # Cleanup
                if os.path.exists(actual_file) and actual_file != cbr_path:
                    os.remove(actual_file)
                
                # Final overwrite
                os.rename(cbr_path, output_path)
                
                return filename
            except Exception as e:
                print(f"Error downloading part {index+1}: {e}")
                return None

        # 3. Parallel Execution
        # Use 3 workers to respect bandwidth/CPU
        MAX_WORKERS = 3
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_idx = {executor.submit(download_part, i, rng): i for i, rng in enumerate(ranges)}
            
            for future in concurrent.futures.as_completed(future_to_idx):
                idx_done = future_to_idx[future]
                try:
                    fname = future.result()
                    if fname:
                        results[idx_done] = fname
                        completed_count += 1
                        
                        # Update status
                        pct = int((completed_count / total_parts) * 100)
                        status_msg = f"Downloading parts: {completed_count}/{total_parts} completed ({pct}%)"
                        if total_parts == 1: status_msg = "Finalizing..."
                        
                        download_status[task_id]["progress"] = status_msg
                        
                    else:
                         download_status[task_id]["error"] = f"Part {idx_done+1} failed"
                except Exception as exc:
                    print(f"Part {idx_done+1} generated an exception: {exc}")
                    download_status[task_id]["error"] = f"Part {idx_done+1} error"

        # 4. Final Verification
        successful_files = [f for f in results if f]
        
        if len(successful_files) == total_parts:
            download_status[task_id]["status"] = "done"
            # Return first filename, or maybe all? Frontend expects "filename" string.
            # If multiple, maybe return the base name or list?
            # Existing frontend logic expects one file to select.
            # We can return the first one, user can see others in list.
            download_status[task_id]["filename"] = successful_files[0]
            download_status[task_id]["progress"] = "All parts completed!"
        else:
            download_status[task_id]["status"] = "error"
            if not download_status[task_id]["error"]:
                download_status[task_id]["error"] = "Some parts failed to download"
                
    except Exception as e:
        print(f"Global Download Error: {e}")
        download_status[task_id]["status"] = "error" 
        download_status[task_id]["error"] = str(e)

@app.post("/api/cutter/download")
async def download_video_audio(req: DownloadRequest, background_tasks: BackgroundTasks):
    """Start downloading audio from a video URL"""
    task_id = str(uuid.uuid4())[:8]
    download_status[task_id] = {"status": "queued", "progress": "Queued...", "filename": "", "error": None}
    background_tasks.add_task(_do_download, task_id, req.url)
    return {"task_id": task_id}

@app.get("/api/cutter/download/{task_id}")
async def get_download_status(task_id: str):
    """Check download progress"""
    if task_id not in download_status:
        raise HTTPException(status_code=404, detail="Task not found")
    return download_status[task_id]

@app.get("/api/cutter/all")
async def get_all_segments():
    """Get all numbers and their segments from number.json"""
    if not os.path.exists(NUMBER_JSON_PATH):
        return {}
    try:
        with open(NUMBER_JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        # Lazy Migration Check
        dirty = False
        for num, segs in data.items():
            migrated_segs, updated = _migrate_legacy_audio(num, segs)
            if updated:
                data[num] = migrated_segs
                dirty = True
        
        if dirty:
            try:
                with open(NUMBER_JSON_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=4)
                logger.info("Auto-migrated index-based segments to UUIDs on read.")
            except Exception as e:
                logger.error(f"Failed to save migrated data: {e}")

        return data
    except Exception as e:
        print(f"Error reading number.json: {e}")
        return {}

@app.get("/api/cutter/number/{number}")
async def get_number_segments(number: str):
    """Get segments for a specific number from number.json"""
    if not os.path.exists(NUMBER_JSON_PATH):
        return []
    
    try:
        with open(NUMBER_JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        segs = data.get(str(number), [])
        
        # Lazy Migration
        migrated_segs, updated = _migrate_legacy_audio(str(number), segs)
        if updated:
            data[str(number)] = migrated_segs
            try:
                with open(NUMBER_JSON_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=4)
            except Exception as e:
                logger.error(f"Failed to save migrated data for {number}: {e}")
                
        return migrated_segs
    except Exception as e:
        print(f"Error reading number.json: {e}")
        return []

class CutterSegment(BaseModel):
    id: Optional[str] = None
    start: int
    end: int
    file: str
    cut: int = 0
    lyric: Optional[str] = ""

def _get_output_dir(number: str):
    if number == 'start':
        return "data/songs/start"
    elif number == 'end':
        return "data/songs/end"
    else:
        return os.path.join(NUMBER_SONGS_DIR, str(number))

def _migrate_legacy_audio(number: str, segments: List[dict]):
    """
    Migrate existing audio files from {index}.mp3 to {id}.mp3
    And generate IDs for segments if missing.
    Returns: Updated segments list with IDs
    """
    out_dir = _get_output_dir(number)
    os.makedirs(out_dir, exist_ok=True)
    
    updated = False
    
    # 1. Ensure all segments have IDs
    for seg in segments:
        if not seg.get('id'):
            seg['id'] = str(uuid.uuid4())[:8]
            updated = True
            
    # 2. Check for legacy files and rename if cut=1
    existing_files = os.listdir(out_dir)
    
    for i, seg in enumerate(segments):
        if seg.get('cut') == 1:
            seg_id = seg['id']
            id_filename = f"{seg_id}.mp3"
            index_filename = f"{i}.mp3"
            
            # If ID file exists, all good. 
            if id_filename in existing_files:
                continue
                
            # If ID file missing but Index file exists, RENAME IT
            if index_filename in existing_files:
                src = os.path.join(out_dir, index_filename)
                dst = os.path.join(out_dir, id_filename)
                try:
                    os.rename(src, dst)
                    logger.info(f"Migrated {src} -> {dst}")
                except Exception as e:
                    logger.error(f"Failed to migrate {src}: {e}")
            else:
                # Neither exists? Mark as uncut?
                # Or maybe it was deleted. Let's keep it mark as cut but user will fail to play -> then they recut.
                pass

    return segments, updated

def _cleanup_orphaned_files(number: str, segments: List[dict]):
    """Delete audio files that don't match any current segment ID"""
    out_dir = _get_output_dir(number)
    if not os.path.exists(out_dir): return
    
    valid_filenames = {f"{s['id']}.mp3" for s in segments if s.get('id')}
    
    # Also keep legacy index files temporarily? No, we migrate them.
    # But if migration happens, we should be safe to delete non-matching.
    
    for f in os.listdir(out_dir):
        if f.endswith('.mp3'):
            if f not in valid_filenames:
                try:
                    os.remove(os.path.join(out_dir, f))
                    logger.info(f"Deleted orphan file: {f} in {out_dir}")
                except Exception as e:
                    logger.warning(f"Failed to delete orphan {f}: {e}")

class SaveCutterRequest(BaseModel):
    number: str
    segments: List[CutterSegment]

@app.post("/api/cutter/save")
async def save_cutter_data(payload: SaveCutterRequest):
    """Save segments for a number to number.json"""
    if not os.path.exists(NUMBER_JSON_PATH):
        data = {}
    else:
        try:
            with open(NUMBER_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Corrupted number.json, starting fresh: {e}")
            data = {}
    
    raw_segments = [s.dict() for s in payload.segments]
    
    # Run Migration & Cleanup immediately
    # This ensures consistency whenever we save
    migrated_segments, updated = _migrate_legacy_audio(str(payload.number), raw_segments)
    _cleanup_orphaned_files(str(payload.number), migrated_segments)
    
    data[str(payload.number)] = migrated_segments
    
    try:
        with open(NUMBER_JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
    except Exception as e:
        logger.error(f"Error writing number.json: {e}")
        raise HTTPException(status_code=500, detail="Lỗi ghi dữ liệu")
        
    return {"status": "success"}

class CutRequest(BaseModel):
    number: str
    index: int 
    id: Optional[str] = None

@app.post("/api/cutter/cut")
async def process_cut(req: CutRequest):
    """Process audio cut for a specific segment"""
    if not os.path.exists(NUMBER_JSON_PATH):
        raise HTTPException(status_code=404, detail="Data file not found")
        
    try:
        with open(NUMBER_JSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        logger.error(f"Error reading number.json: {e}")
        raise HTTPException(status_code=500, detail="Lỗi đọc dữ liệu")
        
    segments = data.get(str(req.number))
    if not segments or req.index >= len(segments):
        raise HTTPException(status_code=404, detail="Segment not found")
        
    segment = segments[req.index]
    
    filename = segment['file']
    # If the segment was accidentally saved with a .tmp.mp3 extension (happened in race conditions)
    # clean it up to use the base file
    if filename.endswith('.tmp.mp3'):
        filename = filename.replace('.tmp.mp3', '')
    
    input_path = os.path.join(FULL_SONGS_DIR, filename)
    if not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail=f"Source file {filename} not found")
        
    # Output directory
    out_dir = _get_output_dir(req.number)
    os.makedirs(out_dir, exist_ok=True)
    
    # Output file
    # Use ID if available, else index (and update ID)
    seg_id = req.id
    if not seg_id and segment.get('id'):
        seg_id = segment.get('id')
    
    if not seg_id:
        # Should not happen if migrated, but generate one
        seg_id = str(uuid.uuid4())[:8]
        segment['id'] = seg_id
        
    output_filename = f"{seg_id}.mp3"
    output_path = os.path.join(out_dir, output_filename)
    
    # Perform cut
    # Re-use core.audio.cut_audio
    success = cut_audio(input_path, segment['start'], segment['end'], output_path)
    
    if success:
        # Update status
        segment['cut'] = 1
        segments[req.index] = segment # explicit update just in case
        data[str(req.number)] = segments
        
        try:
            with open(NUMBER_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        except Exception as e:
            logger.error(f"Error writing number.json after cut: {e}")
             
        return {"status": "success", "path": output_path}
    else:
        raise HTTPException(status_code=500, detail="Audio processing failed")

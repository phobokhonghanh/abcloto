from pydub import AudioSegment
import os
import subprocess
from gtts import gTTS

def cut_audio(input_path: str, start_ms: int, end_ms: int, output_path: str, fade_ms: int = 200):
    """
    Cut audio using a single efficient ffmpeg command.
    Assumes the input file is CBR (Constant Bit Rate) for accurate fast-seeking.
    """
    if not os.path.exists(input_path):
        return False
    
    try:
        start_sec = start_ms / 1000.0
        duration_sec = (end_ms - start_ms) / 1000.0
        fade_sec = fade_ms / 1000.0
        
        # Single command:
        # -ss BEFORE -i: Fast and accurate seeking for CBR files
        # -t: Duration
        # -af: Fades
        # -codec:a libmp3lame: Explicit encoder
        # -q:a 2: High quality VBR (for the small segment)
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{start_sec:.3f}",
            "-i", input_path,
            "-t", f"{duration_sec:.3f}",
            "-af", f"afade=t=in:st=0:d={fade_sec},afade=t=out:st={max(0, duration_sec - fade_sec):.3f}:d={fade_sec}",
            "-codec:a", "libmp3lame",
            "-q:a", "2",
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return True
        else:
            print(f"ffmpeg error: {result.stderr[-500:]}")
            return _cut_audio_pydub(input_path, start_ms, end_ms, output_path, fade_ms)
            
    except Exception as e:
        print(f"Error cutting audio: {e}")
        return _cut_audio_pydub(input_path, start_ms, end_ms, output_path, fade_ms)

def _cut_audio_pydub(input_path: str, start_ms: int, end_ms: int, output_path: str, fade_ms: int = 200):
    """Fallback pydub-based cut."""
    try:
        audio = AudioSegment.from_file(input_path)
        segment = audio[start_ms:end_ms]
        if fade_ms > 0:
            segment = segment.fade_in(fade_ms).fade_out(fade_ms)
        segment.export(output_path, format="mp3")
        return True
    except Exception as e:
        print(f"Error cutting with pydub: {e}")
        return False

def impose_rhythm(text: str) -> str:
    """
    Formats text with pauses to create a chanting cadence.
    Loto style: short phrases with dramatic pauses.
    """
    words = text.split()
    if len(words) <= 6:
        return text
    
    # Build phrases of 4-6 words with pauses
    new_words = []
    for i, word in enumerate(words):
        new_words.append(word)
        # Add a dramatic pause (ellipsis) every 4 words
        if (i + 1) % 4 == 0 and i < len(words) - 2:
            new_words.append("...")
    
    return " ".join(new_words)

def apply_singing_effect(input_path: str, output_path: str):
    """
    Uses ffmpeg audio filters to transform flat TTS into a singing/chanting voice:
    - vibrato: pitch wobble (like a singer holding a note)
    - tremolo: volume oscillation (breathing/dynamics)
    - asetrate + atempo: raise pitch slightly (brighter, more musical)
    - chorus: adds depth and richness
    """
    # Build the ffmpeg filter chain
    filters = []
    
    # 1. Raise pitch by ~15% without changing speed
    #    asetrate raises sample rate (pitch up), atempo compensates speed
    filters.append("asetrate=44100*1.15")
    filters.append("atempo=1/1.15")
    filters.append("aresample=44100")
    
    # 2. Vibrato: gentle pitch oscillation (singer's vibrato)
    #    f=5 Hz oscillation, d=0.3 = 30% depth
    filters.append("vibrato=f=5:d=0.3")
    
    # 3. Tremolo: volume oscillation for dynamics
    #    f=3 Hz, d=0.4 = 40% depth
    filters.append("tremolo=f=3:d=0.4")
    
    # 4. Chorus effect: adds richness/fullness
    #    delays | decays | speeds | depths
    filters.append("chorus=0.5:0.9:50|60:0.4|0.32:0.25|0.4:2|2.3")
    
    # 5. Small reverb via aecho for "stage" feel
    filters.append("aecho=0.8:0.7:40:0.3")
    
    # 6. Speed up slightly for energy
    filters.append("atempo=1.15")
    
    filter_str = ",".join(filters)
    
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", filter_str,
        "-q:a", "2",
        output_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"ffmpeg error: {result.stderr[-500:]}")
            return False
        return True
    except Exception as e:
        print(f"ffmpeg exception: {e}")
        return False

def generate_voice(text: str, output_path: str):
    """
    Generates a singing-style vocal for loto calling:
    1. gTTS generates base voice
    2. ffmpeg applies singing effects (vibrato, tremolo, chorus, pitch shift)
    """
    try:
        # 1. Apply rhythm formatting
        rhythmic_text = impose_rhythm(text)
        
        # 2. Generate base TTS
        tts = gTTS(text=rhythmic_text, lang='vi')
        temp_tts = output_path.replace(".mp3", "_tts.mp3")
        tts.save(temp_tts)
        
        # 3. Apply singing effects via ffmpeg
        success = apply_singing_effect(temp_tts, output_path)
        
        # Cleanup
        if os.path.exists(temp_tts):
            os.remove(temp_tts)
        
        if not success:
            # Fallback: just use the raw TTS if effects fail
            tts.save(output_path)
            
        return True
    except Exception as e:
        print(f"Error generating voice: {e}")
        return False

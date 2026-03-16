"""
FFmpeg-based post-production utilities for the multimodal creative pipeline.

Handles video combination with transitions and audio mixing to produce complete
storytelling output. Integrates with GCS via signed URLs so FFmpeg can stream
cloud-stored media without local downloads. Probing and normalization run in
parallel (ThreadPoolExecutor) to keep latency low when processing multi-shot
sequences.
"""

import os
import sys
import logging
import ffmpeg
from typing import List, Dict, Optional, Tuple, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

from ..gcs_utils import sign_url

logger = logging.getLogger(__name__)

# Set FFmpeg path for Windows if using Chocolatey
if sys.platform == "win32":
    choco_ffmpeg = r"C:\ProgramData\chocolatey\bin\ffmpeg.exe"
    if os.path.exists(choco_ffmpeg):
        os.environ['PATH'] = r"C:\ProgramData\chocolatey\bin;" + os.environ.get('PATH', '')


def prepare_media_for_ffmpeg(media_ref: str) -> str:
    """Convert GCS gs:// URLs to signed HTTPS URLs for FFmpeg.
    FFmpeg supports HTTPS URLs directly but not the gs:// protocol.
    Local file paths and existing HTTPS URLs pass through unchanged.
    """
    if media_ref.startswith("gs://"):
        signed = sign_url(media_ref)
        if signed:
            return signed
        raise ValueError(f"Failed to sign URL: {media_ref}")
    return media_ref


def extract_filename_from_url(url: str) -> str:
    """Extract clean filename from URL, stripping path and query parameters."""
    return url.split('/')[-1].split('?')[0]


def get_clip_duration(spec: Dict[str, Any], file_path: str) -> float:
    """Get clip duration accounting for trim specifications.
    Returns trim length if valid trim spec exists, otherwise probes the file.
    """
    trim = spec.get("trim")
    if trim and "start" in trim and "end" in trim:
        duration = trim["end"] - trim["start"]
        if duration > 0:
            return duration

    # No valid trim -- probe for actual duration
    probe = ffmpeg.probe(file_path)
    return float(probe['format']['duration'])


def _probe_single_video(spec: Dict[str, Any], index: int) -> Dict[str, Any]:
    """Probe a single video for metadata (audio presence, duration).
    Designed for parallel execution via ThreadPoolExecutor.

    Returns dict with: spec, index, prepared_path, has_audio, duration, probe, error
    """
    try:
        video_url = spec["url"]

        # Convert GCS URLs to signed URLs
        prepared_path = prepare_media_for_ffmpeg(video_url)

        # Probe video for metadata
        probe = ffmpeg.probe(prepared_path)
        has_audio = any(s.get('codec_type') == 'audio' for s in probe.get('streams', []))

        # Calculate duration (respects trim spec)
        duration = get_clip_duration(spec, prepared_path)

        logger.debug(f"[VideoEdit] Probed video {index+1}: {spec['filename']} - audio={has_audio}, duration={duration:.1f}s")

        return {
            "spec": spec,
            "index": index,
            "prepared_path": prepared_path,
            "has_audio": has_audio,
            "duration": duration,
            "probe": probe,
            "error": None
        }
    except Exception as e:
        logger.error(f"[VideoEdit] Probe error for video {index+1} ({spec.get('filename', 'unknown')}): {e}")
        return {
            "spec": spec,
            "index": index,
            "prepared_path": None,
            "has_audio": False,
            "duration": 0,
            "probe": None,
            "error": str(e)
        }


def combine_videos_with_transitions(
    video_specs: List[Dict[str, Any]],
    transitions: Optional[Dict[Tuple[Optional[str], Optional[str]], str]] = None,
    transition_durations: Optional[Dict[Tuple[Optional[str], Optional[str]], float]] = None,
    output_path: Optional[str] = None,
    session_id: str = "",
    aspect_ratio: str = "vertical",
    process_audio: bool = True
) -> Dict:
    """Combine videos in sequence with optional xfade transitions and per-clip trimming.

    Args:
        video_specs: Ordered list of video specs, each containing:
            url (str), filename (str), trim ({start, end} or None), mute_audio (bool, optional)
        transitions: Map of (from_filename, to_filename) -> transition type.
            Use (None, filename) for fade_in, (filename, None) for fade_out.
            Supported xfade types: fade, fadeslow, fadeblack, fadewhite, hblur,
            coverleft, coverright, revealleft, revealright, zoomin, squeezeh,
            squeezev, dissolve
        transition_durations: Map with same keys as transitions, values in seconds (default 0.5)
        output_path: File path for output. If None, pipes to memory buffer.
        session_id: Session identifier for logging
        aspect_ratio: Target aspect ratio -- vertical (1080x1920), horizontal (1920x1080),
            or square (1080x1080)
        process_audio: Whether to process audio streams

    Returns:
        Dict with status, output_path or output_buffer, videos_combined, transitions_applied
    """

    logger.info("=" * 80)
    logger.info(f"[VideoEdit] Starting video combination")
    logger.info(f"[VideoEdit] Input videos: {len(video_specs)}")
    logger.info(f"[VideoEdit] Aspect ratio: {aspect_ratio}")
    if transitions:
        logger.info(f"[VideoEdit] Transitions provided: {len(transitions)} total")
        for (from_v, to_v), trans_type in transitions.items():
            logger.info(f"[VideoEdit]   Transition key: ({from_v}, {to_v}) -> {trans_type}")
    else:
        logger.info(f"[VideoEdit] No transitions provided (hard cuts)")
    logger.info("=" * 80)

    if not video_specs:
        logger.error("[VideoEdit] No videos provided")
        return {"status": "error", "message": "No videos provided"}

    # Extract filenames from specs for transition matching
    video_filenames = [spec["filename"] for spec in video_specs]

    for i, spec in enumerate(video_specs):
        url = spec["url"]
        filename = spec["filename"]
        trim = spec.get("trim")

        if not url.startswith(("gs://", "https://")) and not os.path.exists(url):
            logger.error(f"[VideoEdit] Video {i+1} not found: {url}")
            return {"status": "error", "message": f"Video not found: {url}"}

        if trim:
            logger.info(f"[VideoEdit] Video {i+1}: {filename} (trim {trim['start']}s-{trim['end']}s)")
        else:
            logger.info(f"[VideoEdit] Video {i+1}: {filename} (full clip)")

    # Determine output mode: file path or memory buffer
    use_buffer = output_path is None
    if use_buffer:
        from io import BytesIO
        output_buffer = BytesIO()
    else:
        output_buffer = None

    # Target resolution based on aspect ratio
    if aspect_ratio in ["vertical", "9:16"]:
        target_width, target_height = 1080, 1920
    elif aspect_ratio in ["horizontal", "16:9"]:
        target_width, target_height = 1920, 1080
    elif aspect_ratio in ["square", "1:1"]:
        target_width, target_height = 1080, 1080
    else:
        target_width, target_height = 1080, 1920

    logger.info(f"[VideoEdit] Target resolution: {target_width}x{target_height}")

    try:
        # Phase 1: Probe all videos in parallel
        logger.info(f"[VideoEdit] Probing {len(video_specs)} videos in parallel...")

        probe_results = []
        with ThreadPoolExecutor(max_workers=min(12, len(video_specs))) as executor:
            future_to_index = {
                executor.submit(_probe_single_video, spec, i): i
                for i, spec in enumerate(video_specs)
            }

            for future in as_completed(future_to_index):
                index = future_to_index[future]
                try:
                    result = future.result()
                    probe_results.append(result)
                except Exception as e:
                    logger.error(f"[VideoEdit] Unexpected error probing video {index+1}: {e}")
                    probe_results.append({
                        "spec": video_specs[index],
                        "index": index,
                        "prepared_path": None,
                        "has_audio": False,
                        "duration": 0,
                        "probe": None,
                        "error": str(e)
                    })

        # Maintain original order
        probe_results.sort(key=lambda x: x["index"])

        # Check for probe errors
        failed_probes = [r for r in probe_results if r["error"]]
        if failed_probes:
            logger.error(f"[VideoEdit] {len(failed_probes)} video(s) failed probing")
            for failed in failed_probes:
                logger.error(f"[VideoEdit]   {failed['spec']['filename']}: {failed['error']}")
            return {"status": "error", "message": f"{len(failed_probes)} video(s) failed probing"}

        logger.info(f"[VideoEdit] All videos probed successfully")

        # Collect durations and paths
        prepared_paths = []
        video_durations = []
        for result in probe_results:
            prepared_paths.append(result["prepared_path"])
            video_durations.append(result["duration"])

        logger.info(f"[VideoEdit] Video durations (after trim): {video_durations}")

        # Skip audio processing if all clips are muted or lack audio
        all_clips_muted_or_no_audio = all(
            not result["has_audio"] or spec.get("mute_audio", False)
            for result, spec in zip(probe_results, video_specs)
        )

        if process_audio and all_clips_muted_or_no_audio:
            logger.info(f"[VideoEdit] All clips muted or no audio -- skipping audio processing")
            process_audio = False

        # Phase 2: Load videos with trimming and ensure all have audio streams
        video_audio_pairs = []

        for result in probe_results:
            spec = result["spec"]
            prepared_path = result["prepared_path"]
            has_audio = result["has_audio"]
            duration = result["duration"]
            trim_spec = spec.get("trim")

            # Input seeking trims both video and audio together
            if trim_spec and "start" in trim_spec and "end" in trim_spec:
                start = trim_spec["start"]
                end = trim_spec["end"]
                trim_duration = end - start

                if trim_duration > 0:
                    stream = ffmpeg.input(prepared_path, ss=start, t=trim_duration)
                    logger.info(f"[VideoEdit]   Trimmed via input seeking: {start}s to {end}s (duration={trim_duration}s)")
                else:
                    stream = ffmpeg.input(prepared_path)
                    logger.warning(f"[VideoEdit]   Invalid trim duration ({trim_duration}s), using full clip for {spec['filename']}")
            else:
                stream = ffmpeg.input(prepared_path)

            if process_audio:
                mute_audio = spec.get("mute_audio", False)

                if has_audio and not mute_audio:
                    audio_stream = stream.audio
                else:
                    # Generate silent audio matching video duration
                    audio_stream = ffmpeg.input('anullsrc=r=44100:cl=stereo', f='lavfi', t=duration)
                    if mute_audio:
                        logger.info(f"[VideoEdit] Video {result['index']+1} audio muted per spec")
                    else:
                        logger.info(f"[VideoEdit] Video {result['index']+1} has no audio -- added {duration:.1f}s silence")
                video_audio_pairs.append((stream.video, audio_stream))
            else:
                video_audio_pairs.append((stream.video, None))

        # Phase 3: Normalize all videos to target resolution and 30fps
        normalized_videos = []
        audio_streams = []

        for i, (video_stream, audio_stream) in enumerate(video_audio_pairs):
            normalized = (
                video_stream
                .filter('scale', target_width, target_height,
                        force_original_aspect_ratio='decrease')
                .filter('pad', target_width, target_height, '(ow-iw)/2', '(oh-ih)/2')
                .filter('setsar', '1')
                .filter('fps', fps=30)  # 30fps normalization for xfade compatibility
                .filter('settb', 'AVTB')  # Normalize timebase after fps (fps resets it)
            )

            normalized_videos.append(normalized)

            if process_audio and audio_stream is not None:
                audio_stream = audio_stream.filter('aresample', **{'async': 1})
                audio_streams.append(audio_stream)

        # --- Transition matching ---

        def find_transition(from_path, to_path):
            """Find transition matching the given paths (handles full path or filename)."""
            from_path = from_path if from_path else None
            to_path = to_path if to_path else None

            if not transitions:
                return None, None

            # Exact match
            if (from_path, to_path) in transitions:
                trans_type = transitions[(from_path, to_path)]
                trans_dur = transition_durations.get((from_path, to_path), 0.5) if transition_durations else 0.5
                logger.debug(f"[VideoEdit] Transition matched (exact): {trans_type} {trans_dur}s")
                return trans_type, trans_dur

            # Filename match (strip query parameters from URLs)
            from_name = from_path.split('/')[-1].split('?')[0] if from_path else None
            to_name = to_path.split('/')[-1].split('?')[0] if to_path else None
            logger.debug(f"[VideoEdit] Trying filename match: ({from_name}, {to_name})")
            if (from_name, to_name) in transitions:
                trans_type = transitions[(from_name, to_name)]
                trans_dur = transition_durations.get((from_name, to_name), 0.5) if transition_durations else 0.5
                logger.info(f"[VideoEdit] Transition matched (filename): {from_name} -> {to_name} = {trans_type} ({trans_dur}s)")
                return trans_type, trans_dur

            # None-keyed start/end transitions
            if from_path is None and (None, to_path) in transitions:
                trans_type = transitions[(None, to_path)]
                trans_dur = transition_durations.get((None, to_path), 0.5) if transition_durations else 0.5
                return trans_type, trans_dur
            if from_path is None and (None, to_name) in transitions:
                trans_type = transitions[(None, to_name)]
                trans_dur = transition_durations.get((None, to_name), 0.5) if transition_durations else 0.5
                return trans_type, trans_dur
            if to_path is None and (from_path, None) in transitions:
                trans_type = transitions[(from_path, None)]
                trans_dur = transition_durations.get((from_path, None), 0.5) if transition_durations else 0.5
                return trans_type, trans_dur
            if to_path is None and (from_name, None) in transitions:
                trans_type = transitions[(from_name, None)]
                trans_dur = transition_durations.get((from_name, None), 0.5) if transition_durations else 0.5
                return trans_type, trans_dur

            return None, None

        # Check for fade in at start
        fade_in_duration = 0
        fade_out_duration = 0

        if len(normalized_videos) > 0:
            trans_type, trans_dur = find_transition(None, video_filenames[0])
            if trans_type == "fade_in":
                fade_in_duration = trans_dur
                normalized_videos[0] = normalized_videos[0].split()[0].filter('fade', type='in', duration=trans_dur)

        # Build xfade transitions between consecutive clips
        xfade_transitions = []
        for i in range(len(video_filenames) - 1):
            trans_type, trans_dur = find_transition(video_filenames[i], video_filenames[i + 1])
            if trans_type and trans_type not in ["fade_in", "fade_out"]:
                xfade_transitions.append({
                    "index": i,
                    "type": trans_type,
                    "duration": trans_dur
                })
                logger.info(f"[VideoEdit] Added xfade #{i}: {video_filenames[i]} -> {video_filenames[i+1]} = {trans_type} ({trans_dur}s)")
            else:
                logger.debug(f"[VideoEdit] No transition between clips {i} and {i+1}")

        logger.info(f"[VideoEdit] Built {len(xfade_transitions)} xfade transitions from {len(video_specs)-1} possible")

        # Apply fade_out to last clip
        if len(normalized_videos) > 0:
            trans_type, trans_dur = find_transition(video_filenames[-1], None)
            if trans_type == "fade_out":
                has_incoming_xfade = any(t["index"] == len(video_filenames) - 2 for t in xfade_transitions)
                if has_incoming_xfade:
                    logger.info(f"[VideoEdit] Deferring fade_out on last clip (has incoming xfade)")
                    fade_out_duration = trans_dur
                else:
                    fade_out_duration = trans_dur
                    last_clip_duration = video_durations[-1]
                    fade_start_time = max(0, last_clip_duration - trans_dur)
                    normalized_videos[-1] = normalized_videos[-1].split()[0].filter(
                        'fade',
                        type='out',
                        start_time=fade_start_time,
                        duration=trans_dur
                    )
                    logger.info(f"[VideoEdit] Applied fade_out to last clip: start={fade_start_time:.2f}s, duration={trans_dur}s")

        # --- Combine clips ---

        if len(normalized_videos) == 1:
            final_video = normalized_videos[0]
            final_audio = audio_streams[0] if process_audio else None
            logger.info("[VideoEdit] Single video -- no transitions needed")
        elif not xfade_transitions:
            # No xfade transitions -- use concatenation with hard cuts
            if process_audio:
                # Interleave video and audio for synchronized concat: [v0, a0, v1, a1, ...]
                concat_inputs = []
                for video_stream, audio_stream in zip(normalized_videos, audio_streams):
                    concat_inputs.extend([video_stream, audio_stream])

                joined = ffmpeg.concat(*concat_inputs, n=len(normalized_videos), v=1, a=1).node
                final_video = joined[0]
                final_audio = joined[1]

                logger.info(f"[VideoEdit] Synchronized concat (v=1:a=1) for {len(normalized_videos)} videos with hard cuts")
            else:
                output = ffmpeg.concat(*normalized_videos, n=len(normalized_videos), v=1, a=0)
                final_video = output
                final_audio = None

                logger.info(f"[VideoEdit] Video-only concat (v=1:a=0) for {len(normalized_videos)} videos")
        else:
            # Apply xfade transitions between clips
            logger.info(f"[VideoEdit] Applying {len(xfade_transitions)} xfade transitions")

            current_video = normalized_videos[0]
            current_audio = audio_streams[0] if process_audio else None
            offset = video_durations[0]
            logger.info(f"[VideoEdit] Starting chain -- processing all {len(normalized_videos)} clips")

            for i in range(len(normalized_videos) - 1):
                trans_info = next((t for t in xfade_transitions if t["index"] == i), None)

                if trans_info:
                    # xfade transition
                    trans_type = trans_info["type"]
                    trans_dur = trans_info["duration"]

                    logger.info(f"[VideoEdit]   Clip {i}->{i+1}: xfade {trans_type} at offset {offset}s")

                    offset -= trans_dur

                    current_video = ffmpeg.filter(
                        [current_video, normalized_videos[i + 1]],
                        'xfade',
                        transition=trans_type,
                        duration=trans_dur,
                        offset=offset
                    )

                    # Audio crossfade
                    if process_audio:
                        current_audio = ffmpeg.filter(
                            [current_audio, audio_streams[i + 1]],
                            'acrossfade',
                            d=trans_dur
                        )
                    offset += video_durations[i + 1]
                    logger.info(f"[VideoEdit]     Offset now {offset}s after adding video {i+1} duration")
                else:
                    # Hard cut via concat
                    logger.info(f"[VideoEdit]   Clip {i}->{i+1}: hard cut (concat) at offset {offset}s")
                    current_video = ffmpeg.concat(current_video, normalized_videos[i + 1], v=1, a=0)
                    if process_audio:
                        current_audio = ffmpeg.concat(current_audio, audio_streams[i + 1], v=0, a=1)
                    offset += video_durations[i + 1]
                    logger.info(f"[VideoEdit]     Offset now {offset}s after adding video {i+1} duration")

            final_video = current_video
            final_audio = current_audio
            logger.info(f"[VideoEdit] Combined all {len(normalized_videos)} videos ({len(xfade_transitions)} xfades, {len(normalized_videos)-1-len(xfade_transitions)} hard cuts)")

            # Apply deferred fade_out after xfade chain
            if fade_out_duration > 0 and any(t["index"] == len(video_filenames) - 2 for t in xfade_transitions):
                total_duration = offset
                fade_start_time = total_duration - fade_out_duration
                logger.info(f"[VideoEdit] Applying timed fade_out: start={fade_start_time}s, duration={fade_out_duration}s")
                final_video = final_video.filter('fade', type='out', start_time=fade_start_time, duration=fade_out_duration)

        # Pixel format conversion after concatenation
        final_video = final_video.filter('format', 'yuv420p')

        # Output: pipe to memory or write to file
        if use_buffer:
            if process_audio:
                output = ffmpeg.output(
                    final_video,
                    final_audio,
                    'pipe:',
                    format='mp4',
                    vcodec='libx264',
                    acodec='aac',
                    preset='ultrafast',
                    crf=23,
                    movflags='frag_keyframe+empty_moov',
                    shortest=None,
                    **{'b:a': '192k'}
                )
            else:
                output = ffmpeg.output(
                    final_video,
                    'pipe:',
                    format='mp4',
                    vcodec='libx264',
                    preset='ultrafast',
                    crf=23,
                    movflags='frag_keyframe+empty_moov'
                )
        else:
            # File mode: high quality for final output
            if process_audio:
                output = ffmpeg.output(
                    final_video,
                    final_audio,
                    output_path,
                    vcodec='libx264',
                    acodec='aac',
                    preset='veryfast',
                    crf=18,  # Near-lossless
                    movflags='faststart',  # Web streaming optimization
                    shortest=None,
                    **{'b:a': '320k'}
                )
            else:
                output = ffmpeg.output(
                    final_video,
                    output_path,
                    vcodec='libx264',
                    preset='veryfast',
                    crf=18,
                    movflags='faststart'
                )

        # Execute FFmpeg
        try:
            if use_buffer:
                logger.info(f"[VideoEdit] Running FFmpeg (streaming to memory)...")
                process = ffmpeg.run_async(output, pipe_stdout=True, pipe_stderr=True)
                stdout, stderr = process.communicate()

                if process.returncode != 0:
                    error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "Unknown FFmpeg error"
                    logger.error(f"[VideoEdit] FFmpeg error code {process.returncode}")
                    logger.error(f"[VideoEdit] Error (first 500 chars): {error_msg[:500]}")
                    logger.error(f"[VideoEdit] Error (last 500 chars): {error_msg[-500:]}")
                    return {
                        "status": "error",
                        "message": f"FFmpeg error: {error_msg[-800:]}"
                    }

                output_buffer.write(stdout)
                output_buffer.seek(0)
                logger.info(f"[VideoEdit] Video combined successfully")
                logger.info("=" * 80)

                return {
                    "status": "success",
                    "output_buffer": output_buffer,
                    "videos_combined": len(video_specs),
                    "transitions_applied": len(xfade_transitions) + (1 if fade_in_duration else 0) + (1 if fade_out_duration else 0)
                }
            else:
                logger.info(f"[VideoEdit] Running FFmpeg (writing to file)...")

                try:
                    cmd_args = output.get_args()
                    logger.info(f"[VideoEdit] FFmpeg command: ffmpeg {' '.join(cmd_args)}")
                except Exception as e:
                    logger.warning(f"[VideoEdit] Could not log FFmpeg command: {e}")

                process = ffmpeg.run_async(output, pipe_stderr=True, overwrite_output=True)
                stdout, stderr = process.communicate()

                if process.returncode != 0:
                    error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "Unknown FFmpeg error"
                    logger.error(f"[VideoEdit] FFmpeg error code {process.returncode}")
                    logger.error(f"[VideoEdit] Error output:\n{error_msg}")
                    return {
                        "status": "error",
                        "message": f"FFmpeg error: {error_msg[-800:]}"
                    }

                if stderr:
                    stderr_msg = stderr.decode('utf-8', errors='ignore')
                    logger.info(f"[VideoEdit] FFmpeg output (last 1000 chars):\n{stderr_msg[-1000:]}")

                return {
                    "status": "success",
                    "output_path": output_path,
                    "videos_combined": len(video_specs),
                    "transitions_applied": len(xfade_transitions) + (1 if fade_in_duration else 0) + (1 if fade_out_duration else 0)
                }

        except ffmpeg.Error as e:
            logger.error(f"[VideoEdit] FFmpeg error occurred")
            error_output = e.stderr.decode() if e.stderr else str(e)
            error_tail = error_output[-2000:] if len(error_output) > 2000 else error_output
            logger.error(f"[VideoEdit] Error details: {error_tail[:1000]}")
            return {
                "status": "error",
                "message": f"FFmpeg error: {error_tail}"
            }

    except Exception as e:
        logger.error(f"[VideoEdit] Error: {str(e)}")
        return {
            "status": "error",
            "message": f"Failed to combine videos: {str(e)}"
        }


def add_audio_to_video(
    video_path: str,
    audio_path: str,
    output_path: Optional[str] = None,
    audio_volume: float = 0.7,
    mix_original: bool = True,
    session_id: str = ""
) -> Dict:
    """Mix music or audio into a video file.

    Args:
        video_path: Path or URL to input video (local, gs://, or https://)
        audio_path: Path or URL to audio file
        output_path: Output file path. If None, uses a temp file.
        audio_volume: Volume level for added audio (0.0 to 1.0)
        mix_original: If True, mix with existing audio via amix. If False, replace entirely.
        session_id: Session identifier for logging

    Returns:
        Dict with status, output_path, audio metadata
    """

    if not video_path.startswith(("gs://", "https://")) and not os.path.exists(video_path):
        return {"status": "error", "message": f"Video not found: {video_path}"}
    if not audio_path.startswith(("gs://", "https://")) and not os.path.exists(audio_path):
        return {"status": "error", "message": f"Audio not found: {audio_path}"}

    import tempfile
    if not output_path:
        fd, output_path = tempfile.mkstemp(suffix=".mp4", prefix="edited_audio_")
        os.close(fd)

    try:
        # Convert GCS URLs to signed URLs for FFmpeg
        prepared_video_path = prepare_media_for_ffmpeg(video_path)
        prepared_audio_path = prepare_media_for_ffmpeg(audio_path)

        # Probe video duration to trim audio and prevent black frame padding
        video_probe = ffmpeg.probe(prepared_video_path)
        video_duration = float(video_probe['format']['duration'])
        logger.info(f"[VideoEdit] Video duration: {video_duration:.2f}s")

        video = ffmpeg.input(prepared_video_path)

        # Trim audio to video length to prevent extending the output with black frames
        audio = ffmpeg.input(prepared_audio_path, ss=0, t=video_duration)
        logger.info(f"[VideoEdit] Audio trimmed to match video duration: {video_duration:.2f}s")

        audio_adjusted = audio.audio.filter('volume', audio_volume)

        if mix_original:
            has_audio = any(s.get('codec_type') == 'audio' for s in video_probe.get('streams', []))

            if has_audio:
                # amix: normalize=0 prevents automatic volume adjustment that can cause distortion
                mixed_audio = ffmpeg.filter(
                    [video.audio, audio_adjusted],
                    'amix',
                    inputs=2,
                    duration='shortest',
                    dropout_transition=0,
                    normalize=0
                )
            else:
                logger.info("[VideoEdit] Video has no audio, using only music track")
                mixed_audio = audio_adjusted

            # H.264 re-encode required for filter outputs (volume, amix)
            output = ffmpeg.output(
                video.video,
                mixed_audio,
                output_path,
                vcodec='libx264',
                preset='veryfast',
                crf=18,
                acodec='aac',
                movflags='faststart',
                **{'b:a': '320k'}
            )
        else:
            # Replace audio entirely (H.264 re-encode required for volume filter)
            output = ffmpeg.output(
                video.video,
                audio_adjusted,
                output_path,
                vcodec='libx264',
                preset='veryfast',
                crf=18,
                acodec='aac',
                movflags='faststart',
                **{'b:a': '320k'}
            )

        logger.info(f"[VideoEdit] Running FFmpeg for audio mixing...")
        logger.info(f"[VideoEdit] Audio mix config: video={video_path}, audio={audio_path}, volume={audio_volume}, mix_original={mix_original}")

        try:
            cmd_args = output.get_args()
            logger.info(f"[VideoEdit] FFmpeg command: ffmpeg {' '.join(cmd_args)}")
        except Exception as e:
            logger.warning(f"[VideoEdit] Could not log FFmpeg command: {e}")

        try:
            process = ffmpeg.run_async(output, pipe_stderr=True, overwrite_output=True)
            stdout, stderr = process.communicate()

            if process.returncode != 0:
                error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "Unknown FFmpeg error"
                logger.error(f"[VideoEdit] Audio mixing FFmpeg error code {process.returncode}")
                logger.error(f"[VideoEdit] Audio mixing error output:\n{error_msg}")
                return {
                    "status": "error",
                    "message": f"FFmpeg audio mixing error: {error_msg[-800:]}"
                }

            if stderr:
                stderr_msg = stderr.decode('utf-8', errors='ignore')
                logger.info(f"[VideoEdit] Audio mixing FFmpeg output (last 1000 chars):\n{stderr_msg[-1000:]}")

            return {
                "status": "success",
                "output_path": output_path,
                "audio_added": audio_path,
                "volume": audio_volume,
                "mixed_with_original": mix_original
            }
        except ffmpeg.Error as e:
            error_output = e.stderr.decode() if e.stderr else str(e)
            logger.error(f"[VideoEdit] Audio mixing FFmpeg error:\n{error_output}")
            return {
                "status": "error",
                "message": f"FFmpeg audio mixing error: {error_output[-800:]}"
            }

    except Exception as e:
        logger.error(f"[VideoEdit] Audio mixing exception: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "status": "error",
            "message": f"Failed to add audio: {str(e)}"
        }

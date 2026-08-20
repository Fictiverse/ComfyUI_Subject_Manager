import json
import math
import os
import re
import torch
import numpy as np
from PIL import Image, ImageOps

PRESETS_DIR = os.path.join(os.path.dirname(__file__), "presets")
LAST_USED_FILE = os.path.join(PRESETS_DIR, ".last_used")

_MINIMAL_FALLBACK = {
    "viewMode": "grid",
    "sections": [{"key": "subjects", "label": "Subjects", "enabled": True, "randomizeOnQueue": False, "color": None}],
    "categories": {"subjects": []},
}


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def default_data():
    last_name = None
    try:
        with open(LAST_USED_FILE, "r", encoding="utf-8") as fh:
            last_name = fh.read().strip() or None
    except OSError:
        last_name = None

    if last_name:
        data = _read_json(os.path.join(PRESETS_DIR, f"{last_name}.json"))
        if data is not None:
            return data

    data = _read_json(os.path.join(PRESETS_DIR, "default.json"))
    if data is not None:
        return data

    return json.loads(json.dumps(_MINIMAL_FALLBACK))


def sanitizeData(raw):
    data = raw if isinstance(raw, dict) else {}
    if not isinstance(data.get("sections"), list):
        data["sections"] = []
    if not isinstance(data.get("categories"), dict):
        data["categories"] = {}

    for sec in data["sections"]:
        key = sec.get("key")
        if key not in data["categories"] or not isinstance(data["categories"][key], list):
            data["categories"][key] = []
        for it in data["categories"][key]:
            if not isinstance(it, dict):
                continue
            it.setdefault("imageTags", [["face_id", "outfit"], ["face_id", "profile"], ["body", "outfit"], ["turnaround"]])
            it.setdefault("imageStates", [True, True, True, True])
            it.setdefault("audioTags", ["voice_timbre", "dialogue_sync"])
            it.setdefault("videoTags", ["acting", "facial_acting"])
            it.setdefault("enablePrompt", True)
    return data


def resolve_media_path(file_path):
    if not file_path:
        return None
    if os.path.isabs(file_path) and os.path.exists(file_path):
        return os.path.abspath(file_path)
    return None


def resize_pil_max_mp(img, max_mp):
    w, h = img.size
    mp = (w * h) / 1_000_000.0
    if mp > max_mp and max_mp > 0:
        scale = math.sqrt(max_mp / mp)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return img


def load_image_tensor(file_path, max_megapixel=1.0):
    real_path = resolve_media_path(file_path)
    if not real_path:
        return None
    try:
        img = Image.open(real_path)
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")
        img = resize_pil_max_mp(img, max_megapixel)
        image = np.array(img).astype(np.float32) / 255.0
        return torch.from_numpy(image)[None,]
    except Exception as e:
        print(f"[SubjectManager] Image load error ({file_path}): {e}")
        return None


def load_audio_dict(audio_obj, max_duration=15.0):
    if not audio_obj or not audio_obj.get("file"):
        return None

    real_path = resolve_media_path(audio_obj.get("file"))
    if not real_path:
        return None

    trim_start = float(audio_obj.get("trimStart", 0) or 0)
    trim_end = float(audio_obj.get("trimEnd", 0) or 0)

    waveform = None
    sample_rate = 44100

    try:
        import torchaudio
        waveform, sample_rate = torchaudio.load(real_path)
    except Exception:
        pass

    if waveform is None:
        try:
            import av
            container = av.open(real_path)
            audio_stream = next((s for s in container.streams if s.type == "audio"), None)
            if audio_stream is not None:
                sample_rate = audio_stream.codec_context.sample_rate or 44100
                resampler = av.AudioResampler(format="fltp", layout="stereo", rate=sample_rate)
                frames = []
                for frame in container.decode(audio_stream):
                    for resampled_frame in resampler.resample(frame):
                        frames.append(resampled_frame.to_ndarray())
                if frames:
                    audio_data = np.concatenate(frames, axis=1)
                    waveform = torch.from_numpy(audio_data).to(torch.float32)
        except Exception:
            pass

    if waveform is None:
        try:
            import soundfile as sf
            data, sample_rate = sf.read(real_path, dtype="float32")
            if data.ndim == 1:
                waveform = torch.from_numpy(data).unsqueeze(0)
            else:
                waveform = torch.from_numpy(data.T)
        except Exception as e:
            print(f"[SubjectManager] Audio load error ({real_path}): {e}")
            return None

    if waveform is None:
        return None

    total_samples = waveform.shape[-1]
    start_frame = max(0, int(trim_start * sample_rate))
    
    limit_end_sec = trim_start + max_duration if max_duration > 0 else (trim_end if trim_end > trim_start else total_samples / sample_rate)
    effective_end_sec = min(trim_end, limit_end_sec) if trim_end > trim_start else limit_end_sec
    end_frame = min(total_samples, int(effective_end_sec * sample_rate))

    if start_frame < end_frame:
        waveform = waveform[:, start_frame:end_frame]
    else:
        return None

    if waveform.dim() == 2:
        waveform = waveform.unsqueeze(0)

    return {"waveform": waveform, "sample_rate": sample_rate}


def load_video_data(video_obj, target_fps=24, video_max_megapixel=0.5, max_duration=15.0):
    if not video_obj or not video_obj.get("file"):
        return None, None

    real_path = resolve_media_path(video_obj.get("file"))
    if not real_path:
        return None, None

    trim_start = float(video_obj.get("trimStart", 0) or 0)
    trim_end = float(video_obj.get("trimEnd", 0) or 0)

    effective_max_sec = trim_start + max_duration if max_duration > 0 else float("inf")
    effective_end = min(trim_end, effective_max_sec) if trim_end > trim_start else effective_max_sec

    frames = []
    audio_dict = load_audio_dict({"file": real_path, "trimStart": trim_start, "trimEnd": effective_end}, max_duration=max_duration)

    try:
        import av
        container = av.open(real_path)
        video_stream = next((s for s in container.streams if s.type == "video"), None)
        if video_stream:
            time_base = float(video_stream.time_base)
            target_interval = 1.0 / max(1, target_fps)
            next_target_time = trim_start

            for packet in container.demux(video_stream):
                for frame in packet.decode():
                    pts_sec = float(frame.pts * time_base) if frame.pts is not None else 0
                    if pts_sec < trim_start:
                        continue
                    if pts_sec > effective_end:
                        break

                    if pts_sec >= next_target_time:
                        img = frame.to_image().convert("RGB")
                        img = resize_pil_max_mp(img, video_max_megapixel)
                        np_img = np.array(img).astype(np.float32) / 255.0
                        frames.append(np_img)
                        next_target_time += target_interval
    except Exception:
        try:
            import cv2
            cap = cv2.VideoCapture(real_path)
            src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            start_frame = int(trim_start * src_fps)
            end_frame = min(total_frames, int(effective_end * src_fps))
            
            frame_step = max(1, src_fps / target_fps)
            current_f = float(start_frame)

            while current_f < end_frame:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(current_f))
                ret, frame = cap.read()
                if not ret:
                    break
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                h, w = frame_rgb.shape[:2]
                mp = (w * h) / 1_000_000.0
                if mp > video_max_megapixel and video_max_megapixel > 0:
                    scale = math.sqrt(video_max_megapixel / mp)
                    frame_rgb = cv2.resize(frame_rgb, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)

                frames.append(frame_rgb.astype(np.float32) / 255.0)
                current_f += frame_step
            cap.release()
        except Exception as e:
            print(f"[SubjectManager] Video decode error ({real_path}): {e}")

    video_tensor = torch.from_numpy(np.stack(frames)) if frames else None
    return video_tensor, audio_dict


def adapt_prompt_references(prompt_text, active_img_count, has_audio, has_video, img_offset, aud_offset, vid_offset, subject_idx):
    if not prompt_text:
        return ""

    lines = prompt_text.split("\n")
    kept_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        drop_line = False

        img_tags = list(re.finditer(r"<\s*(picture|image|img)\s*(\d+)\s*>", stripped, re.IGNORECASE))
        if img_tags:
            for m in img_tags:
                tag_num = int(m.group(2))
                if active_img_count == 0 or tag_num > active_img_count:
                    drop_line = True
                    break

        if not drop_line and re.search(r"<\s*audio\s*(\d+)\s*>", stripped, re.IGNORECASE):
            if not has_audio:
                drop_line = True

        if not drop_line and re.search(r"<\s*video\s*(\d+)\s*>", stripped, re.IGNORECASE):
            if not has_video:
                drop_line = True

        if drop_line:
            continue

        def replace_tag(match):
            tag_name = match.group(1)
            tag_num = int(match.group(2))
            lower_name = tag_name.lower()

            if lower_name in ("picture", "image", "img"):
                global_slot = img_offset + tag_num
                return f"<{tag_name} {global_slot}>"
            elif lower_name == "audio":
                global_slot = aud_offset + tag_num
                return f"<{tag_name} {global_slot}>"
            elif lower_name == "video":
                global_slot = vid_offset + tag_num
                return f"<{tag_name} {global_slot}>"
            elif lower_name in ("subject", "character"):
                return f"<{tag_name} {subject_idx}>"
            return match.group(0)

        pattern = re.compile(r"<(picture|image|img|audio|video|subject|character)\s*(\d+)>", re.IGNORECASE)
        adapted_line = pattern.sub(replace_tag, stripped)
        adapted_line = re.sub(r"\s{2,}", " ", adapted_line).strip()

        if adapted_line:
            kept_lines.append(adapted_line)

    return "\n".join(kept_lines)


class SubjectManagerNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "subject_data": ("STRING", {"multiline": False, "default": json.dumps(default_data())}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
            }
        }

    RETURN_TYPES = ("SUBJECT_DATA",)
    RETURN_NAMES = ("subject_data",)
    FUNCTION = "process"
    CATEGORY = "utils/subject_manager"

    def process(self, subject_data, seed):
        return (subject_data,)


class SubjectUnpackNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1}),
                "image_max_megapixel": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 100.0, "step": 0.1}),
                "video_max_megapixel": ("FLOAT", {"default": 0.5, "min": 0.1, "max": 100.0, "step": 0.1}),
                "max_duration": ("FLOAT", {"default": 15.0, "min": 0.1, "max": 600.0, "step": 0.5}),
                "prefix": ("STRING", {"multiline": True, "default": "subject_definitions: \n"}),
            },
            "optional": {
                "subject_data": ("SUBJECT_DATA",),
            }
        }

    RETURN_TYPES = (
        "IMAGE", "IMAGE", "IMAGE", "IMAGE",
        "IMAGE", "IMAGE", "IMAGE", "IMAGE",
        "AUDIO", "AUDIO",
        "IMAGE", "AUDIO",
        "IMAGE", "AUDIO",
        "STRING",
    )
    RETURN_NAMES = (
        "image_1", "image_2", "image_3", "image_4",
        "image_5", "image_6", "image_7", "image_8",
        "audio_1", "audio_2",
        "video_1_images", "video_1_audio",
        "video_2_images", "video_2_audio",
        "prompt",
    )
    FUNCTION = "unpack"
    CATEGORY = "utils/subject_manager"

    def unpack(self, fps=24, image_max_megapixel=1.0, video_max_megapixel=0.5, max_duration=15.0, prefix="subject_definitions: \n", subject_data=None):
        if not subject_data:
            data = default_data()
        elif isinstance(subject_data, str):
            try:
                data = json.loads(subject_data)
            except Exception:
                data = default_data()
        else:
            data = subject_data

        categories = data.get("categories", {})
        sections = data.get("sections", [])

        collected_images = []
        collected_audios = []
        collected_videos = []
        collected_prompts = []

        subject_counter = 1

        for sec in sections:
            if not sec.get("enabled", True):
                continue
            key = sec.get("key")
            items = categories.get(key, [])
            for it in items:
                if it.get("selected") or it.get("alwaysOn"):
                    current_img_offset = len(collected_images)
                    current_aud_offset = len(collected_audios)
                    current_vid_offset = len(collected_videos)

                    # Images
                    global_img_on = it.get("enableImages", True) is not False
                    img_states = it.get("imageStates", [True, True, True, True])
                    card_active_images = []

                    if global_img_on:
                        for idx, img_path in enumerate(it.get("images", [])):
                            if img_path and idx < len(img_states) and img_states[idx] is not False:
                                if len(collected_images) < 8:
                                    img_t = load_image_tensor(img_path, max_megapixel=image_max_megapixel)
                                    if img_t is not None:
                                        collected_images.append(img_t)
                                        card_active_images.append(img_path)

                    # Audio
                    has_aud = False
                    if it.get("enableAudio", True) is not False:
                        aud = it.get("audio")
                        if aud and aud.get("file") and len(collected_audios) < 2:
                            aud_data = load_audio_dict(aud, max_duration=max_duration)
                            if aud_data is not None:
                                collected_audios.append(aud_data)
                                has_aud = True

                    # Vidéo
                    has_vid = False
                    if it.get("enableVideo", True) is not False:
                        vid = it.get("video")
                        if vid and vid.get("file") and len(collected_videos) < 2:
                            vid_frames, vid_audio = load_video_data(
                                vid,
                                target_fps=fps,
                                video_max_megapixel=video_max_megapixel,
                                max_duration=max_duration
                            )
                            if vid_frames is not None:
                                collected_videos.append((vid_frames, vid_audio))
                                has_vid = True

                    # Prompt
                    if it.get("enablePrompt", True) is not False:
                        raw_p = (it.get("prompt") or "").strip()
                        if raw_p:
                            adapted_p = adapt_prompt_references(
                                raw_p,
                                active_img_count=len(card_active_images),
                                has_audio=has_aud,
                                has_video=has_vid,
                                img_offset=current_img_offset,
                                aud_offset=current_aud_offset,
                                vid_offset=current_vid_offset,
                                subject_idx=subject_counter
                            )
                            if adapted_p:
                                collected_prompts.append(adapted_p)

                    subject_counter += 1

        # 8 sorties images
        out_images = [collected_images[i] if i < len(collected_images) else None for i in range(8)]

        # 2 sorties audio
        out_audios = [collected_audios[i] if i < len(collected_audios) else None for i in range(2)]

        # 2 sorties vidéo
        v1_img, v1_aud = collected_videos[0] if len(collected_videos) > 0 else (None, None)
        v2_img, v2_aud = collected_videos[1] if len(collected_videos) > 1 else (None, None)
        out_videos = [v1_img, v1_aud, v2_img, v2_aud]

        # Concaténation littérale du préfixe et du prompt sans strip destructif
        joined_prompt = "\n\n".join(collected_prompts)
        prefix_str = str(prefix) if prefix is not None else ""
        final_prompt = f"{prefix_str}{joined_prompt}\n\n"

        return tuple(out_images + out_audios + out_videos + [final_prompt])
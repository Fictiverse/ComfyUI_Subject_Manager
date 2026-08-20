import asyncio
import hashlib
import io
import json
import os
import re
import subprocess
import zipfile
from aiohttp import web
from PIL import Image, ImageOps

PRESETS_DIR = os.path.join(os.path.dirname(__file__), "presets")
LAST_USED_FILE = os.path.join(PRESETS_DIR, ".last_used")
MEDIA_DIR = os.path.join(PRESETS_DIR, "media")
THUMB_CACHE_DIR = os.path.join(PRESETS_DIR, ".thumb_cache")

ALLOWED_MEDIA_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp",
    ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a",
    ".mp4", ".webm", ".mkv", ".mov", ".avi"
}

try:
    from server import PromptServer
    _AVAILABLE = True
except ImportError:
    _AVAILABLE = False


def _ensure_dirs():
    os.makedirs(PRESETS_DIR, exist_ok=True)
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.makedirs(THUMB_CACHE_DIR, exist_ok=True)


def _safe_name(name):
    name = (name or "").strip()
    name = re.sub(r"[^A-Za-z0-9 _\-\.\(\)\[\]]", "", name)
    return name.strip(" .")[:80] or None


def _path_for_preset(name):
    return os.path.join(PRESETS_DIR, f"{name}.json")


def _get_unique_preset_name(desired_name):
    clean = _safe_name(desired_name) or "Imported_Preset"
    if not os.path.exists(_path_for_preset(clean)):
        return clean
    idx = 1
    while os.path.exists(_path_for_preset(f"{clean} ({idx})")):
        idx += 1
    return f"{clean} ({idx})"


def resolve_media_path(file_path):
    if not file_path:
        return None
    if os.path.isabs(file_path) and os.path.exists(file_path):
        return os.path.abspath(file_path)
    in_media = os.path.join(MEDIA_DIR, file_path)
    if os.path.exists(in_media):
        return os.path.abspath(in_media)
    return None


def get_cached_thumbnail(real_path, max_dim=250):
    _ensure_dirs()
    if not real_path or not os.path.exists(real_path):
        return None
    try:
        stat = os.stat(real_path)
        cache_key = f"{real_path}_{stat.st_mtime}_{max_dim}"
        thumb_name = f"{hashlib.md5(cache_key.encode('utf-8')).hexdigest()}.jpg"
        thumb_path = os.path.join(THUMB_CACHE_DIR, thumb_name)

        if os.path.exists(thumb_path):
            return thumb_path

        img = Image.open(real_path)
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)
        img.save(thumb_path, "JPEG", quality=82, optimize=True)
        return thumb_path
    except Exception:
        return real_path


if _AVAILABLE:
    routes = PromptServer.instance.routes

    @routes.get("/subject_manager/presets")
    async def sm_list_presets(request):
        _ensure_dirs()
        names = sorted(f[:-5] for f in os.listdir(PRESETS_DIR) if f.endswith(".json"))
        last = None
        try:
            with open(LAST_USED_FILE, "r", encoding="utf-8") as fh:
                last = fh.read().strip() or None
        except OSError:
            last = None
        return web.json_response({"names": names, "last": last})

    @routes.post("/subject_manager/last_used")
    async def sm_set_last_used(request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        name = _safe_name(body.get("name"))
        if name:
            _ensure_dirs()
            with open(LAST_USED_FILE, "w", encoding="utf-8") as fh:
                fh.write(name)
        return web.json_response({"ok": True})

    @routes.get("/subject_manager/presets/{name}")
    async def sm_get_preset(request):
        name = _safe_name(request.match_info.get("name"))
        if not name:
            return web.json_response({"error": "invalid name"}, status=400)
        path = _path_for_preset(name)
        if not os.path.exists(path):
            return web.json_response({"error": "not found"}, status=404)
        with open(path, "r", encoding="utf-8") as fh:
            return web.Response(text=fh.read(), content_type="application/json")

    @routes.post("/subject_manager/presets/{name}")
    async def sm_save_preset(request):
        name = _safe_name(request.match_info.get("name"))
        if not name:
            return web.json_response({"error": "invalid name"}, status=400)
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json body"}, status=400)
        _ensure_dirs()
        with open(_path_for_preset(name), "w", encoding="utf-8") as fh:
            json.dump(body, fh, indent=2)
        with open(LAST_USED_FILE, "w", encoding="utf-8") as fh:
            fh.write(name)
        return web.json_response({"ok": True, "name": name})

    @routes.post("/subject_manager/presets/{name}/rename")
    async def sm_rename_preset(request):
        name = _safe_name(request.match_info.get("name"))
        try:
            body = await request.json()
        except Exception:
            body = {}
        new_name = _safe_name(body.get("new_name"))
        if not name or not new_name:
            return web.json_response({"error": "invalid name"}, status=400)
        src, dst = _path_for_preset(name), _path_for_preset(new_name)
        if not os.path.exists(src):
            return web.json_response({"error": "not found"}, status=404)
        if os.path.exists(dst):
            return web.json_response({"error": "a preset with that name already exists"}, status=409)
        os.rename(src, dst)
        return web.json_response({"ok": True, "name": new_name})

    @routes.delete("/subject_manager/presets/{name}")
    async def sm_delete_preset(request):
        name = _safe_name(request.match_info.get("name"))
        if not name:
            return web.json_response({"error": "invalid name"}, status=400)
        path = _path_for_preset(name)
        if os.path.exists(path):
            os.remove(path)
        return web.json_response({"ok": True})

    # --- HELPERS D'OPTIMISATION & COMPRESSION POUR L'EXPORT ---
def _optimize_image_for_export(real_path, quality=80):
    """Compresse les images lourdes en JPEG 80% (ou WebP 80% si transparence)."""
    try:
        img = Image.open(real_path)
        img = ImageOps.exif_transpose(img)

        # Vérification si un canal alpha est réellement utilisé
        has_alpha = False
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            alpha = img.convert("RGBA").getchannel("A")
            if alpha.getextrema() != (255, 255):
                has_alpha = True

        out_buf = io.BytesIO()
        if has_alpha:
            img.save(out_buf, "WEBP", quality=quality, method=6)
            out_buf.seek(0)
            return out_buf.read(), ".webp"
        else:
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(out_buf, "JPEG", quality=quality, optimize=True)
            out_buf.seek(0)
            return out_buf.read(), ".jpg"
    except Exception:
        with open(real_path, "rb") as f:
            return f.read(), os.path.splitext(real_path)[1].lower()


def _optimize_audio_for_export(real_path):
    """Convertit automatiquement les fichiers WAV / FLAC en MP3 192kbps léger."""
    ext = os.path.splitext(real_path)[1].lower()
    if ext in (".mp3", ".m4a", ".aac", ".ogg"):
        with open(real_path, "rb") as f:
            return f.read(), ext

    # 1. Tentative avec PyAV (souvent disponible dans ComfyUI)
    try:
        import av
        in_container = av.open(real_path)
        in_stream = next((s for s in in_container.streams if s.type == "audio"), None)
        if in_stream is not None:
            out_buf = io.BytesIO()
            out_container = av.open(out_buf, mode="w", format="mp3")
            rate = in_stream.codec_context.sample_rate or 44100
            out_stream = out_container.add_stream("mp3", rate=rate)
            out_stream.bit_rate = 192000

            for frame in in_container.decode(in_stream):
                frame.pts = None
                for packet in out_stream.encode(frame):
                    out_container.mux(packet)
            for packet in out_stream.encode():
                out_container.mux(packet)

            out_container.close()
            out_buf.seek(0)
            return out_buf.read(), ".mp3"
    except Exception:
        pass

    # 2. Fallback avec torchaudio
    try:
        import torchaudio
        waveform, sr = torchaudio.load(real_path)
        out_buf = io.BytesIO()
        torchaudio.save(out_buf, waveform, sr, format="mp3")
        out_buf.seek(0)
        return out_buf.read(), ".mp3"
    except Exception:
        pass

    # Si conversion impossible, on garde le format d'origine sans bloquer
    with open(real_path, "rb") as f:
        return f.read(), ext


# --- EXPORT PACK .ZIP SÉCURISÉ & COMPRESSÉ ---
@routes.get("/subject_manager/export_bundle/{name}")
async def sm_export_bundle(request):
    name = _safe_name(request.match_info.get("name"))
    if not name:
        return web.json_response({"error": "invalid name"}, status=400)
    path = _path_for_preset(name)
    if not os.path.exists(path):
        return web.json_response({"error": "preset not found"}, status=404)

    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as e:
        return web.json_response({"error": f"Failed to read preset: {e}"}, status=500)

    zip_buffer = io.BytesIO()

    def _build_zip():
        with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            categories = data.get("categories", {})
            for sec_key, items in categories.items():
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    
                    # 1. Images : Compression JPEG 80% / WebP
                    new_imgs = []
                    for img_p in it.get("images", []):
                        if not img_p:
                            continue
                        real = resolve_media_path(img_p)
                        if real and os.path.exists(real):
                            content, ext = _optimize_image_for_export(real, quality=80)
                            hname = f"{hashlib.md5(content).hexdigest()}{ext}"
                            arc_path = f"media/{hname}"
                            if arc_path not in zf.namelist():
                                zf.writestr(arc_path, content)
                            new_imgs.append(hname)
                        else:
                            new_imgs.append(img_p)
                    it["images"] = new_imgs

                    # 2. Audio : Conversion WAV -> MP3 192k
                    if it.get("audio") and it["audio"].get("file"):
                        real = resolve_media_path(it["audio"]["file"])
                        if real and os.path.exists(real):
                            content, ext = _optimize_audio_for_export(real)
                            hname = f"{hashlib.md5(content).hexdigest()}{ext}"
                            arc_path = f"media/{hname}"
                            if arc_path not in zf.namelist():
                                zf.writestr(arc_path, content)
                            it["audio"]["file"] = hname

                    # 3. Vidéo : Copie optimisée
                    if it.get("video") and it["video"].get("file"):
                        real = resolve_media_path(it["video"]["file"])
                        if real and os.path.exists(real):
                            ext = os.path.splitext(real)[1].lower()
                            if ext in ALLOWED_MEDIA_EXTENSIONS:
                                with open(real, "rb") as vf:
                                    content = vf.read()
                                hname = f"{hashlib.md5(content).hexdigest()}{ext}"
                                arc_path = f"media/{hname}"
                                if arc_path not in zf.namelist():
                                    zf.writestr(arc_path, content)
                                it["video"]["file"] = hname

            # Écriture du JSON assaini dans l'archive
            zf.writestr("preset.json", json.dumps(data, indent=2))

    await asyncio.to_thread(_build_zip)
    zip_buffer.seek(0)

    filename = f"{name}_bundle.zip"
    return web.Response(
        body=zip_buffer.read(),
        content_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

# --- IMPORT PACK .ZIP SÉCURISÉ (STREAMING / SANS LIMITE DE TAILLE DE CHAMP) ---
@routes.post("/subject_manager/import_bundle")
async def sm_import_bundle(request):
    _ensure_dirs()
    try:
        reader = await request.multipart()
        field = await reader.next()
        if not field or field.name != "file":
            return web.json_response({"error": "No zip file provided"}, status=400)

        upload_name = field.filename or "imported_bundle.zip"
        base_preset_name = os.path.splitext(upload_name)[0].replace("_bundle", "")

        # Lecture par flux (chunks) pour accepter les gros fichiers sans restriction
        zip_buf = io.BytesIO()
        max_size = 500 * 1024 * 1024  # Limite 500 Mo
        total_read = 0

        while True:
            chunk = await field.read_chunk(size=65536)  # Blocs de 64 Ko
            if not chunk:
                break
            total_read += len(chunk)
            if total_read > max_size:
                return web.json_response({"error": "Archive exceeds 500MB limit"}, status=400)
            zip_buf.write(chunk)

        zip_buf.seek(0)
        if not zipfile.is_zipfile(zip_buf):
            return web.json_response({"error": "File is not a valid zip archive"}, status=400)

        def _process_import():
            with zipfile.ZipFile(zip_buf, "r") as zf:
                if "preset.json" not in zf.namelist():
                    raise ValueError("Invalid bundle: missing preset.json inside archive")

                extracted_media = 0
                for member in zf.infolist():
                    if member.is_dir():
                        continue
                    norm_name = os.path.normpath(member.filename)
                    if norm_name.startswith("..") or os.path.isabs(norm_name):
                        continue

                    if norm_name.startswith("media" + os.sep) or norm_name.startswith("media/"):
                        fname = os.path.basename(norm_name)
                        ext = os.path.splitext(fname)[1].lower()
                        if ext not in ALLOWED_MEDIA_EXTENSIONS:
                            continue

                        dest_path = os.path.join(MEDIA_DIR, fname)
                        if not os.path.exists(dest_path):
                            with zf.open(member) as src_f, open(dest_path, "wb") as dst_f:
                                dst_f.write(src_f.read())
                            extracted_media += 1

                with zf.open("preset.json") as jf:
                    preset_data = json.load(jf)

                final_name = _get_unique_preset_name(base_preset_name)
                final_path = _path_for_preset(final_name)

                with open(final_path, "w", encoding="utf-8") as out_f:
                    json.dump(preset_data, out_f, indent=2)

                return final_name, extracted_media

        final_name, count = await asyncio.to_thread(_process_import)
        return web.json_response({"ok": True, "name": final_name, "media_count": count})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- Sélection native OS UTF-8 ---
@routes.post("/subject_manager/pick_file")
async def sm_pick_file(request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    media_type = body.get("type", "image")

    def _open_native_picker():
        import platform
        cur_os = platform.system()

        if cur_os == "Windows":
            filter_str = "All Files (*.*)|*.*"
            if media_type == "image":
                filter_str = "Images (*.jpg;*.jpeg;*.png;*.webp;*.bmp)|*.jpg;*.jpeg;*.png;*.webp;*.bmp|All Files (*.*)|*.*"
            elif media_type == "audio":
                filter_str = "Audio (*.mp3;*.wav;*.flac;*.aac;*.ogg;*.m4a)|*.mp3;*.wav;*.flac;*.aac;*.ogg;*.m4a|All Files (*.*)|*.*"
            elif media_type == "video":
                filter_str = "Video (*.mp4;*.webm;*.mkv;*.mov;*.avi)|*.mp4;*.webm;*.mkv;*.mov;*.avi|All Files (*.*)|*.*"

            ps_cmd = f"""
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
            [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
            $f = New-Object System.Windows.Forms.OpenFileDialog
            $f.Filter = '{filter_str}'
            $f.Title = 'Select {media_type.capitalize()} File'
            if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
                [Console]::WriteLine($f.FileName)
            }}
            """
            try:
                res = subprocess.run(
                    ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
                    capture_output=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=120
                )
                chosen = res.stdout.strip()
                return chosen if chosen and os.path.exists(chosen) else None
            except Exception:
                return None

        elif cur_os == "Darwin":
            try:
                res = subprocess.run(
                    ["osascript", "-e", 'POSIX path of (choose file with prompt "Select Media File")'],
                    capture_output=True,
                    encoding="utf-8",
                    text=True,
                    timeout=120
                )
                chosen = res.stdout.strip()
                return chosen if chosen and os.path.exists(chosen) else None
            except Exception:
                return None

        elif cur_os == "Linux":
            try:
                res = subprocess.run(
                    ["zenity", "--file-selection", "--title=Select Media File"],
                    capture_output=True,
                    encoding="utf-8",
                    text=True,
                    timeout=120
                )
                chosen = res.stdout.strip()
                return chosen if chosen and os.path.exists(chosen) else None
            except Exception:
                return None

        return None

    chosen = await asyncio.to_thread(_open_native_picker)
    if chosen:
        return web.json_response({"ok": True, "path": os.path.abspath(chosen)})
    return web.json_response({"ok": False, "canceled": True})

# --- Réception Upload drag & drop média classique ---
@routes.post("/subject_manager/upload")
async def sm_upload_media(request):
    _ensure_dirs()
    try:
        reader = await request.multipart()
        field = await reader.next()
        if not field or field.name != "file":
            return web.json_response({"error": "No file field found"}, status=400)

        filename = field.filename or "media"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_MEDIA_EXTENSIONS:
            return web.json_response({"error": "Unsupported file format"}, status=400)

        content = await field.read()
        md5_hash = hashlib.md5(content).hexdigest()
        saved_name = f"{md5_hash}{ext}"
        filepath = os.path.join(MEDIA_DIR, saved_name)

        if not os.path.exists(filepath):
            with open(filepath, "wb") as f:
                f.write(content)

        return web.json_response({"ok": True, "filename": saved_name, "path": os.path.abspath(filepath)})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- Miniatures & Fichiers ---
@routes.get("/subject_manager/thumbnail")
async def sm_get_thumbnail(request):
    file_path = request.query.get("path", "")
    resolved = resolve_media_path(file_path)
    if not resolved or not os.path.exists(resolved):
        return web.json_response({"error": "not found"}, status=404)

    thumb_path = await asyncio.to_thread(get_cached_thumbnail, resolved, 250)
    if not thumb_path or not os.path.exists(thumb_path):
        thumb_path = resolved

    resp = web.FileResponse(thumb_path)
    resp.headers["Cache-Control"] = "public, max-age=604800"
    return resp

@routes.get("/subject_manager/view_file")
async def sm_view_file(request):
    file_path = request.query.get("path", "")
    resolved = resolve_media_path(file_path)
    if not resolved or not os.path.exists(resolved):
        return web.json_response({"error": "not found"}, status=404)

    resp = web.FileResponse(resolved)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp

@routes.post("/subject_manager/check_media")
async def sm_check_media(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)

    files = body.get("files", [])
    results = {}
    for f in files:
        if not f:
            continue
        resolved = resolve_media_path(f)
        exists = resolved is not None and os.path.exists(resolved)
        results[f] = {
            "exists": exists,
            "path": resolved if exists else f,
        }
    return web.json_response({"ok": True, "results": results})
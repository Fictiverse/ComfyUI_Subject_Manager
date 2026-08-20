# 🗂️ ComfyUI Subject Manager

[![ComfyUI](https://img.shields.io/badge/ComfyUI-Custom_Node-blue.svg)](https://github.com/comfyanonymous/ComfyUI)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-green.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Subject Manager** is a multimodal visual asset management suite for **ComfyUI**. It organizes, trims, and injects references (**Images, Audio, Video, and Prompts**) into multimodal generative models (such as **MiniMax / Hailuo Video-01 Full-Reference**, Wan 2.1, CogVideoX, LTX-Video).

Featuring an in-graph DOM interface directly inside the ComfyUI canvas, it builds structured libraries of **Characters**, **Objects**, and **Environments** while automatically generating synchronized prompt templates.

---

## ✨ Key Features

### 🎨 1. In-Graph UI Widget
* **Custom Category Tabs:** Create, rename, reorder, and color-code sections (*Characters, Props, Scenes*).
* **Grid & List Views:** Visual cards with dynamic mosaic previews for image slots.
* **Selection Logic:** Single-click *Solo Select* or cumulative *Always-On* (⭐) multi-selection.
* **Queue Randomization (🎲):** Per-section random rolls controlled by a deterministic `seed`.

### 🖼️ 2. Multimodal Slots
* **4 Image Slots:** Drag-and-drop reordering, visibility toggles, missing file alerts, and aspect ratio preservation.
* **Audio Waveform Trimmer:** Interactive waveform display with start/end trim handles and real-time playback.
* **Video Trimmer:** Embedded video player with frame-accurate trim controls.
* **Native File Picker:** System dialog with full UTF-8 support across Windows, macOS, and Linux.

### 🏷️ 3. Prompt Synthesizer & Syntax Highlighting
* **Tag Drawer:** Assign semantic roles (*Face / ID, Outfit, 3/4 Profile, Body Shape, Pose, Foley, Voice Timbre*).
* **Hover Tooltips:** Preview exact generated prompt segments directly on hover.
* **Syntax Highlighting:** Live theme-based highlighting for `<Subject X>`, `<Picture X>`, `<Audio X>`, and `<Video X>`.
* **Automatic Index Mapping:** Resolves dynamic reference offsets across multiple active subjects on the fly.

### 📦 4. Portable & Safe ZIP Bundles
* **Standalone `.zip` Export:** Packages presets with all referenced media in a single archive.
* **Automatic Compression:** Converts heavy PNGs to **JPEG 80%** (or WebP with alpha) and WAVs to **MP3 192k** to minimize file size.
* **Hardened Import Protection:** Automatically prevents preset overwrites (`Preset (1)`) with path traversal and file extension validation.

---

## 🧩 Nodes Overview

### 1. `SubjectManagerNode`
* Main UI container node hosting the interactive graphical widget.
* **Inputs:** `seed` (randomization control), `subject_data` (internal JSON payload).
* **Output:** `subject_data` (structured payload for the unpack node).

### 2. `SubjectUnpackNode`
* Decodes, processes, and outputs active media assets into the workflow.
* **Parameters:**
  * `fps`: Sampling framerate for video frames (default: `24`).
  * `image_max_megapixel`: Proportional max-megapixel limit for images without cropping (default: `1.0 MP`).
  * `video_max_megapixel`: Max-megapixel resolution for video frames (default: `0.5 MP`).
  * `max_duration`: Maximum extraction duration for audio/video in seconds (default: `15.0s`).
  * `prefix`: Multiline string prepended to the final prompt (default: `subject_definitions: \n`).
* **Outputs:**
  * `image_1` to `image_8`: Image tensors (`IMAGE`).
  * `audio_1` & `audio_2`: Audio dictionary structures (`AUDIO`).
  * `video_1_images`, `video_1_audio`: Frame sequences (`IMAGE`) and audio track (`AUDIO`) for Video 1.
  * `video_2_images`, `video_2_audio`: Frame sequences (`IMAGE`) and audio track (`AUDIO`) for Video 2.
  * `prompt`: Final combined prompt with synchronized reference numbering.

---

## 📥 Installation

```bash
cd ComfyUI/custom_nodes/
git clone https://github.com/your-username/ComfyUI-Subject-Manager.git
pip install -r requirements.txt
```

---

## 📋 Requirements (`requirements.txt`)

```text
torch
numpy
Pillow
aiohttp
av
torchaudio
soundfile
```

---

## 🚀 Quickstart

1. Add **`SubjectManagerNode`** and **`SubjectUnpackNode`** to your workflow.
2. Connect `subject_data` between both nodes.
3. Open the UI, click **`+ Add Subject Card`**, populate image/audio/video slots, configure tags, and click **`Save`**.
4. Route `image_1`, `audio_1`, and `prompt` outputs to your downstream generation nodes.
5. Click **Queue Prompt**.

---

## 📄 Supported Formats

| Media Type | Allowed Extensions |
| :--- | :--- |
| **Images** | `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp` |
| **Audio** | `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a` |
| **Video** | `.mp4`, `.webm`, `.mkv`, `.mov`, `.avi` |

---

## 📜 License

This project is licensed under the **GNU License**.
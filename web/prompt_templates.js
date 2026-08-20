// ===========================================================================
// Configuration des Puces Combinatoires (Tags) par Type de Sujet
// ===========================================================================
// ===========================================================================
// Configuration des Puces Combinatoires (Tags avec descriptions de prompt)
// ===========================================================================
export const COMBINATORIAL_CONFIG = {
  character: {
    imageTags: [
      { id: "face_id", label: "Face / ID", desc: "facial structure, eye landmarks, and skin tone" },
      { id: "outfit", label: "Outfit", desc: "exact garment design, fabric weave, and color scheme" },
      { id: "body", label: "Body Shape", desc: "anatomical height, silhouette proportions, and physical build" },
      { id: "profile", label: "3/4 Profile", desc: "3/4 jawline angle and side bone contours" },
      { id: "expression", label: "Expression", desc: "emotional expression and subtle gaze" },
      { id: "turnaround", label: "Turnaround", desc: "multi-angle 360° turnaround 3D consistency" },
      { id: "pose", label: "Action Pose", desc: "dynamic body posture, stance balance, and weight distribution" },
    ],
    imageDefaultPreset: [
      ["face_id", "outfit"],
      ["face_id", "profile"],
      ["body", "outfit"],
      ["turnaround"],
    ],
    audioTags: [
      { id: "voice_timbre", label: "Voice Timbre (S1)", desc: "vocal timbre, pitch resonance, and acoustic profile" },
      { id: "dialogue_sync", label: "Dialogue Sync", desc: "synchronized spoken cadence, phrase pacing, and dialogue delivery" },
      { id: "singing", label: "Singing Track", desc: "musical pitch modulation, singing melody, and vibrato" },
      { id: "whisper", label: "Whisper", desc: "intimate breathy whisper vocalization" },
      { id: "intense", label: "Intense/Shout", desc: "high-energy shouting vocal projection and breathing exertion" },
    ],
    audioDefault: ["voice_timbre", "dialogue_sync"],
    videoTags: [
      { id: "acting", label: "Acting / Motion", desc: "body motion kinetics, natural pacing, and physical acting dynamics" },
      { id: "facial_acting", label: "Facial Emotions", desc: "facial micro-expressions, lip movement articulation, and emotional reactions" },
      { id: "combat", label: "Combat / Stunt", desc: "action stunt momentum, physical acrobatics, and choreography" },
      { id: "idle", label: "Idle / Breathing", desc: "organic chest breathing cadence and resting weight shifts" },
    ],
    videoDefault: ["acting", "facial_acting"],
  },

  object: {
    imageTags: [
      { id: "form_3d", label: "Shape & Form", desc: "overall 3D geometric shape, proportions, and silhouette" },
      { id: "texture_wear", label: "Material & Texture", desc: "surface material texture, reflectivity, color, and finish" },
      { id: "angles", label: "Multi-Angle Views", desc: "appearance from multiple angles and perspectives" },
      { id: "in_hand", label: "In-Hand Scale", desc: "relative real-world scale and human grip orientation" },
      { id: "details", label: "Parts & Details", desc: "mechanical components, buttons, and functional details" },
    ],
    imageDefaultPreset: [
      ["form_3d", "texture_wear"],
      ["angles"],
      ["details"],
      ["in_hand"],
    ],
    audioTags: [
      { id: "foley", label: "Handling & Clicks", desc: "tactile friction, mechanical clicks, and handling contact sounds" },
      { id: "audio_fx", label: "Operation Sound", desc: "distinctive operational hum and working sound effects" },
      { id: "impact", label: "Impact & Drop", desc: "hard surface collision and impact acoustics" },
    ],
    audioDefault: ["foley"],
    videoTags: [
      { id: "handling", label: "Handling & Motion", desc: "physical mass momentum, inertia, and realistic handling dynamics" },
      { id: "mechanics", label: "Moving Parts", desc: "moving parts articulation and mechanical operation" },
      { id: "turntable", label: "360° Rotation", desc: "smooth 360-degree rotation showing all sides" },
    ],
    videoDefault: ["handling"],
  },

  scene: {
    imageTags: [
      { id: "layout", label: "Master Layout", desc: "architectural layout and spatial composition" },
      { id: "lighting", label: "Lighting & Mood", desc: "atmospheric lighting direction, volumetric contrast, and color mood" },
      { id: "depth", label: "Depth & Horizon", desc: "deep background perspective, horizon line, and ceiling vanishing point" },
      { id: "props_texture", label: "Props & Ground", desc: "foreground props placement and ground surface materials" },
      { id: "weather", label: "Fog & Weather", desc: "environmental mist density, rain streaks, and atmospheric haze" },
    ],
    imageDefaultPreset: [
      ["layout", "lighting"],
      ["depth"],
      ["props_texture"],
      ["weather"],
    ],
    audioTags: [
      { id: "room_tone", label: "Room Tone", desc: "indoor room tone, spatial volume, and reverb signature" },
      { id: "ambient", label: "Ambient Nature", desc: "ambient background soundscape and natural room atmosphere" },
      { id: "weather_sound", label: "Weather Wind/Rain", desc: "wind gust aerodynamics and environmental weather acoustics" },
    ],
    audioDefault: ["room_tone", "ambient"],
    videoTags: [
      { id: "camera_path", label: "Camera Trajectory", desc: "cinematic camera trajectory, drone path, and parallax movement" },
      { id: "env_dynamics", label: "Wind & Particles", desc: "environmental wind velocity, dust particles, and foliage physics" },
      { id: "lighting_drift", label: "Light Drift", desc: "volumetric lighting shifts and moving shadow dynamics" },
    ],
    videoDefault: ["camera_path", "env_dynamics"],
  },
};

export const ROLES_CONFIG = COMBINATORIAL_CONFIG;

// ===========================================================================
// Smart Combinatorial Synthesizer pour MiniMax Full-Reference
// ===========================================================================
export function generatePromptTemplate(type, data) {
  const rawName = data.name && data.name.trim() ? data.name.trim() : "Subject 1";
  const isGeneric = /^subject\s*\d+$/i.test(rawName);
  
  const baseTag = isGeneric ? `<Subject 1>` : `<Subject 1> (${rawName})`;
  const speakerTag = isGeneric ? `<Subject 1> (S1)` : `<Subject 1> (${rawName}) (S1)`;

  const validImgs = (data.images || []).filter(Boolean);
  const imgCount = validImgs.length;
  const imageTagsList = data.imageTags || [];
  const audTags = data.audioTags || [];
  const vidTags = data.videoTags || [];

  const hasAudio = !!(data.audio && data.audio.file);
  const hasVideo = !!(data.video && data.video.file);

  const lines = [];

  // --- 1. Images Synthesis ---
  if (imgCount === 0) {
    lines.push(`${baseTag} is the primary ${type}.`);
  } else {
    validImgs.forEach((_, idx) => {
      const picTag = `<Picture ${idx + 1}>`;
      const tags = imageTagsList[idx] || [];

      if (type === "character") {
        const parts = [];
        if (tags.includes("face_id")) parts.push("facial structure, eye landmarks, and skin tone");
        if (tags.includes("profile")) parts.push("3/4 jawline angle and side bone contours");
        if (tags.includes("body")) parts.push("anatomical height, silhouette proportions, and physical build");
        if (tags.includes("outfit")) parts.push("exact garment design, fabric weave, and color scheme");
        if (tags.includes("expression")) parts.push("emotional expression and subtle gaze");
        if (tags.includes("turnaround")) parts.push("multi-angle 360° turnaround 3D consistency");
        if (tags.includes("pose")) parts.push("dynamic body posture, stance balance, and weight distribution");

        if (parts.length > 0) {
          lines.push(`${picTag} defines ${baseTag}'s ${parts.join(", and ")}.`);
        } else {
          lines.push(`${baseTag} follows the visual appearance established in ${picTag}.`);
        }
      } else if (type === "object") {
        const parts = [];
        if (tags.includes("form_3d")) parts.push("overall 3D geometric shape, proportions, and silhouette");
        if (tags.includes("texture_wear")) parts.push("surface material texture, reflectivity, color, and finish");
        if (tags.includes("angles") || tags.includes("ortho")) parts.push("appearance from multiple angles and perspectives");
        if (tags.includes("in_hand")) parts.push("relative real-world scale and human grip orientation");
        if (tags.includes("details") || tags.includes("mechanics")) parts.push("mechanical components, buttons, and functional details");

        if (parts.length > 0) {
          lines.push(`${picTag} establishes ${baseTag}'s ${parts.join(", and ")}.`);
        } else {
          lines.push(`${baseTag} matches the object design shown in ${picTag}.`);
        }
      } else if (type === "scene") {
        const parts = [];
        if (tags.includes("layout")) parts.push("architectural layout and spatial composition");
        if (tags.includes("lighting")) parts.push("atmospheric lighting direction, volumetric contrast, and color mood");
        if (tags.includes("depth")) parts.push("deep background perspective, horizon line, and ceiling vanishing point");
        if (tags.includes("props_texture")) parts.push("foreground props placement and ground surface materials");
        if (tags.includes("weather")) parts.push("environmental mist density, rain streaks, and atmospheric haze");

        if (parts.length > 0) {
          lines.push(`${picTag} establishes ${baseTag}'s ${parts.join(", and ")}.`);
        } else {
          lines.push(`${baseTag} follows the environmental setting in ${picTag}.`);
        }
      }
    });
  }

  // --- 2. Video Synthesis ---
  if (hasVideo) {
    const vidParts = [];
    if (type === "character") {
      if (vidTags.includes("acting")) vidParts.push("body motion kinetics, natural pacing, and physical acting dynamics");
      if (vidTags.includes("facial_acting")) vidParts.push("facial micro-expressions, lip movement articulation, and emotional reactions");
      if (vidTags.includes("combat")) vidParts.push("action stunt momentum, physical acrobatics, and choreography");
      if (vidTags.includes("idle")) vidParts.push("organic chest breathing cadence and resting weight shifts");
    } else if (type === "object") {
      if (vidTags.includes("handling") || vidTags.includes("physics")) vidParts.push("physical mass momentum, inertia, and realistic handling dynamics");
      if (vidTags.includes("mechanics") || vidTags.includes("articulation")) vidParts.push("moving parts articulation and mechanical operation");
      if (vidTags.includes("turntable") || vidTags.includes("rotation")) vidParts.push("smooth 360-degree rotation showing all sides");
    } else if (type === "scene") {
      if (vidTags.includes("camera_path")) vidParts.push("cinematic camera trajectory, drone path, and parallax movement");
      if (vidTags.includes("env_dynamics")) vidParts.push("environmental wind velocity, dust particles, and foliage physics");
      if (vidTags.includes("lighting_drift")) vidParts.push("volumetric lighting shifts and moving shadow dynamics");
    }

    if (vidParts.length > 0) {
      lines.push(`<Video 1> provides ${baseTag}'s ${vidParts.join(", and ")}.`);
    } else {
      lines.push(`${baseTag}'s motion dynamics follow <Video 1>.`);
    }
  }

  // --- 3. Audio Synthesis ---
  if (hasAudio) {
    const audParts = [];
    if (type === "character") {
      if (audTags.includes("voice_timbre")) audParts.push("vocal timbre, pitch resonance, and acoustic profile");
      if (audTags.includes("dialogue_sync")) audParts.push("synchronized spoken cadence, phrase pacing, and dialogue delivery");
      if (audTags.includes("singing")) audParts.push("musical pitch modulation, singing melody, and vibrato");
      if (audTags.includes("whisper")) audParts.push("intimate breathy whisper vocalization");
      if (audTags.includes("intense")) audParts.push("high-energy shouting vocal projection and breathing exertion");

      if (audParts.length > 0) {
        lines.push(`<Audio 1> is the vocal reference for ${speakerTag}, establishing ${audParts.join(", and ")}.`);
      } else {
        lines.push(`<Audio 1> is the vocal reference for ${speakerTag}.`);
      }
    } else if (type === "object") {
      if (audTags.includes("foley")) audParts.push("tactile friction, mechanical clicks, and handling contact sounds");
      if (audTags.includes("audio_fx")) audParts.push("distinctive operational hum and working sound effects");
      if (audTags.includes("impact")) audParts.push("hard surface collision and impact acoustics");

      if (audParts.length > 0) {
        lines.push(`<Audio 1> defines the ${audParts.join(", and ")} produced by ${baseTag}.`);
      } else {
        lines.push(`<Audio 1> is the acoustic foley reference for ${baseTag}.`);
      }
    } else if (type === "scene") {
      if (audTags.includes("room_tone")) audParts.push("indoor room tone, spatial volume, and reverb signature");
      if (audTags.includes("ambient")) audParts.push("ambient background soundscape and natural room atmosphere");
      if (audTags.includes("weather_sound")) audParts.push("wind gust aerodynamics and environmental weather acoustics");

      if (audParts.length > 0) {
        lines.push(`<Audio 1> provides the ${audParts.join(", and ")} for ${baseTag}.`);
      } else {
        lines.push(`<Audio 1> is the environmental soundscape reference for ${baseTag}.`);
      }
    }
  }

  lines.push(`${baseTag} must remain fully_preserved with consistent visual and physical continuity throughout.`);

  return lines.join("\n");
}
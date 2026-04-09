/**
 * ElevenLabs voice configuration for Kairo AI agents.
 * Voice synthesis is handled by Retell AI which calls ElevenLabs directly —
 * this module holds config constants used when registering Retell agents.
 */

export interface ElevenLabsVoiceConfig {
  voice_id: string;
  model_id: string;
  voice_settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
}

/**
 * Default Spanish (neutral) female voice for LATAM e-commerce agents.
 * Replace ELEVENLABS_VOICE_ID in your .env with the actual ElevenLabs voice ID.
 * Recommended voices: "Rachel" (en) or a cloned Spanish voice.
 */
export const DEFAULT_VOICE_CONFIG: ElevenLabsVoiceConfig = {
  voice_id: process.env.ELEVENLABS_VOICE_ID ?? "",
  model_id: "eleven_multilingual_v2",
  voice_settings: {
    stability: 0.55,
    similarity_boost: 0.75,
    style: 0.35,
    use_speaker_boost: true,
  },
};

/**
 * Builds the ElevenLabs TTS config object expected by Retell's agent setup.
 */
export function buildRetellVoiceConfig(voiceId?: string): ElevenLabsVoiceConfig {
  return {
    ...DEFAULT_VOICE_CONFIG,
    voice_id: voiceId ?? DEFAULT_VOICE_CONFIG.voice_id,
  };
}

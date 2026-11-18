// Web MIDI input. Chrome, Edge and Firefox on desktop/Android support it;
// iPhone/iPad Safari does not, so everything here degrades to "unavailable".

/** Parse one MIDI message. Returns {type:"on"|"off", ch (0-15), note, vel (0-1)} or null. */
export function parseMidi(data) {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const ch = data[0] & 0x0f;
  const note = data[1] & 0x7f;
  const v = data[2] & 0x7f;
  if (status === 0x90 && v > 0) return { type: "on", ch, note, vel: v / 127 };
  if (status === 0x80 || (status === 0x90 && v === 0)) return { type: "off", ch, note, vel: 0 };
  return null;
}

// General MIDI drum notes (channel 10) -> sequencer track index.
const GM_DRUMS = new Map([
  [35, 0], [36, 0], // kicks
  [38, 1], [40, 1], [37, 1], // snares / side stick
  [39, 2], // clap
  [42, 3], [44, 3], // closed / pedal hat
  [46, 4], // open hat
]);

/** Track for a GM drum note; anything unmapped (toms, cymbals, percussion) goes to Perc. */
export function drumTrackForNote(note) {
  return GM_DRUMS.get(note) ?? 5;
}

export const midiSupported = () => typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";

/**
 * Ask for MIDI access and route note messages to `onMessage(parsed)`.
 * Resolves to { ok, inputs: string[], reason? } and calls `onDevices(names)` when devices come and go.
 */
export async function connectMidi(onMessage, onDevices = () => {}) {
  if (!midiSupported()) return { ok: false, inputs: [], reason: "unsupported" };
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    return { ok: false, inputs: [], reason: e?.name === "SecurityError" || e?.name === "NotAllowedError" ? "denied" : "error" };
  }
  const handler = (e) => {
    const msg = parseMidi(e.data);
    if (msg) onMessage(msg);
  };
  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = handler;
      names.push(input.name || "MIDI device");
    }
    return names;
  };
  const inputs = attach();
  access.onstatechange = () => onDevices(attach());
  return { ok: true, inputs };
}

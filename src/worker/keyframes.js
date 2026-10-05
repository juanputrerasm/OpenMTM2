/* Resolve an animated BIN control model into its named frame models. */

/**
 * Animated BINs contain frame names instead of geometry. The first readable frame supplies the
 * drawable model, and compatible frames become morph targets in that first frame's coordinates.
 */
export async function resolveKeyframeModel(model, loadFrame) {
  if (!model?.frameNames?.length) return model;
  const frames = await Promise.all(model.frameNames.map(async (name) => ({ name, frame: await loadFrame(name) })));
  const first = frames.find(({ frame }) => frame?.meshes?.length);
  if (!first) return model;
  const drawable = {
    ...first.frame,
    name: model.name,
    frameNames: [...model.frameNames],
    resolvedFrame: first.name,
  };
  const morphs = keyframeMorphs(first.frame, frames.map(({ frame }) => frame).filter((frame) => frame?.meshes?.length));
  if (morphs) drawable.keyframes = morphs;
  return drawable;
}

/** Return compatible frame positions and normals, including frame zero, or null. */
export function keyframeMorphs(base, frames) {
  if (frames.length < 2) return null;
  const out = [];
  for (const frame of frames) {
    if (frame.meshes.length !== base.meshes.length) return null;
    const meshes = [];
    for (let i = 0; i < base.meshes.length; i++) {
      const source = frame.meshes[i], first = base.meshes[i];
      if (source.positions.length !== first.positions.length || source.normals.length !== first.normals.length) return null;
      meshes.push({ positions: new Float32Array(source.positions), normals: new Float32Array(source.normals) });
    }
    out.push({ meshes });
  }
  return out;
}

import type { AnimationClip, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

/** Loads a model from public/, or null if it is not there yet (the game keeps its placeholder). */
export async function loadModel(path: string): Promise<Object3D | null> {
  return (await loadModelWithClips(path))?.scene ?? null;
}

/** Same as loadModel, but also returns the animation clips inside the file (for the fox). */
export async function loadModelWithClips(path: string): Promise<{ scene: Object3D; clips: AnimationClip[] } | null> {
  try {
    const gltf = await loader.loadAsync(path);
    gltf.scene.traverse((o) => (o.castShadow = true));
    return { scene: gltf.scene, clips: gltf.animations };
  } catch {
    return null;
  }
}

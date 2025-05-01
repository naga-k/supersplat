import { Events } from './events';
import { Scene } from './scene';
import { serializePly } from './splat-serialize';
import { Splat } from './splat';
import { Writer } from './serialize/writer';

export const initializeStorage = (events: Events, scene: Scene) => {
    // Register serialization functions needed by cloud-storage.ts
    events.function('serializeSplat', async (splat: Splat, writer: Writer) => {
        const serializeSettings = {
            keepStateData: false,
            keepWorldTransform: true,
            keepColorTint: true
        };
        await serializePly([splat], serializeSettings, writer);
    });

    events.function('camera.serialize', () => scene.camera.docSerialize());
};
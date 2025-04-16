import { Events } from './events';
import { Scene } from './scene';
import { CustomStorageProvider } from './custom-storage-provider';
import { serializePly } from './splat-serialize';
import { Splat } from './splat';
import { Writer } from './serialize/writer';

// This function sets up the storage provider and related serialization functions
const initializeStorage = (events: Events, scene: Scene) => {
    // Register the custom storage provider instance
    const storageProvider = new CustomStorageProvider();
    events.function('storage.provider', () => storageProvider);

    // Register the function to serialize a single splat (needed by cloud-storage.ts)
    events.function('serializeSplat', async (splat: Splat, writer: Writer) => {
        const serializeSettings = {
            keepStateData: false, // Usually false for project saves
            keepWorldTransform: true,
            keepColorTint: true
        };
        await serializePly([splat], serializeSettings, writer);
    });

    // Register other necessary serialization functions using the scene object
    // Ensure these functions provide the data needed by cloud-storage.ts's document.json
    events.function('camera.serialize', () => scene.camera.docSerialize());
    // Add registrations for 'docSerialize.view', 'docSerialize.poseSets', 'docSerialize.timeline'
    // if they are not covered by registerDocEvents or similar. Example:
    // events.function('docSerialize.view', () => { /* logic to get view state from scene/camera */ });
};

export { initializeStorage };
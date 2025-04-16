import { Events } from './events';
import { BufferWriter } from './serialize/writer';
import { ZipWriter } from './serialize/zip-writer';
import { localize } from './ui/localization';

type User = {
    id: string;
    token: string;
    apiServer: string;
};

// Hardcoded user for testing
export const getUser = async (): Promise<User | null> => {
    // Replace with your actual token and ensure apiServer points to your Go backend
    return {
        id: 'hardcoded-user-id',
        token: '<Insert Token Here>',
        apiServer: 'http://localhost:3001/api/v1' // Your Go backend base URL
    };
};

export interface StorageProvider {
    uploadFile(filename: string, data: Uint8Array, token: string): Promise<void>;
}

export const registerStorageEvents = (events: Events) => {

    events.function('storage.save', async (filename: string) => {
        console.log('[DEBUG] storage.save started with filename:', filename);
        
        const user = await getUser();
        console.log('[DEBUG] User retrieved:', user ? 'Yes' : 'No');
        
        if (!user) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('cloud.auth-required'),
                message: localize('cloud.please-login')
            });
            return false;
        }

        const provider = events.invoke('storage.provider') as StorageProvider;
        console.log('[DEBUG] Provider retrieved:', provider ? 'Yes' : 'No');
        
        if (!provider) {
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('cloud.no-provider'),
                message: localize('cloud.provider-required')
            });
            return false;
        }

        try {
            events.fire('startSpinner');
            console.log('[DEBUG] Creating zip file...');

            // Create buffer for project
            const writer = new BufferWriter();
            const zipWriter = new ZipWriter(writer);

            // Write document data
            const document = {
                version: 0,
                camera: events.invoke('camera.serialize'),
                view: events.invoke('docSerialize.view'),
                poseSets: events.invoke('docSerialize.poseSets'),
                timeline: events.invoke('docSerialize.timeline'),
                splats: events.invoke('scene.allSplats').map((s: { docSerialize: () => any; }) => s.docSerialize())
            };
            console.log('[DEBUG] Document created with splats:', document.splats.length);

            await zipWriter.file('document.json', JSON.stringify(document));

            // Write splat data
            const splats = events.invoke('scene.allSplats');
            console.log('[DEBUG] Processing', splats.length, 'splats for serialization');
            
            for (let i = 0; i < splats.length; ++i) {
                console.log(`[DEBUG] Serializing splat ${i}...`);
                await zipWriter.start(`splat_${i}.ply`);
                await events.invoke('serializeSplat', splats[i], zipWriter);
            }

            await zipWriter.close();
            const buffer = writer.close();
            console.log('[DEBUG] Zip created with size:', buffer.byteLength, 'bytes');

            // Upload using provider
            console.log('[DEBUG] Starting upload with provider...');
            await provider.uploadFile(filename, buffer, user.token);
            console.log('[DEBUG] Upload completed successfully');

            events.fire('doc.saved'); // Add this line to mark the document as saved
            return true; // Add explicit return value
        } catch (error) {
            console.error('[DEBUG] Error during save:', error);
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('cloud.save-failed'),
                message: error.message
            });
            return false; // Add explicit return value
        } finally {
            events.fire('stopSpinner');
        }
    });

    // Add this function to check if cloud save is enabled
    events.function('cloudsave.enabled', async () => {
        return !!(await getUser());
    });
};
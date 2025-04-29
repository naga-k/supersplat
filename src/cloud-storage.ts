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

interface UploadUrlsResponse {
    assetId: string;
    key: string;
    uploadId: string;
    presignedUrls: string[];
}

export const registerStorageEvents = (events: Events) => {
    events.function('storage.save', async (filename: string) => {
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

            await zipWriter.file('document.json', JSON.stringify(document));

            // Write splat data
            const splats = events.invoke('scene.allSplats');
            for (let i = 0; i < splats.length; ++i) {
                await zipWriter.start(`splat_${i}.ply`);
                await events.invoke('serializeSplat', splats[i], zipWriter);
            }

            await zipWriter.close();
            const buffer = writer.close();
            const numParts = Math.ceil(buffer.byteLength / (5 * 1024 * 1024)); // 5MB chunks

            // Request upload URLs from Flutter
            console.log('[DEBUG] Requesting upload URLs...');
            window.postMessage({
                type: 'requestUploadUrls',
                data: {
                    fileName: filename,
                    numberOfParts: numParts
                }
            }, '*');

            // Wait for response with upload URLs
            const uploadUrls: UploadUrlsResponse = await new Promise((resolve, reject) => {
                const handler = (event: MessageEvent) => {
                    if (event.data?.type === 'uploadUrls') {
                        window.removeEventListener('message', handler);
                        resolve(event.data.data);
                    }
                };
                window.addEventListener('message', handler);

                // Timeout after 30 seconds
                setTimeout(() => {
                    window.removeEventListener('message', handler);
                    reject(new Error('Timeout waiting for upload URLs'));
                }, 30000);
            });

            // Upload file chunks using presigned URLs
            const chunks = splitBuffer(buffer, numParts);
            const uploadPromises = chunks.map(async (chunk, index) => {
                const response = await fetch(uploadUrls.presignedUrls[index], {
                    method: 'PUT',
                    body: chunk,
                    headers: {
                        'Content-Type': 'application/octet-stream'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to upload part ${index + 1}`);
                }

                return {
                    PartNumber: index + 1,
                    ETag: response.headers.get('ETag')?.replace(/"/g, '') ?? ''
                };
            });

            const parts = await Promise.all(uploadPromises);

            events.fire('doc.saved');
            return true;

        } catch (error) {
            console.error('[DEBUG] Error during save:', error);
            await events.invoke('showPopup', {
                type: 'error',
                header: localize('cloud.save-failed'),
                message: error.message
            });
            return false;
        } finally {
            events.fire('stopSpinner');
        }
    });

    // Add this function to check if cloud save is enabled
    events.function('cloudsave.enabled', async () => {
        return !!(await getUser());
    });
};

// Helper function to split buffer into chunks
function splitBuffer(buffer: Uint8Array, numParts: number): Uint8Array[] {
    const chunkSize = Math.ceil(buffer.length / numParts);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < numParts; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, buffer.length);
        chunks.push(buffer.slice(start, end));
    }

    return chunks;
}
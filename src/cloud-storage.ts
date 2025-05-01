import { Events } from './events';
import { BufferWriter } from './serialize/writer';
import { ZipWriter } from './serialize/zip-writer';
import { localize } from './ui/localization';

type User = {
  id: string;
  token: string;
  apiServer: string;
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

// Minimum chunk size of 5MB (AWS requirement)
const MIN_CHUNK_SIZE = 5 * 1024 * 1024; 

export const registerStorageEvents = (events: Events) => {
  events.function('storage.save', async (filename: string) => {
    try {
      events.fire('startSpinner');
      console.log('[DEBUG] Creating zip file...');

      // Build the ZIP buffer
      const writer = new BufferWriter();
      const zipWriter = new ZipWriter(writer);
      const document = {
        version: 0,
        camera: events.invoke('camera.serialize'),
        view: events.invoke('docSerialize.view'),
        poseSets: events.invoke('docSerialize.poseSets'),
        timeline: events.invoke('docSerialize.timeline'),
        splats: events.invoke('scene.allSplats').map((s: any) => s.docSerialize())
      };
      await zipWriter.file('document.json', JSON.stringify(document));
      const splats = events.invoke('scene.allSplats');
      for (let i = 0; i < splats.length; ++i) {
        await zipWriter.start(`splat_${i}.ply`);
        await events.invoke('serializeSplat', splats[i], zipWriter);
      }
      await zipWriter.close();
      const buffer = writer.close();

      const numParts = Math.min(
        Math.ceil(buffer.byteLength / MIN_CHUNK_SIZE),
        Math.ceil(buffer.byteLength / (5 * 1024 * 1024))
      );

      console.log('[DEBUG] Requesting upload URLs...');

      // Single helper that always stringifies
      const sendMessageToHost = (message: any) => {
        console.log('[DEBUG] Sending to parent window:', message);
        window.parent.postMessage(JSON.stringify(message), '*');
      };

      // Await the presigned URLs from Flutter
      const uploadUrls: UploadUrlsResponse = await new Promise((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          console.log('[DEBUG] Received message event:', {
            origin: event.origin,
            data: event.data,
            type: typeof event.data,
            source: event.source === window ? 'self' : 'external',
          });

          // Ignore echoes of our own request
          if (event.source === window) {
            console.log('[DEBUG] Ignoring self-message');
            return;
          }

          let data = event.data;
          try {
            if (typeof data === 'string') {
              data = JSON.parse(data);
              console.log('[DEBUG] Parsed message data:', data);
            }

            if (data?.type === 'uploadUrls') {
              console.log('[DEBUG] Got upload URLs response:', data.data);
              window.removeEventListener('message', handler);
              if (data.error) reject(new Error(data.error));
              else resolve(data.data);
              return;
            }

            console.log('[DEBUG] Unexpected message type:', data?.type);
          } catch (e) {
            console.error('[DEBUG] Error processing message:', e);
          }
        };

        window.addEventListener('message', handler);
        console.log('[DEBUG] Registered message handler');

        sendMessageToHost({
          type: 'requestUploadUrls',
          data: { fileName: filename, numberOfParts: numParts }
        });

        setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error('Timeout waiting for upload URLs'));
        }, 30000);
      });

      const chunks = splitBuffer(buffer, numParts);
      const parts = await Promise.all(
        chunks.map(async (chunk, idx) => {
          const res = await fetch(uploadUrls.presignedUrls[idx], {
            method: 'PUT',
            body: chunk,
            headers: { 'Content-Type': 'application/octet-stream' }
          });
          if (!res.ok) throw new Error(`Failed to upload part ${idx + 1}`);
          return {
            PartNumber: idx + 1,
            ETag: (res.headers.get('ETag') || '').replace(/"/g, '')
          };
        })
      );

      window.parent.postMessage(
        JSON.stringify({
          type: 'multipartUploadComplete',
          data: {
            assetId: uploadUrls.assetId,
            key: uploadUrls.key,
            uploadId: uploadUrls.uploadId,
            parts: parts
          }
        }),
        '*'
      );

      await new Promise<void>((resolve, reject) => {
        const h = (event: MessageEvent) => {
          // Ignore echoes of our own request
          if (event.source === window) {
            console.log('[DEBUG] Ignoring self-message');
            return;
          }

          let data = event.data;
          try {
            // Parse the message if it's a string
            if (typeof data === 'string') {
              data = JSON.parse(data);
            }
            console.log('[DEBUG] Processing confirmation message:', data);

            // Check both type and success status
            if (data?.type === 'multipartUploadConfirmed' && data?.data?.success === true) {
              console.log('[DEBUG] Upload confirmed successfully:', data);
              window.removeEventListener('message', h);
              resolve();
            } else {
              console.log('[DEBUG] Received message but not matching criteria:', 
                JSON.stringify(data, null, 2));
            }
          } catch (e) {
            console.error('[DEBUG] Error processing confirmation message:', e);
          }
        };
        
        window.addEventListener('message', h);
        setTimeout(() => {
          window.removeEventListener('message', h);
          reject(new Error('Timeout waiting for upload completion'));
        }, 30000);
      });

      events.fire('doc.saved');
      return true;

    } catch (error: any) {
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
};

function splitBuffer(buffer: Uint8Array, numParts: number): Uint8Array[] {
  const minChunks = Math.ceil(buffer.length / MIN_CHUNK_SIZE);
  const actualNumParts = Math.min(numParts, minChunks);
  
  const chunkSize = Math.max(
    MIN_CHUNK_SIZE,
    Math.ceil(buffer.length / actualNumParts)
  );
  
  const chunks: Uint8Array[] = [];
  let start = 0;
  
  while (start < buffer.length) {
    const end = Math.min(start + chunkSize, buffer.length);
    chunks.push(buffer.slice(start, end));
    start = end;
  }
  
  return chunks;
}

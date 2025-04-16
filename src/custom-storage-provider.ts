import { StorageProvider } from './cloud-storage';

interface MultipartInitResponse {
    upload_id: string;
    key: string;
    presigned_urls: string[];
}

interface UploadPart {
    PartNumber: number;
    ETag: string;
}

export class CustomStorageProvider implements StorageProvider {
    private readonly CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

    // Updated to use the parameters correctly
    async uploadFile(filename: string, data: Uint8Array, token: string): Promise<void> {
        console.log(`[DEBUG] CustomStorageProvider.uploadFile called with filename: ${filename}`);
        
        const assetId = "3aff8c2e-6f28-4a53-a0ac-9b053cfd6ebc"; 
        const chunks = this.splitIntoChunks(data);
        const numParts = chunks.length;
        
        // Use the filename parameter in the path
        const fileKey = `dev/uploadtest/${filename}`;
        
        // Get API URL from token object (could be passed in a better way)
        const apiUrl = "http://localhost:3001/api/v1"; // This should ideally come from a central config
        
        console.log(`[DEBUG] Upload info: apiUrl=${apiUrl}, fileKey=${fileKey}, chunks=${numParts}`);

        try {
            // 1. Initialize multipart upload
            const initPayload = {
                id: assetId,
                key: fileKey,
                no_of_parts: numParts
            };

            const initResponse = await fetch(`${apiUrl}/assets/upload/multipart`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`, // Use the token passed as parameter
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(initPayload)
            });

            if (!initResponse.ok) {
                throw new Error(`Failed to initialize upload: ${await initResponse.text()}`);
            }

            const initData: MultipartInitResponse = await initResponse.json();
            console.log('[DEBUG] Upload initialized:', initData);

            // 2. Upload parts (sequentially for simplicity)
            const completedParts: UploadPart[] = [];
            for (let i = 0; i < chunks.length; i++) {
                const partNumber = i + 1;
                const uploadUrl = initData.presigned_urls[i];

                console.log(`[DEBUG] Uploading part ${partNumber}/${numParts} to ${uploadUrl}`);
                
                // S3 presigned URLs usually don't need Auth headers
                const uploadResponse = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: chunks[i],
                    headers: {
                       'Content-Type': 'application/octet-stream'
                    }
                });

                if (!uploadResponse.ok) {
                    throw new Error(`Failed to upload part ${partNumber}: ${uploadResponse.status} ${uploadResponse.statusText}`);
                }

                const etagHeader = uploadResponse.headers.get('ETag');
                if (!etagHeader) {
                     throw new Error(`ETag header missing for part ${partNumber}`);
                }
                const etag = etagHeader.replace(/"/g, ''); // Remove quotes from ETag
                completedParts.push({
                    PartNumber: partNumber,
                    ETag: etag
                });
                console.log(`[DEBUG] Part ${partNumber}/${numParts} uploaded`);
            }

            // 3. Complete multipart upload
            const completePayload = {
                id: assetId,
                key: initData.key, // Use the key from the init response
                upload_id: initData.upload_id,
                parts: completedParts
            };

            console.log('[DEBUG] Completing multipart upload');
            
            const completeResponse = await fetch(`${apiUrl}/assets/upload/multipart/complete`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`, // Use the token passed as parameter
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(completePayload)
            });

            if (!completeResponse.ok) {
                throw new Error(`Failed to complete upload: ${await completeResponse.text()}`);
            }

            console.log('[DEBUG] Upload completed successfully:', await completeResponse.json());

        } catch (error) {
            console.error('[DEBUG] Upload failed:', error);
            throw error;
        }
    }

    private splitIntoChunks(data: Uint8Array): Uint8Array[] {
        const chunks: Uint8Array[] = [];
        let offset = 0;
        while (offset < data.length) {
            const end = Math.min(offset + this.CHUNK_SIZE, data.length);
            chunks.push(data.slice(offset, end));
            offset += this.CHUNK_SIZE;
        }
        return chunks;
    }
}
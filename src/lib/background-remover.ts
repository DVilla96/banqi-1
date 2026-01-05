
import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Removes the background from an image using Google MediaPipe's Selfie Segmentation model.
 * It replaces the background with a pure white color.
 * 
 * @param imageFile The input image file (likely from a file input or camera capture).
 * @param onProgress Optional callback for progress updates (MediaPipe doesn't support granular progress, so we just simulate start/end).
 * @returns A Promise that resolves to a new File object with a white background.
 */
export async function removeBackgroundWithMediaPipe(
    imageFile: File,
    onProgress?: (status: string) => void
): Promise<File> {
    onProgress?.("Loading AI models...");

    // 1. Load the tasks-vision WASM binaries
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    // 2. Initialize the ImageSegmenter with the Selfie Segmentation model
    // We use the float16 model for a good balance of speed and quality
    const imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
            delegate: "GPU", // Try to use GPU for faster inference
        },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
    });

    onProgress?.("Processing image...");

    // 3. Prepare the image for processing
    const sourceImage = await createImageBitmap(imageFile);

    // 4. Run segmentation
    // The 'category mask' is a uint8 array where pixel value 0 = background, 1 = person (usually)
    // For selfie_segmenter: index 0 is background, index 1 is body, index 2 is face, etc. depending on model version.
    // The standard selfie_segmenter has: 0=background, 1=person.
    const segmentationResult = imageSegmenter.segment(sourceImage);
    const mask = segmentationResult.categoryMask!; // Float32Array or Uint8Array

    // 5. Draw the result onto a canvas with white background
    const canvas = document.createElement("canvas");
    canvas.width = sourceImage.width;
    canvas.height = sourceImage.height;
    const ctx = canvas.getContext("2d")!;

    // Draw pure white background first
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get image data to manipulate pixels based on mask
    // Note: drawing the full image and then masking is one way. 
    // Another efficient way is to iterate pixels.
    // Since we want to KEEP the person and show WHITE elsewhere:

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sourceImage.width;
    tempCanvas.height = sourceImage.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.drawImage(sourceImage, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, sourceImage.width, sourceImage.height);
    const pixelData = imageData.data;

    // The mask is a flattened array conforming to the image dimensions
    const maskData = mask.getAsFloat32Array(); // or getAsUint8Array depending on implementation

    // Iterate through pixels
    for (let i = 0; i < maskData.length; ++i) {
        // MediaPipe Selfie Segmenter:
        // mask value is likely a category index (0, 1, 2...)
        // 0 is usually background.
        const isBackground = maskData[i] === 0; // Check if category is 0 (Background)

        if (isBackground) {
            // Option A: Make it transparent (if we wanted transparency)
            // pixelData[i * 4 + 3] = 0; 

            // Option B: Make it white (as requested)
            pixelData[i * 4] = 255;     // R
            pixelData[i * 4 + 1] = 255; // G
            pixelData[i * 4 + 2] = 255; // B
            pixelData[i * 4 + 3] = 255; // Alpha (fully opaque)
        }
        // If it's person (not 0), we leave the original pixelData stats alone
    }

    // Put the modified image data (original person + white background pixels) onto the main canvas
    ctx.putImageData(imageData, 0, 0);

    // 6. Convert to File
    const processedBlob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/jpeg", 0.95)
    );

    // Cleanup
    imageSegmenter.close();

    return new File([processedBlob], "profile-photo-processed.jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
    });
}

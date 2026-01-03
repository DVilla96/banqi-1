
'use server';
/**
 * @fileOverview Background removal - This is now a pass-through since
 * the actual removal happens client-side with @imgly/background-removal
 * 
 * The client-side implementation is in the approval page.
 */

import {z} from 'zod';

const RemoveBackgroundInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a person, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type RemoveBackgroundInput = z.infer<typeof RemoveBackgroundInputSchema>;

const RemoveBackgroundOutputSchema = z.object({
  photoDataUri: z.string().describe("The processed photo as a data URI with a pure white background."),
});
export type RemoveBackgroundOutput = z.infer<typeof RemoveBackgroundOutputSchema>;

// This function is no longer used - background removal now happens client-side
// Keeping the types for compatibility
export async function removeBackground(input: RemoveBackgroundInput): Promise<RemoveBackgroundOutput> {
  // Pass through - actual processing happens on client
  return { photoDataUri: input.photoDataUri };
}

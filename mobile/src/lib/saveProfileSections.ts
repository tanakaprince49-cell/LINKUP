export class ProfileSectionSaveError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('Your basic profile changes were saved, but extra sections could not be saved. Your edits are still open. Please try again.');
    this.name = 'ProfileSectionSaveError';
    this.cause = cause;
  }
}

// Keep the bounded writes used by installed clients: one very large profile
// mutation can exceed Firestore's rules expression budget. Never pretend that
// a rejected second write succeeded, or publish it to the local/public cache.
export async function saveProfileSections(
  write: (patch: Record<string, unknown>) => Promise<void>,
  core: Record<string, unknown>,
  optional: Record<string, unknown>,
): Promise<void> {
  await write(core);
  try {
    await write(optional);
  } catch (error) {
    throw new ProfileSectionSaveError(error);
  }
}

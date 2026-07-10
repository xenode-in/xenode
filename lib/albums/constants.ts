/**
 * Shared album constants.
 *
 * ENCRYPTED_ALBUM_NAME_PLACEHOLDER is stored in PhotoAlbum.name when the real
 * name lives in encryptedName (E2EE). Old clients that only know `name` keep
 * rendering something readable; new clients treat this value as "decrypt
 * encryptedName instead".
 */
export const ENCRYPTED_ALBUM_NAME_PLACEHOLDER = "Encrypted album";

/** Hard cap on objectIds accepted per membership mutation request. */
export const ALBUM_OBJECTS_MAX_BATCH = 500;

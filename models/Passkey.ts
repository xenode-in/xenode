import mongoose, { Schema, Document, Model } from "mongoose"

export interface IPasskey extends Document {
  userId: string
  credentialId: string        // base64url
  publicKey: Buffer
  counter: number
  transports: string[]
  // PRF-derived wrap key encrypts a copy of the RSA private key.
  // Server stores the ciphertext but cannot decrypt it —
  // the wrap key is derived from PRF output that only the user's device produces.
  encryptedVaultKey: string   // base64url, AES-256-GCM ciphertext of pkcs8 privateKey
  vaultKeyIV: string          // base64url
  name: string | null         // user-assigned label
  createdAt: Date
  updatedAt: Date
}

const PasskeySchema = new Schema<IPasskey>(
  {
    userId:           { type: String, required: true, index: true },
    credentialId:     { type: String, required: true, unique: true, index: true },
    publicKey:        { type: Buffer, required: true },
    counter:          { type: Number, required: true, default: 0 },
    transports:       { type: [String], default: [] },
    encryptedVaultKey:{ type: String, required: true },
    vaultKeyIV:       { type: String, required: true },
    name:             { type: String, default: null },
  },
  { timestamps: true }
)

const Passkey: Model<IPasskey> =
  mongoose.models.Passkey || mongoose.model<IPasskey>("Passkey", PasskeySchema)

export default Passkey

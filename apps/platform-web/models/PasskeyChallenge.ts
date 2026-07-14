import mongoose, { Schema, Document, Model } from "mongoose"

export interface IPasskeyChallenge extends Document {
  challenge: string   // base64url, from generateRegistrationOptions/generateAuthenticationOptions
  userId?: string     // set for registration (user is logged in); absent for login
  nonce?: string      // set for login (user is NOT logged in yet)
  type: "registration" | "authentication"
  expiresAt: Date
}

const PasskeyChallengeSchema = new Schema<IPasskeyChallenge>({
  challenge:  { type: String, required: true },
  userId:     { type: String },
  nonce:      { type: String, index: true },
  type:       { type: String, enum: ["registration", "authentication"], required: true },
  expiresAt:  { type: Date, required: true },
})

// Auto-delete expired challenges
PasskeyChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const PasskeyChallenge: Model<IPasskeyChallenge> =
  mongoose.models.PasskeyChallenge ||
  mongoose.model<IPasskeyChallenge>("PasskeyChallenge", PasskeyChallengeSchema)

export default PasskeyChallenge

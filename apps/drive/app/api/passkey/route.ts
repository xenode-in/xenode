import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth/session"
import dbConnect from "@/lib/mongodb"
import Passkey from "@/models/Passkey"

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth(req)
    const userId = session.user.id

    await dbConnect()

    const passkeys = await Passkey.find({ userId })

    return NextResponse.json(passkeys.map(p => ({
      _id: p._id,
      name: p.name || 'Unknown Device',
      createdAt: p.createdAt,
      lastUsedAt: p.updatedAt,
    })))
  } catch (err: any) {
    console.error("Passkey list error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: err.message === "Unauthorized" ? 401 : 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAuth(req)
    const userId = session.user.id
    
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    await dbConnect()

    const deleted = await Passkey.deleteOne({ _id: id, userId })

    return NextResponse.json({ success: deleted.deletedCount > 0 })
  } catch (err: any) {
    console.error("Passkey delete error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: err.message === "Unauthorized" ? 401 : 500 })
  }
}

"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { isPlatformAuthenticatorAvailable } from "@/lib/passkey-support"
import { signInWithPasskeyPRF } from "@/lib/passkey-prf"
import { toast } from "sonner"
import { Fingerprint, Loader2 } from "lucide-react"

export function PasskeySignInButton() {
  const router = useRouter()
  const [show, setShow] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (localStorage.getItem("xenode_prf_unsupported")) { 
      // Defer to avoid cascading render
      setTimeout(() => setShow(false), 0)
      return 
    }
    isPlatformAuthenticatorAvailable().then(setShow)
  }, [])

  if (show === null) return <div className="h-10 w-full animate-pulse bg-muted rounded-md" />
  if (!show) return null

  async function handleClick() {
    setLoading(true)
    try {
      const result = await signInWithPasskeyPRF()

      if (!result.ok) {
        setLoading(false)
        if (result.reason === "prf_failed") {
          setShow(false)
          toast.error("This device doesn't support passwordless vault unlock")
        } else if (result.reason === "no_vault") {
          // User authenticated via passkey but has no E2EE vault — send to onboarding
          toast.info("Authentication successful. Setting up your vault...")
          router.push("/onboarding")
        } else if (result.reason !== "cancelled") {
          toast.error("Passkey sign-in failed. Try again.")
        }
        return
      }

      toast.success("Signed in successfully")
      // Keys are already in IndexedDB (cacheKeys was called in signInWithPasskeyPRF).
      // CryptoContext will pick them up via loadCachedKeys() on mount.
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      console.error("Passkey sign-in error:", err)
      toast.error("An unexpected error occurred")
      setLoading(false)
    }
  }

  return (
    <Button 
      variant="outline" 
      className="w-full flex items-center justify-center gap-2 h-11" 
      onClick={handleClick} 
      disabled={loading}
    >
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        : <Fingerprint className="w-4 h-4 text-primary" />}
      <span>Sign in with passkey</span>
    </Button>
  )
}

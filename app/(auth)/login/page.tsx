"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!isLogin && formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        const result = await signIn.email({
          email: formData.email,
          password: formData.password,
        });
        if (result.error) {
          setError(result.error.message || "Invalid credentials");
          return;
        }
      } else {
        const result = await signUp.email({
          name: formData.name,
          email: formData.email,
          password: formData.password,
        });
        if (result.error) {
          setError(result.error.message || "Failed to create account");
          return;
        }
      }

      sessionStorage.setItem("xenode-vault-pw", formData.password);
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-full max-w-[860px] bg-white/10 backdrop-blur-sm rounded-3xl shadow-xl overflow-hidden flex min-h-[520px] border border-white/10">

        {/* Left gradient panel — original green gradient from layout */}
        <div
          className="hidden md:flex md:w-[38%] relative flex-col justify-between p-8 text-[#e8e4d9] rounded-l-3xl"
          style={{
            background: "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)",
          }}
        >
          {/* Logo */}
          <Link href="/" className="inline-block">
            <span className="text-2xl font-brand italic text-[#e8e4d9]">Xenode</span>
          </Link>

          {/* Bottom tagline */}
          <div>
            <p className="text-sm text-[#e8e4d9]/60 mb-1">You can easily</p>
            <h2 className="text-xl font-bold leading-snug text-[#e8e4d9]">
              Get access your personal hub for clarity and productivity
            </h2>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex flex-col justify-center px-10 py-10">
          {/* Mobile logo */}
          <div className="md:hidden mb-6 text-center">
            <Link href="/">
              <span className="text-3xl font-brand italic text-[#e8e4d9]">Xenode</span>
            </Link>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-[#e8e4d9]">
              {isLogin ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-[#e8e4d9]/70 mt-1">
              {isLogin
                ? "Sign in to your Xenode Storage account"
                : "Get started with Xenode Storage"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm text-[#e8e4d9]/80">
                  Full Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  className="h-11 bg-white/10 border-white/20 text-[#e8e4d9] placeholder:text-[#e8e4d9]/40 focus-visible:ring-[#7cb686]/50"
                  required={!isLogin}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-[#e8e4d9]/80">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                className="h-11 bg-white/10 border-white/20 text-[#e8e4d9] placeholder:text-[#e8e4d9]/40 focus-visible:ring-[#7cb686]/50"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-[#e8e4d9]/80">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="h-11 bg-white/10 border-white/20 text-[#e8e4d9] placeholder:text-[#e8e4d9]/40 focus-visible:ring-[#7cb686]/50 pr-10"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e8e4d9]/50 hover:text-[#e8e4d9]"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm text-[#e8e4d9]/80">
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  className="h-11 bg-white/10 border-white/20 text-[#e8e4d9] placeholder:text-[#e8e4d9]/40 focus-visible:ring-[#7cb686]/50"
                  required={!isLogin}
                  minLength={8}
                />
              </div>
            )}

            {error && (
              <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-[#e8e4d9] text-[#273f2c] hover:bg-white font-semibold transition-all duration-200 hover:-translate-y-0.5"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {isLogin ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <p className="text-center text-sm mt-6 text-[#e8e4d9]/70">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setError(""); }}
              className="text-[#7cb686] hover:underline font-medium"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-[#f0eef8] p-4">
      <div className="w-full max-w-[900px] bg-white rounded-3xl shadow-xl overflow-hidden flex min-h-[520px]">

        {/* Left gradient panel */}
        <div
          className="hidden md:flex md:w-[38%] relative flex-col justify-between p-8 text-white"
          style={{
            background: "linear-gradient(135deg, #a8c4f0 0%, #b8a0e8 40%, #7c6ac8 100%)",
          }}
        >
          {/* Asterisk logo */}
          <div className="text-2xl font-bold select-none">✳</div>

          {/* Bottom tagline */}
          <div>
            <p className="text-sm text-white/70 mb-1">You can easily</p>
            <h2 className="text-xl font-bold leading-snug">
              Get access your personal hub for clarity and productivity
            </h2>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex flex-col justify-center px-10 py-10">
          {/* Asterisk + title */}
          <div className="mb-6">
            <span className="text-indigo-600 text-xl font-bold">✳</span>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              {isLogin ? "Welcome back" : "Create an account"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {isLogin
                ? "Sign in to your Xenode account to continue."
                : "Access your tasks, notes, and projects anytime, anywhere — and keep everything flowing in one place."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name field (sign up only) */}
            {!isLogin && (
              <div className="space-y-1">
                <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                  Full Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-400"
                  required={!isLogin}
                />
              </div>
            )}

            {/* Email */}
            <div className="space-y-1">
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                Your email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="you@example.com"
                className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-400"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••••"
                  className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-400 pr-10"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm password (sign up only) */}
            {!isLogin && (
              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                  Confirm Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="••••••••••"
                  className="h-11 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus-visible:ring-indigo-400"
                  required={!isLogin}
                  minLength={8}
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                {error}
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all duration-200"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {isLogin ? "Sign In" : "Get Started"}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or continue with</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* OAuth buttons */}
          <div className="flex gap-3 justify-center">
            <button className="flex items-center justify-center w-12 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition text-sm font-bold text-[#053eff]">
              Bē
            </button>
            <button className="flex items-center justify-center w-12 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition">
              <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            </button>
            <button className="flex items-center justify-center w-12 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#1877F2]" xmlns="http://www.w3.org/2000/svg">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </button>
          </div>

          {/* Toggle */}
          <p className="text-center text-sm mt-6 text-gray-500">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setError(""); }}
              className="text-indigo-600 hover:underline font-medium"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

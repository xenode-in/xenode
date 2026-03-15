"use client";

import { useState, useEffect } from "react";
import { getUserUsage, mockChargeRecurring, timeTravelUsage, initializeTestState } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export function SimulatorClient({ users }: { users: any[] }) {
  const [userId, setUserId] = useState<string | null>(users.length > 0 ? users[0].id : null);
  const [usage, setUsage] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      refreshUsage(userId);
    }
  }, [userId]);

  async function refreshUsage(id: string) {
    setLoading(true);
    const data = await getUserUsage(id);
    setUsage(data);
    setLoading(false);
  }

  async function handleInit(state: "pro_forever" | "pro_limited") {
    if (!userId) return;
    setLoading(true);
    await initializeTestState(userId, state);
    await refreshUsage(userId);
    toast.success(`User set to ${state}`);
    setLoading(false);
  }

  async function handleTimeTravel() {
    if (!userId) return;
    setLoading(true);
    await timeTravelUsage(userId);
    await refreshUsage(userId);
    toast.success("ExpiresAt moved to past. Ready for Cron.");
    setLoading(false);
  }

  async function handleCron(forceStatus: "success" | "failed") {
    if (!userId) return;
    setLoading(true);
    const result = await mockChargeRecurring(userId, forceStatus);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(`Cron executed: ${result.newStatus}. Charged: ₹${result.chargeAmount}`);
    }
    await refreshUsage(userId);
    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white text-lg">Select Test User</CardTitle>
          <CardDescription className="text-zinc-400">
            Pick a user to simulate billing logic against
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select onValueChange={setUserId} value={userId || undefined}>
            <SelectTrigger className="w-full bg-zinc-800 border-zinc-700 text-white">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700 text-white max-h-[300px]">
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {usage && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">Current State (Usage DB)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Plan</p>
                <p className="text-white font-mono">{usage.plan}</p>
              </div>
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Price INR / Base</p>
                <p className="text-white font-mono">₹{usage.planPriceINR} / ₹{usage.basePlanPriceINR}</p>
              </div>
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Campaign Type</p>
                <p className="text-white font-mono">{usage.campaignType || "none"}</p>
              </div>
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Cycles Left</p>
                <p className="text-white font-mono">{usage.campaignCyclesLeft ?? "null"}</p>
              </div>
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Autopay Active</p>
                <p className="text-white font-mono">{usage.autopayActive ? "true" : "false"}</p>
              </div>
              <div className="bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Grace Period</p>
                <p className="text-white font-mono">{usage.isGracePeriod ? "true" : "false"}</p>
              </div>
              <div className="col-span-2 bg-zinc-800 p-3 rounded-md">
                <p className="text-xs text-zinc-400">Plan Expires At</p>
                <p className="text-white font-mono text-xs mt-1">
                  {usage.planExpiresAt ? new Date(usage.planExpiresAt).toLocaleString() : "null"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-white font-semibold mb-2">Simulation Controls</h3>
              <div className="flex flex-wrap gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="bg-blue-900/20 text-blue-400 border-blue-900 hover:bg-blue-900/40"
                  onClick={() => handleInit("pro_limited")}
                  disabled={loading}
                >
                  Set to: Pro w/ 2 Limited Cycles
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="bg-purple-900/20 text-purple-400 border-purple-900 hover:bg-purple-900/40"
                  onClick={() => handleInit("pro_forever")}
                  disabled={loading}
                >
                  Set to: Pro w/ Forever Discount
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  onClick={handleTimeTravel}
                  disabled={loading}
                >
                  1. Time Travel (Set expires to past)
                </Button>
                <Button 
                  variant="default" 
                  size="sm" 
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => handleCron("success")}
                  disabled={loading}
                >
                  2. Simulate Cron: Payment SUCCESS
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => handleCron("failed")}
                  disabled={loading}
                >
                  3. Simulate Cron: Payment FAILED (Test Grace)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { RequireAuth, useAuth } from "@/components/AuthProvider";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import { homePathFor } from "@/lib/auth";

/** Admins land here after sign-in until they have set up 2FA. */
export default function TwoFactorSetupPage() {
  return (
    <RequireAuth roles={["admin"]} allowTwoFactorSetup>
      <AuthCard subtitle="Secure your admin account">
        <RequiredSetup />
      </AuthCard>
    </RequireAuth>
  );
}

function RequiredSetup() {
  const { user, logout } = useAuth();
  const router = useRouter();
  // Read once on arrival: finishing setup flips the flag, and the recovery codes must still show
  const [alreadyOn] = useState(user.two_factor_enabled);

  // Opened by hand after 2FA is already on: nothing to do here
  useEffect(() => {
    if (alreadyOn) router.replace("/admin/security");
  }, [alreadyOn, router]);

  if (alreadyOn) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-300 text-center">
        Admin accounts can see KTP, bank and payroll data, so they need two-factor authentication: after your password or
        Google, you&apos;ll also enter a code from an app on your phone.
      </p>
      <TwoFactorSetup onDone={(updated) => router.replace(homePathFor(updated))} />
      <button type="button" onClick={logout} className="w-full text-sm text-gray-400 hover:text-white">
        Log out
      </button>
    </div>
  );
}
